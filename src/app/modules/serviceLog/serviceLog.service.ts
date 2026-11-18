import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { deleteCloudinaryImage } from "../../util/cloudinary";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import {
  TServiceItem,
  TServiceLog,
  TServiceRecommendation,
} from "./serviceLog.interface";
import {
  deriveStatus,
  nextWarrantyNumber,
  round2,
  summarizeWarranty,
  sumItemCosts,
} from "./serviceLog.utils";

type ServiceLogRow = Prisma.ServiceLogGetPayload<object>;

// ! Normalize before store: item costs rounded to 2dp (JSON numbers, not Decimal), every
// ! entry given a stable id. A zero/absent cost becomes 0, never NaN.
const toStorableItems = (
  items?: TServiceItem[] | null,
): Prisma.InputJsonValue =>
  (items ?? []).map((item) => ({
    id: item?.id ?? generateObjectId(),
    name: item.name,
    cost: Number.isFinite(Number(item?.cost)) ? round2(Number(item.cost)) : 0,
  }));

// ! `targetDate` is serialized to an ISO string — a JSON column cannot hold a Date, and the
// ! reminder builder reads it back with `new Date(...)`. `done` defaults to false.
const toStorableRecommendations = (
  recs?: TServiceRecommendation[] | null,
): Prisma.InputJsonValue =>
  (recs ?? []).map((rec) => ({
    id: rec?.id ?? generateObjectId(),
    text: rec.text,
    targetDate: rec?.targetDate ? new Date(rec.targetDate).toISOString() : null,
    targetOdometer:
      rec?.targetOdometer != null ? Number(rec.targetOdometer) : null,
    done: rec?.done ?? false,
  }));

// mirrors engineOilLog's toApiShape: the _id/bike remap. Item costs are already Numbers in
// the JSON, but re-coerced defensively so a hand-tampered row can never leak a Decimal-like
// string into a client's arithmetic.
const toApiShape = (log: ServiceLogRow) => {
  const items = ((log.items as TServiceItem[] | null) ?? []).map((i) => ({
    ...i,
    cost: Number(i?.cost ?? 0),
  }));
  return {
    ...log,
    _id: log.id,
    bike: log.bikeId,
    items,
    recommendations:
      (log.recommendations as TServiceRecommendation[] | null) ?? [],
  };
};

const createServiceLogIntoDB = async (
  bikeId: string,
  userId: string,
  payload: TServiceLog,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const serviceKind = payload.serviceKind ?? "regular";
  const status = deriveStatus(payload.serviceDate);

  // ! auto-assign the warranty number only for a warranty service that omits it — one past
  // ! however many warranty rows already exist (spec 67). A regular service never gets one.
  let warrantyNumber: number | null = null;
  if (serviceKind === "warranty") {
    if (payload.warrantyNumber != null) {
      warrantyNumber = payload.warrantyNumber;
    } else {
      const existing = await prisma.serviceLog.count({
        where: { bikeId, isDeleted: false, serviceKind: "warranty" },
      });
      warrantyNumber = nextWarrantyNumber(existing);
    }
  }

  const log = await prisma.serviceLog.create({
    data: {
      id: generateObjectId(),
      bikeId,
      serviceKind,
      warrantyNumber,
      status,
      dueDate: payload.dueDate ?? null,
      serviceDate: payload.serviceDate ?? null,
      odometerReading: payload.odometerReading ?? null,
      serviceCenter: payload.serviceCenter ?? null,
      centerType: payload.centerType ?? null,
      items: toStorableItems(payload.items),
      recommendations: toStorableRecommendations(payload.recommendations),
      notes: payload.notes ?? null,
    },
  });

  // ! a completed service with a reading can only move the odometer forward (atomic
  // ! conditional write, specs 45/49) — a scheduled/upcoming service carries no reading.
  if (status === "completed" && payload.odometerReading != null) {
    await bumpOdometerIfHigher(bike, payload.odometerReading);
  }

  const itemTotal = sumItemCosts(payload.items);

  return {
    log: toApiShape(log),
    bikeNickname: bike.nickname,
    // ! the controller fires the expense push exactly when a service first becomes
    // ! completed AND carries a cost — a free or still-scheduled service pushes nothing.
    justCompleted: status === "completed",
    itemTotal,
  };
};

const getServiceLogsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" before buildPrismaListQuery merges leftover
  // ! keys as equality filters — an `?bike=<otherId>` would otherwise override the scope.
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const { where, orderBy, skip, take } = buildPrismaListQuery({
    baseWhere: { bikeId, isDeleted: false },
    query: sanitizedQuery,
    defaultSort: "-serviceDate",
  });

  const [result, meta] = await Promise.all([
    prisma.serviceLog.findMany({ where, orderBy, skip, take }),
    prisma.serviceLog.count({ where }),
  ]);

  return { result: result.map(toApiShape), meta };
};

const getServiceLogByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.serviceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Service log not found");
  }

  return toApiShape(log);
};

const updateServiceLogInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: TServiceLog,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const existing = await prisma.serviceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Service log not found");
  }

  const updateData: Prisma.ServiceLogUpdateInput = {};

  if (payload.serviceKind !== undefined)
    updateData.serviceKind = payload.serviceKind;
  if (payload.warrantyNumber !== undefined)
    updateData.warrantyNumber = payload.warrantyNumber;
  if (payload.dueDate !== undefined) updateData.dueDate = payload.dueDate;
  if (payload.serviceDate !== undefined)
    updateData.serviceDate = payload.serviceDate;
  if (payload.odometerReading !== undefined)
    updateData.odometerReading = payload.odometerReading;
  if (payload.serviceCenter !== undefined)
    updateData.serviceCenter = payload.serviceCenter;
  if (payload.centerType !== undefined)
    updateData.centerType = payload.centerType;
  if (payload.notes !== undefined) updateData.notes = payload.notes;
  if (payload.items !== undefined)
    updateData.items = toStorableItems(payload.items);
  if (payload.recommendations !== undefined)
    updateData.recommendations = toStorableRecommendations(
      payload.recommendations,
    );

  // ! re-derive status whenever serviceDate moves (set → completed, cleared → upcoming);
  // ! a payload that doesn't touch serviceDate leaves status as it was.
  const effectiveServiceDate =
    payload.serviceDate !== undefined
      ? payload.serviceDate
      : existing.serviceDate;
  const newStatus = deriveStatus(effectiveServiceDate);
  updateData.status = newStatus;

  const updated = await prisma.serviceLog.update({
    where: { id: existing.id },
    data: updateData,
  });

  if (updated.status === "completed" && updated.odometerReading != null) {
    await bumpOdometerIfHigher(bike, updated.odometerReading);
  }

  // ! fire the expense push only on the upcoming → completed TRANSITION, so editing an
  // ! already-completed service does not re-push. expenseTracker2 also dedupes on
  // ! sourceRecordId (the service id), but the transition gate keeps it clean at the source.
  const justCompleted =
    existing.status !== "completed" && updated.status === "completed";
  const itemTotal = sumItemCosts(
    (updated.items as TServiceItem[] | null) ?? undefined,
  );

  return {
    log: toApiShape(updated),
    bikeNickname: bike.nickname,
    justCompleted,
    itemTotal,
  };
};

const deleteServiceLogFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.serviceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Service log not found");
  }

  const updated = await prisma.serviceLog.update({
    where: { id: log.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

// GET /status — warranty progress. Derived live from every non-deleted service row; nothing
// is stored, so a service logged or completed moments ago is reflected on the next request.
const getServiceStatusFromDB = async (bikeId: string, userId: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const rows = await prisma.serviceLog.findMany({
    where: { bikeId, isDeleted: false },
    select: {
      serviceKind: true,
      status: true,
      warrantyNumber: true,
      dueDate: true,
    },
  });

  return summarizeWarranty(rows, new Date());
};

const uploadServiceLogImageIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  file: Express.Multer.File | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const log = await prisma.serviceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Service log not found");
  }

  const existingImage = log.serviceImage as {
    url: string;
    publicId: string;
  } | null;

  if (existingImage) {
    await deleteCloudinaryImage(existingImage.publicId);
  }

  const updated = await prisma.serviceLog.update({
    where: { id: log.id },
    data: { serviceImage: { url: file.path, publicId: file.filename } },
  });

  return toApiShape(updated);
};

const deleteServiceLogImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.serviceLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Service log not found");
  }

  const existingImage = log.serviceImage as {
    url: string;
    publicId: string;
  } | null;

  if (!existingImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Receipt image not found");
  }

  await deleteCloudinaryImage(existingImage.publicId);

  const updated = await prisma.serviceLog.update({
    where: { id: log.id },
    data: { serviceImage: Prisma.JsonNull },
  });

  return toApiShape(updated);
};

export const serviceLogServices = {
  createServiceLogIntoDB,
  getServiceLogsFromDB,
  getServiceLogByIdFromDB,
  updateServiceLogInDB,
  deleteServiceLogFromDB,
  getServiceStatusFromDB,
  uploadServiceLogImageIntoDB,
  deleteServiceLogImageFromDB,
};
