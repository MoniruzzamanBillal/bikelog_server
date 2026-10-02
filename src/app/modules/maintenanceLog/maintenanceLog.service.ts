import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import { TMaintenanceLog } from "./maintenanceLog.interface";
import { deleteCloudinaryImage } from "../../util/cloudinary";

// ! Spec 41 §B: every read that returns a log populates its two catalog relations, so the
// ! display name travels with the log instead of being joined client-side against the
// ! catalog list. That join broke once the list endpoints started hiding soft-deleted rows
// ! (spec 41 §D) — a historical log's type would silently relabel to "Maintenance".
// ! Deliberately NO `isDeleted` filter here: a log must still resolve the name of a type
// ! that has since been deleted. That is the entire point of this include.
const catalogInclude = {
  maintenanceType: { select: { id: true, name: true } },
  oilType: { select: { id: true, name: true } },
} as const;

// every returned maintenance log gets three FK renames (not just _id/bike — spec 34
// decision A) plus Decimal->Number conversion for cost
const toApiShape = <
  T extends {
    id: string;
    bikeId: string;
    maintenanceTypeId: string;
    oilTypeId: string | null;
    cost: unknown;
    maintenanceType?: { id: string; name: string } | null;
    oilType?: { id: string; name: string } | null;
  },
>(
  log: T,
) => ({
  ...log,
  _id: log.id,
  bike: log.bikeId,
  // ! Populated when the caller passed `catalogInclude`; falls back to the bare id string
  // ! so an un-included read still returns the pre-spec-41 shape rather than undefined.
  // ! Both clients already accept either form (a surviving Mongoose-populate branch).
  maintenanceType: log.maintenanceType
    ? { _id: log.maintenanceType.id, name: log.maintenanceType.name }
    : log.maintenanceTypeId,
  // ! `oilTypeId` stays `null` (not `undefined`) when absent — preserving the existing
  // ! wire contract exactly. `undefined` would drop the key from the JSON entirely.
  oilType: log.oilType
    ? { _id: log.oilType.id, name: log.oilType.name }
    : log.oilTypeId,
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

  // ! Spec 41 §G: findFirst, not findUnique — `isDeleted` is not a unique field, so
  // ! findUnique will not accept it in `where`. A soft-deleted catalog row must be
  // ! unreachable to new writes, otherwise the FK succeeds and a log points at a type the
  // ! user can no longer see.
  const maintenanceType = await prisma.maintenanceType.findFirst({
    where: { id: payload.maintenanceType, isDeleted: false },
  });
  if (!maintenanceType) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }

  if (payload.oilType) {
    const oilType = await prisma.engineOilType.findFirst({
      where: { id: payload.oilType, isDeleted: false },
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
    include: catalogInclude,
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
    prisma.maintenanceLog.findMany({
      where,
      orderBy,
      skip,
      take,
      include: catalogInclude,
    }),
    prisma.maintenanceLog.count({ where }),
  ]);

  return { result: result.map(toApiShape), meta };
};

const getMaintenanceLogByIdFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.maintenanceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
    include: catalogInclude,
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
    const maintenanceType = await prisma.maintenanceType.findFirst({
      where: { id: payload.maintenanceType, isDeleted: false },
    });
    if (!maintenanceType) {
      throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
    }
  }

  if (payload.oilType) {
    const oilType = await prisma.engineOilType.findFirst({
      where: { id: payload.oilType, isDeleted: false },
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
    include: catalogInclude,
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
    include: catalogInclude,
  });

  return toApiShape(updated);
};

const getRemindersFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const logs = await prisma.maintenanceLog.findMany({
    where: { bikeId, isDeleted: false },
    orderBy: { serviceDate: "desc" },
    include: catalogInclude,
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
    // ! Spec 41 §C: was a bare id string, which both clients' own TReminder type always
    // ! declared as { _id, name } — the mismatch logged in progress-tracker.md's Known
    // ! Gaps since spec 34 §E. Populating it closes that gap and is what keeps the
    // ! clients' reminder banners correct for a type that has since been soft-deleted.
    maintenanceType: { _id: string; name: string };
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
        maintenanceType: { _id: string; name: string };
        lastServiceDate: Date;
        lastOdometerReading: number;
        nextDueOdometer?: number;
        nextDueDate?: Date;
        status: "overdue" | "upcoming";
        kmRemaining?: number;
        daysRemaining?: number;
      } = {
        maintenanceType: {
          _id: log.maintenanceTypeId,
          name: log.maintenanceType.name,
        },
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
    include: catalogInclude,
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
    include: catalogInclude,
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
