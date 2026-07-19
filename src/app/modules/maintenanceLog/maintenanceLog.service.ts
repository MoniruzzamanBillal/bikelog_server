import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import { maintenanceTypeModel } from "../maintenanceType/maintenanceType.model";
import { engineOilTypeModel } from "../engineOilType/engineOilType.model";
import { maintenanceLogModel } from "./maintenanceLog.model";
import { TMaintenanceLog } from "./maintenanceLog.interface";

const computeNextDueOdometer = (odometerReading: number, intervalKmUsed: number): number => {
  return odometerReading + intervalKmUsed;
};

const createMaintenanceLogIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TMaintenanceLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const maintenanceType = await maintenanceTypeModel.findById(payload.maintenanceType);
  if (!maintenanceType) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }

  if (payload.oilType) {
    const oilType = await engineOilTypeModel.findById(payload.oilType);
    if (!oilType) {
      throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
    }
  }

  const nextDueOdometer = computeNextDueOdometer(
    payload.odometerReading!,
    payload.intervalKmUsed!,
  );

  const logData = {
    ...payload,
    bike: bikeId,
    nextDueOdometer,
    serviceDate: payload.serviceDate ?? new Date(),
  };

  const log = await maintenanceLogModel.create(logData);

  await bumpOdometerIfHigher(bike, payload.odometerReading!);

  return log;
};

const getMaintenanceLogsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const logsQuery = new QueryBuilder(
    maintenanceLogModel.find({ bike: bikeId, isDeleted: false }),
    query,
  )
    .filter()
    .sort("-serviceDate")
    .pagination()
    .field();

  const result = await logsQuery.queryModel;
  const meta = await logsQuery.countTotal();

  return { result, meta };
};

const getMaintenanceLogByIdFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await maintenanceLogModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  return log;
};

const updateMaintenanceLogInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TMaintenanceLog>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await maintenanceLogModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  if (payload.maintenanceType) {
    const maintenanceType = await maintenanceTypeModel.findById(payload.maintenanceType);
    if (!maintenanceType) {
      throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
    }
  }

  if (payload.oilType) {
    const oilType = await engineOilTypeModel.findById(payload.oilType);
    if (!oilType) {
      throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
    }
  }

  const updateData = { ...payload };
  delete updateData.nextDueOdometer;

  const newOdometer = updateData.odometerReading ?? log.odometerReading;
  const newInterval = updateData.intervalKmUsed ?? log.intervalKmUsed;
  if (updateData.odometerReading !== undefined || updateData.intervalKmUsed !== undefined) {
    updateData.nextDueOdometer = computeNextDueOdometer(newOdometer, newInterval);
  }

  Object.assign(log, updateData);
  await log.save();

  return log;
};

const deleteMaintenanceLogFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await maintenanceLogModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  log.isDeleted = true;
  await log.save();

  return log;
};

const getRemindersFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const logs = await maintenanceLogModel
    .find({ bike: bikeId, isDeleted: false })
    .sort({ serviceDate: -1 })
    .lean();

  const latestPerType = new Map<string, typeof logs[0]>();
  for (const log of logs) {
    const key = log.maintenanceType.toString();
    if (!latestPerType.has(key)) {
      latestPerType.set(key, log);
    }
  }

  const reminders: Array<{
    maintenanceType: typeof logs[0]["maintenanceType"];
    lastServiceDate: Date;
    lastOdometerReading: number;
    nextDueOdometer: number;
    nextDueDate?: Date;
    status: "overdue" | "upcoming";
    kmRemaining: number;
    daysRemaining?: number;
  }> = [];

  for (const [, log] of latestPerType) {
    const kmRemaining = log.nextDueOdometer - bike.currentOdometer;
    const kmOverdue = kmRemaining <= 0;
    const kmUpcoming = !kmOverdue && kmRemaining <= 50;

    let status: "overdue" | "upcoming" | null = null;

    if (kmOverdue) {
      status = "overdue";
    } else if (kmUpcoming) {
      status = "upcoming";
    }

    let daysRemaining: number | undefined;

    if (log.nextDueDate) {
      const msRemaining = log.nextDueDate.getTime() - Date.now();
      daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
      const dateOverdue = msRemaining <= 0;
      const dateUpcoming = !dateOverdue && daysRemaining <= 14;

      if (dateOverdue) {
        status = "overdue";
      } else if (dateUpcoming && !status) {
        status = "upcoming";
      }
    }

    if (status) {
      const reminder: {
        maintenanceType: typeof logs[0]["maintenanceType"];
        lastServiceDate: Date;
        lastOdometerReading: number;
        nextDueOdometer: number;
        nextDueDate?: Date;
        status: "overdue" | "upcoming";
        kmRemaining: number;
        daysRemaining?: number;
      } = {
        maintenanceType: log.maintenanceType,
        lastServiceDate: log.serviceDate,
        lastOdometerReading: log.odometerReading,
        nextDueOdometer: log.nextDueOdometer,
        status,
        kmRemaining: Math.max(0, kmRemaining),
      };

      if (log.nextDueDate) {
        reminder.nextDueDate = log.nextDueDate;
        reminder.daysRemaining = daysRemaining;
      }

      reminders.push(reminder);
    }
  }

  return { reminders };
};

export const maintenanceLogServices = {
  createMaintenanceLogIntoDB,
  getMaintenanceLogsFromDB,
  getMaintenanceLogByIdFromDB,
  updateMaintenanceLogInDB,
  deleteMaintenanceLogFromDB,
  getRemindersFromDB,
};
