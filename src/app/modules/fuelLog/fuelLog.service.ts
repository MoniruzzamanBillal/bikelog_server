import { Prisma } from "@prisma/client";
import { TFuelLog } from "./fuelLog.interface";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import { deleteCloudinaryImage } from "../../util/cloudinary";

// every returned fuel log gets the _id/bike remap (spec 31/32 precedent) plus
// Decimal->Number conversion for pricePerLiter/totalCost (top-level plan decision #6)
const toApiShape = <
  T extends {
    id: string;
    bikeId: string;
    pricePerLiter: unknown;
    totalCost: unknown;
  },
>(
  fuelLog: T,
) => ({
  ...fuelLog,
  _id: fuelLog.id,
  bike: fuelLog.bikeId,
  pricePerLiter: Number(fuelLog.pricePerLiter),
  totalCost: Number(fuelLog.totalCost),
});

// ! the odometer must be non-decreasing in DATE order across the bike's live fuel logs — NOT
// ! compared to bike.currentOdometer, which manual updates / maintenance logs can raise and
// ! nothing can lower (DEF-12), and which would also refuse legitimate backdated entries (spec 26).
// ! Same-timestamp ties count as "earlier", so entry order breaks the tie (spec 48)
const assertOdometerInSequence = async (
  bike: { id: string; initialOdometer: number },
  entry: { reading: number; date: Date; excludeId?: string },
) => {
  const base = {
    bikeId: bike.id,
    isDeleted: false,
    ...(entry.excludeId ? { id: { not: entry.excludeId } } : {}),
  };

  const [earlier, later] = await Promise.all([
    prisma.fuelLog.aggregate({
      where: { ...base, date: { lte: entry.date } },
      _max: { odometerReading: true },
    }),
    prisma.fuelLog.aggregate({
      where: { ...base, date: { gt: entry.date } },
      _min: { odometerReading: true },
    }),
  ]);

  const lowerBound = Math.max(
    bike.initialOdometer,
    earlier._max.odometerReading ?? bike.initialOdometer,
  );

  if (entry.reading < lowerBound) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer reading (${entry.reading} km) can't be lower than the previous reading (${lowerBound} km)`,
    );
  }

  const upperBound = later._min.odometerReading;
  if (upperBound !== null && entry.reading > upperBound) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer reading (${entry.reading} km) can't be higher than a later fuel log's reading (${upperBound} km)`,
    );
  }
};

const createFuelLogIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TFuelLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const date = payload.date ?? new Date();

  if (date < bike.purchaseDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`,
    );
  }

  const odometerReading = payload.odometerReading as number;

  // ! validate and pre-compute the closure BEFORE the insert: a rejected request must leave no
  // ! orphan fuel log behind and must not bump the bike's odometer (spec 48 §D)
  await assertOdometerInSequence(bike, { reading: odometerReading, date });

  let periodStartOdometer = bike.initialOdometer;
  let periodStartDate: Date | null = null;
  let distanceKm = 0;

  if (payload.isFullTank) {
    const previousFullTank = await prisma.fuelLog.findFirst({
      where: {
        bikeId,
        isFullTank: true,
        date: { lt: date },
        isDeleted: false,
      },
      orderBy: { date: "desc" },
    });

    if (previousFullTank) {
      periodStartOdometer = previousFullTank.odometerReading;
      periodStartDate = previousFullTank.date;
    }
    // ! else: no prior full-tank fill exists yet — anchor on the bike's immutable initial
    // ! odometer reading, NOT currentOdometer (which is bumped below and would always equal
    // ! this fuel log's own reading, collapsing distanceKm to 0)
    // ! no lower date bound either (periodStartDate stays null) — this is the bike's
    // ! first-ever closed period, so every fuel log dated on/before this fill belongs to it.
    // ! bike.createdAt (when the DB record was inserted) is NOT a valid anchor: backdating fuel
    // ! history right after creating a bike is a normal, supported flow, and a backdated log's
    // ! date is almost always before bike.createdAt, which used to invert this query's range
    // ! and silently zero out the whole period (see spec 26).

    distanceKm = odometerReading - periodStartOdometer;

    // ! unreachable while assertOdometerInSequence holds — guards against a negative-distance
    // ! mileage record ever being written again (DEF-04, spec 48)
    if (distanceKm < 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Odometer reading is lower than the previous full-tank fill",
      );
    }
  }

  const totalCost = (payload.litersAdded ?? 0) * (payload.pricePerLiter ?? 0);

  const fuelLog = await prisma.fuelLog.create({
    data: {
      id: generateObjectId(),
      bikeId,
      odometerReading,
      litersAdded: payload.litersAdded as number,
      isFullTank: payload.isFullTank as boolean,
      pricePerLiter: payload.pricePerLiter as number,
      totalCost,
      fuelStation: payload.fuelStation,
      date,
      notes: payload.notes,
    },
  });

  await bumpOdometerIfHigher(bike, fuelLog.odometerReading);

  let mileageRecordClosed = null;

  // ! a 0 km period (e.g. the first full-tank fill made exactly at the bike's initial odometer)
  // ! has no meaningful km/l — keep the fuel log as the baseline for the next period but write
  // ! no MileageRecord (spec 48 §C)
  if (fuelLog.isFullTank && distanceKm > 0) {
    const periodFuelLogs = await prisma.fuelLog.findMany({
      where: {
        bikeId,
        // ! gt, not gte — periodStartDate is the PREVIOUS closing full-tank fill's date;
        // ! its liters already belong to the prior period and must not be double-counted here
        date: periodStartDate
          ? { gt: periodStartDate, lte: fuelLog.date }
          : { lte: fuelLog.date },
        isDeleted: false,
      },
      orderBy: { date: "asc" },
    });

    const litersConsumed = periodFuelLogs.reduce(
      (sum, log) => sum + log.litersAdded,
      0,
    );

    const mileageKmPerLiter =
      litersConsumed > 0 ? distanceKm / litersConsumed : 0;

    const fuelLogIds = periodFuelLogs.map((log) => log.id);

    // ! for the first-ever period, derive the displayed start from the earliest fuel log
    // ! actually in it — reflects real fuel-log history instead of the bike's own creation
    // ! moment. periodFuelLogs[0] can't actually be undefined here (the just-created
    // ! fuelLog always satisfies its own lte bound), the createdAt fallback is defensive only.
    const resolvedPeriodStartDate =
      periodStartDate ?? periodFuelLogs[0]?.date ?? bike.createdAt;

    mileageRecordClosed = await prisma.mileageRecord.create({
      data: {
        id: generateObjectId(),
        bikeId,
        startOdometer: periodStartOdometer,
        endOdometer: fuelLog.odometerReading,
        distanceKm,
        litersConsumed,
        mileageKmPerLiter,
        periodStartDate: resolvedPeriodStartDate,
        periodEndDate: fuelLog.date,
        fuelLogIds,
      },
    });
  }

  return {
    fuelLog: toApiShape(fuelLog),
    // ! both clients require TMileageRecordClosed.bike: string alongside _id (spec 33 decision A)
    mileageRecordClosed: mileageRecordClosed
      ? { ...mileageRecordClosed, _id: mileageRecordClosed.id, bike: mileageRecordClosed.bikeId }
      : null,
    bikeNickname: bike.nickname,
  };
};

const getFuelLogsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach buildPrismaListQuery —
  // ! it merges whatever's left in query as equality filters, and an unsanitized `?bike=<otherBikeId>`
  // ! would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const { where, orderBy, skip, take } = buildPrismaListQuery({
    baseWhere: { bikeId, isDeleted: false },
    query: sanitizedQuery,
    defaultSort: "-date",
  });

  const [result, meta] = await Promise.all([
    prisma.fuelLog.findMany({ where, orderBy, skip, take }),
    prisma.fuelLog.count({ where }),
  ]);

  return { result: result.map(toApiShape), meta };
};

const getFuelLogByIdFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const fuelLog = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  return toApiShape(fuelLog);
};

const updateFuelLogInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TFuelLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (payload.date && payload.date < bike.purchaseDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`,
    );
  }

  const isLocked = await prisma.mileageRecord.findFirst({
    where: { fuelLogIds: { has: id } },
  });

  if (isLocked) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This fuel log is part of a closed mileage record and can't be edited",
    );
  }

  const fuelLog = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  // ! re-check the odometer ordering whenever the reading or the date moves; excludeId keeps a
  // ! log from conflicting with itself, so correcting a typo on the newest log still works (spec 48)
  if (payload.odometerReading !== undefined || payload.date !== undefined) {
    await assertOdometerInSequence(bike, {
      reading: payload.odometerReading ?? fuelLog.odometerReading,
      date: payload.date ?? fuelLog.date,
      excludeId: id,
    });
  }

  // ! totalCost is always server-derived — never trust a client-submitted value directly
  delete payload.totalCost;

  const updateData: Record<string, unknown> = { ...payload };

  if (payload.litersAdded !== undefined || payload.pricePerLiter !== undefined) {
    const newLiters = payload.litersAdded ?? fuelLog.litersAdded;
    // ! fuelLog.pricePerLiter off a freshly-fetched Prisma row is a Prisma.Decimal
    // ! instance, not a plain number — multiplying it directly is unreliable, convert first
    const newPrice = payload.pricePerLiter ?? Number(fuelLog.pricePerLiter);
    updateData.totalCost = newLiters * newPrice;
  }

  const updated = await prisma.fuelLog.update({
    where: { id: fuelLog.id },
    data: updateData,
  });

  // ! keep bike.currentOdometer in step when an edit raises the reading (create already bumps);
  // ! a no-op when it was lowered — nothing rolls the odometer back (DEF-12, out of scope)
  if (payload.odometerReading !== undefined) {
    await bumpOdometerIfHigher(bike, updated.odometerReading);
  }

  return toApiShape(updated);
};

const deleteFuelLogFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const isLocked = await prisma.mileageRecord.findFirst({
    where: { fuelLogIds: { has: id } },
  });

  if (isLocked) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This fuel log is part of a closed mileage record and can't be deleted",
    );
  }

  const fuelLog = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  const updated = await prisma.fuelLog.update({
    where: { id: fuelLog.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

const uploadFuelLogImageIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  file: Express.Multer.File | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const fuelLog = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  const existingReceiptImage = fuelLog.receiptImage as {
    url: string;
    publicId: string;
  } | null;

  if (existingReceiptImage) {
    await deleteCloudinaryImage(existingReceiptImage.publicId);
  }

  const updated = await prisma.fuelLog.update({
    where: { id: fuelLog.id },
    data: { receiptImage: { url: file.path, publicId: file.filename } },
  });

  return toApiShape(updated);
};

const deleteFuelLogImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const fuelLog = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  const existingReceiptImage = fuelLog.receiptImage as {
    url: string;
    publicId: string;
  } | null;

  if (!existingReceiptImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Receipt image not found");
  }

  await deleteCloudinaryImage(existingReceiptImage.publicId);

  const updated = await prisma.fuelLog.update({
    where: { id: fuelLog.id },
    data: { receiptImage: Prisma.JsonNull },
  });

  return toApiShape(updated);
};

export const fuelLogServices = {
  createFuelLogIntoDB,
  getFuelLogsFromDB,
  getFuelLogByIdFromDB,
  updateFuelLogInDB,
  deleteFuelLogFromDB,
  uploadFuelLogImageIntoDB,
  deleteFuelLogImageFromDB,
};
