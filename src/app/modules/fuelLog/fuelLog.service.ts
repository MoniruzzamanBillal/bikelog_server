import { TFuelLog } from "./fuelLog.interface";
import { fuelLogModel } from "./fuelLog.model";
import { mileageRecordModel } from "../mileageRecord/mileageRecord.model";
import { TBikeDocument } from "../bike/bike.model";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import { deleteCloudinaryImage } from "../../util/cloudinary";

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

  const fuelLogData = {
    ...payload,
    bike: bikeId,
    totalCost,
    date,
  };

  const fuelLog = await fuelLogModel.create(fuelLogData);

  await bumpOdometerIfHigher(bike as TBikeDocument, fuelLog.odometerReading);

  let mileageRecordClosed = null;

  if (fuelLog.isFullTank) {
    const previousFullTank = await fuelLogModel
      .findOne({
        bike: bikeId,
        isFullTank: true,
        date: { $lt: fuelLog.date },
        isDeleted: false,
      })
      .sort({ date: -1 })
      .lean();

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

    const periodFuelLogs = await fuelLogModel
      .find({
        bike: bikeId,
        // ! $gt, not $gte — periodStartDate is the PREVIOUS closing full-tank fill's date;
        // ! its liters already belong to the prior period and must not be double-counted here
        date: periodStartDate
          ? { $gt: periodStartDate, $lte: fuelLog.date }
          : { $lte: fuelLog.date },
        isDeleted: false,
      })
      .sort({ date: 1 })
      .lean();

    const litersConsumed = periodFuelLogs.reduce(
      (sum, log) => sum + log.litersAdded,
      0,
    );

    const distanceKm = fuelLog.odometerReading - periodStartOdometer;
    const mileageKmPerLiter =
      litersConsumed > 0 ? distanceKm / litersConsumed : 0;

    const fuelLogIds = periodFuelLogs.map((log) => log._id);

    // ! for the first-ever period, derive the displayed start from the earliest fuel log
    // ! actually in it — reflects real fuel-log history instead of the bike's own creation
    // ! moment. periodFuelLogs[0] can't actually be undefined here (the just-created
    // ! fuelLog always satisfies its own $lte bound), the createdAt fallback is defensive only.
    const resolvedPeriodStartDate =
      periodStartDate ?? periodFuelLogs[0]?.date ?? (bike as TBikeDocument).createdAt;

    mileageRecordClosed = await mileageRecordModel.create({
      bike: bikeId,
      startOdometer: periodStartOdometer,
      endOdometer: fuelLog.odometerReading,
      distanceKm,
      litersConsumed,
      mileageKmPerLiter,
      periodStartDate: resolvedPeriodStartDate,
      periodEndDate: fuelLog.date,
      fuelLogIds,
    });
  }

  return { fuelLog, mileageRecordClosed };
};

const getFuelLogsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
  // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
  // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const fuelLogsQuery = new QueryBuilder(
    fuelLogModel.find({ bike: bikeId, isDeleted: false }),
    sanitizedQuery,
  )
    .filter()
    .sort("-date")
    .pagination()
    .field();

  const result = await fuelLogsQuery.queryModel;
  const meta = await fuelLogsQuery.countTotal();

  return { result, meta };
};

const getFuelLogByIdFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const fuelLog = await fuelLogModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  return fuelLog;
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

  const existsInMileageRecord = await mileageRecordModel.exists({
    fuelLogIds: id,
  });

  if (existsInMileageRecord) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This fuel log is part of a closed mileage record and can't be edited",
    );
  }

  // ! totalCost is always server-derived — never trust a client-submitted value directly
  delete payload.totalCost;

  if (payload.litersAdded !== undefined || payload.pricePerLiter !== undefined) {
    const fuelLog = await fuelLogModel.findOne({ _id: id, bike: bikeId });
    if (fuelLog) {
      const newLiters = payload.litersAdded ?? fuelLog.litersAdded;
      const newPrice = payload.pricePerLiter ?? fuelLog.pricePerLiter;
      payload.totalCost = newLiters * newPrice;
    }
  }

  const fuelLog = await fuelLogModel.findOneAndUpdate(
    { _id: id, bike: bikeId, isDeleted: false },
    payload,
    { new: true, runValidators: true },
  );

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  return fuelLog;
};

const deleteFuelLogFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const existsInMileageRecord = await mileageRecordModel.exists({
    fuelLogIds: id,
  });

  if (existsInMileageRecord) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This fuel log is part of a closed mileage record and can't be deleted",
    );
  }

  const fuelLog = await fuelLogModel.findOneAndUpdate(
    { _id: id, bike: bikeId, isDeleted: false },
    { isDeleted: true },
    { new: true },
  );

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  return fuelLog;
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

  const fuelLog = await fuelLogModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  if (fuelLog.receiptImage) {
    await deleteCloudinaryImage(fuelLog.receiptImage.publicId);
  }

  fuelLog.receiptImage = { url: file.path, publicId: file.filename };
  await fuelLog.save();

  return fuelLog;
};

const deleteFuelLogImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const fuelLog = await fuelLogModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!fuelLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");
  }

  if (!fuelLog.receiptImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Receipt image not found");
  }

  await deleteCloudinaryImage(fuelLog.receiptImage.publicId);

  fuelLog.receiptImage = undefined;
  await fuelLog.save();

  return fuelLog;
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