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

  const totalCost = (payload.litersAdded ?? 0) * (payload.pricePerLiter ?? 0);

  const fuelLog = await prisma.fuelLog.create({
    data: {
      id: generateObjectId(),
      bikeId,
      odometerReading: payload.odometerReading as number,
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

  if (fuelLog.isFullTank) {
    const previousFullTank = await prisma.fuelLog.findFirst({
      where: {
        bikeId,
        isFullTank: true,
        date: { lt: fuelLog.date },
        isDeleted: false,
      },
      orderBy: { date: "desc" },
    });

    let periodStartOdometer: number;
    let periodStartDate: Date | null;

    if (previousFullTank) {
      periodStartOdometer = previousFullTank.odometerReading;
      periodStartDate = previousFullTank.date;
    } else {
      // ! no prior full-tank fill exists yet — anchor on the bike's immutable initial
      // ! odometer reading, NOT currentOdometer (which was just bumped above and would
      // ! always equal this fuel log's own reading, collapsing distanceKm to 0)
      periodStartOdometer = bike.initialOdometer;
      // ! no lower date bound — this is the bike's first-ever closed period, so every
      // ! fuel log dated on/before this fill belongs to it. bike.createdAt (when the DB
      // ! record was inserted) is NOT a valid anchor: backdating fuel history right after
      // ! creating a bike is a normal, supported flow, and a backdated log's date is
      // ! almost always before bike.createdAt, which used to invert this query's range
      // ! and silently zero out the whole period (see spec 26).
      periodStartDate = null;
    }

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

    const distanceKm = fuelLog.odometerReading - periodStartOdometer;
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

  // ! totalCost is always server-derived — never trust a client-submitted value directly
  delete payload.totalCost;

  const updateData: Record<string, unknown> = { ...payload };

  if (payload.litersAdded !== undefined || payload.pricePerLiter !== undefined) {
    const existing = await prisma.fuelLog.findFirst({
      where: { id, bikeId },
    });
    if (existing) {
      const newLiters = payload.litersAdded ?? existing.litersAdded;
      // ! existing.pricePerLiter off a freshly-fetched Prisma row is a Prisma.Decimal
      // ! instance, not a plain number — multiplying it directly is unreliable, convert first
      const newPrice = payload.pricePerLiter ?? Number(existing.pricePerLiter);
      updateData.totalCost = newLiters * newPrice;
    }
  }

  const fuelLog = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  const updated = await prisma.fuelLog.update({
    where: { id: fuelLog.id },
    data: updateData,
  });

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
