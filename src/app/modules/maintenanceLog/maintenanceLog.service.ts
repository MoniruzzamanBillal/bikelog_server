import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import { TMaintenanceLog } from "./maintenanceLog.interface";
import { deleteCloudinaryImage } from "../../util/cloudinary";

// every returned maintenance log gets three FK renames (not just _id/bike — spec 34
// decision A) plus Decimal->Number conversion for cost
const toApiShape = <
  T extends {
    id: string;
    bikeId: string;
    maintenanceTypeId: string;
    oilTypeId: string | null;
    cost: unknown;
  },
>(
  log: T,
) => ({
  ...log,
  _id: log.id,
  bike: log.bikeId,
  maintenanceType: log.maintenanceTypeId,
  oilType: log.oilTypeId,
  cost: Number(log.cost),
});

const computeNextDueOdometer = (odometerReading: number, intervalKmUsed: number): number => {
  return odometerReading + intervalKmUsed;
};

const createMaintenanceLogIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TMaintenanceLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const maintenanceType = await prisma.maintenanceType.findUnique({
    where: { id: payload.maintenanceType },
  });
  if (!maintenanceType) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }

  if (payload.oilType) {
    const oilType = await prisma.engineOilType.findUnique({
      where: { id: payload.oilType },
    });
    if (!oilType) {
      throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
    }
  }

  const nextDueOdometer =
    payload.intervalKmUsed !== undefined
      ? computeNextDueOdometer(payload.odometerReading!, payload.intervalKmUsed)
      : undefined;

  const log = await prisma.maintenanceLog.create({
    data: {
      id: generateObjectId(),
      bikeId,
      maintenanceTypeId: payload.maintenanceType as string,
      oilTypeId: payload.oilType,
      odometerReading: payload.odometerReading as number,
      intervalKmUsed: payload.intervalKmUsed,
      nextDueOdometer,
      nextDueDate: payload.nextDueDate,
      cost: payload.cost as number,
      serviceDate: payload.serviceDate ?? new Date(),
      serviceCenter: payload.serviceCenter,
      partsReplaced: payload.partsReplaced ?? [],
      notes: payload.notes,
    },
  });

  await bumpOdometerIfHigher(bike, payload.odometerReading!);

  return {
    log: toApiShape(log),
    maintenanceTypeName: maintenanceType.name,
    bikeNickname: bike.nickname,
  };
};

const getMaintenanceLogsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach buildPrismaListQuery —
  // ! it merges whatever's left in query as equality filters, and an unsanitized
  // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const { where, orderBy, skip, take } = buildPrismaListQuery({
    baseWhere: { bikeId, isDeleted: false },
    query: sanitizedQuery,
    defaultSort: "-serviceDate",
  });

  const [result, meta] = await Promise.all([
    prisma.maintenanceLog.findMany({ where, orderBy, skip, take }),
    prisma.maintenanceLog.count({ where }),
  ]);

  return { result: result.map(toApiShape), meta };
};

const getMaintenanceLogByIdFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.maintenanceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  return toApiShape(log);
};

const updateMaintenanceLogInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TMaintenanceLog>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.maintenanceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  if (payload.maintenanceType) {
    const maintenanceType = await prisma.maintenanceType.findUnique({
      where: { id: payload.maintenanceType },
    });
    if (!maintenanceType) {
      throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
    }
  }

  if (payload.oilType) {
    const oilType = await prisma.engineOilType.findUnique({
      where: { id: payload.oilType },
    });
    if (!oilType) {
      throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
    }
  }

  const updateData: Record<string, unknown> = { ...payload };
  delete updateData.nextDueOdometer;
  // ! client sends maintenanceType/oilType (plain id strings) — the Prisma column
  // ! names are maintenanceTypeId/oilTypeId, remap before handing off to update()
  if ("maintenanceType" in updateData) {
    updateData.maintenanceTypeId = updateData.maintenanceType;
    delete updateData.maintenanceType;
  }
  if ("oilType" in updateData) {
    updateData.oilTypeId = updateData.oilType;
    delete updateData.oilType;
  }

  const newOdometer = payload.odometerReading ?? log.odometerReading;
  const newInterval = payload.intervalKmUsed ?? log.intervalKmUsed ?? undefined;
  if (
    (payload.odometerReading !== undefined || payload.intervalKmUsed !== undefined) &&
    newInterval !== undefined
  ) {
    updateData.nextDueOdometer = computeNextDueOdometer(newOdometer, newInterval);
  }

  const updated = await prisma.maintenanceLog.update({
    where: { id: log.id },
    data: updateData,
  });

  return toApiShape(updated);
};

const deleteMaintenanceLogFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.maintenanceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  const updated = await prisma.maintenanceLog.update({
    where: { id: log.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

const getRemindersFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const logs = await prisma.maintenanceLog.findMany({
    where: { bikeId, isDeleted: false },
    orderBy: { serviceDate: "desc" },
  });

  // ! log.maintenanceTypeId is already a plain string off a Prisma row — no .toString()
  // ! coercion needed (that was only ever undoing a Mongoose ObjectId)
  const latestPerType = new Map<string, (typeof logs)[0]>();
  for (const log of logs) {
    const key = log.maintenanceTypeId;
    if (!latestPerType.has(key)) {
      latestPerType.set(key, log);
    }
  }

  const reminders: Array<{
    maintenanceType: string;
    lastServiceDate: Date;
    lastOdometerReading: number;
    nextDueOdometer?: number;
    nextDueDate?: Date;
    status: "overdue" | "upcoming";
    kmRemaining?: number;
    daysRemaining?: number;
  }> = [];

  for (const [, log] of latestPerType) {
    let status: "overdue" | "upcoming" | null = null;
    let kmRemaining: number | undefined;

    if (log.nextDueOdometer !== null) {
      kmRemaining = log.nextDueOdometer - bike.currentOdometer;
      const kmOverdue = kmRemaining <= 0;
      const kmUpcoming = !kmOverdue && kmRemaining <= 50;

      if (kmOverdue) {
        status = "overdue";
      } else if (kmUpcoming) {
        status = "upcoming";
      }
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
        maintenanceType: string;
        lastServiceDate: Date;
        lastOdometerReading: number;
        nextDueOdometer?: number;
        nextDueDate?: Date;
        status: "overdue" | "upcoming";
        kmRemaining?: number;
        daysRemaining?: number;
      } = {
        // ! same pre-existing shape as before the migration (a bare id string, not the
        // ! { _id, name } object the client type declares) — port verbatim, see spec 34 §E
        maintenanceType: log.maintenanceTypeId,
        lastServiceDate: log.serviceDate,
        lastOdometerReading: log.odometerReading,
        status,
      };

      if (log.nextDueOdometer !== null) {
        reminder.nextDueOdometer = log.nextDueOdometer;
        reminder.kmRemaining = Math.max(0, kmRemaining!);
      }

      if (log.nextDueDate) {
        reminder.nextDueDate = log.nextDueDate;
        reminder.daysRemaining = daysRemaining;
      }

      reminders.push(reminder);
    }
  }

  return { reminders };
};

const uploadMaintenanceLogImageIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  file: Express.Multer.File | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const log = await prisma.maintenanceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  const existingServiceImage = log.serviceImage as {
    url: string;
    publicId: string;
  } | null;

  if (existingServiceImage) {
    await deleteCloudinaryImage(existingServiceImage.publicId);
  }

  const updated = await prisma.maintenanceLog.update({
    where: { id: log.id },
    data: { serviceImage: { url: file.path, publicId: file.filename } },
  });

  return toApiShape(updated);
};

const deleteMaintenanceLogImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.maintenanceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
  }

  const existingServiceImage = log.serviceImage as {
    url: string;
    publicId: string;
  } | null;

  if (!existingServiceImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Service image not found");
  }

  await deleteCloudinaryImage(existingServiceImage.publicId);

  const updated = await prisma.maintenanceLog.update({
    where: { id: log.id },
    data: { serviceImage: Prisma.JsonNull },
  });

  return toApiShape(updated);
};

export const maintenanceLogServices = {
  createMaintenanceLogIntoDB,
  getMaintenanceLogsFromDB,
  getMaintenanceLogByIdFromDB,
  updateMaintenanceLogInDB,
  deleteMaintenanceLogFromDB,
  getRemindersFromDB,
  uploadMaintenanceLogImageIntoDB,
  deleteMaintenanceLogImageFromDB,
};
