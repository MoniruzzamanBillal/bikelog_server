import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { AccessoryStatus, TAccessoryStatus } from "./bikeAccessory.constant";
import { TBikeAccessory } from "./bikeAccessory.interface";
import { deleteCloudinaryImage } from "../../util/cloudinary";

const toApiShape = <
  T extends { id: string; bikeId: string; price: unknown },
>(
  accessory: T,
) => ({
  ...accessory,
  _id: accessory.id,
  bike: accessory.bikeId,
  price: accessory.price !== null ? Number(accessory.price) : null,
});

const createBikeAccessoryIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeAccessory>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (payload.status === AccessoryStatus.purchased && !payload.price) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Price is required when marking an accessory as purchased",
    );
  }

  const accessory = await prisma.bikeAccessory.create({
    data: {
      id: generateObjectId(),
      bikeId,
      name: payload.name as string,
      urgency: payload.urgency as TBikeAccessory["urgency"],
      status: payload.status,
      price: payload.price,
      ...(payload.status === AccessoryStatus.purchased
        ? { purchaseDate: new Date() }
        : {}),
    },
  });

  return { accessory: toApiShape(accessory), bikeNickname: bike.nickname };
};

const getBikeAccessoriesFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach the filter object —
  // ! an unsanitized `?bike=<otherBikeId>` would otherwise override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const filterQuery: Record<string, unknown> = { ...sanitizedQuery };
  delete filterQuery.searchTerm;
  delete filterQuery.sort;
  delete filterQuery.limit;
  delete filterQuery.page;
  delete filterQuery.fields;

  // ! grouping is done by running one query per status (in the enum's declared order) and
  // ! merging the results, rather than relying on Postgres enum ordering (not guaranteed to
  // ! match declaration order) or a $group-style aggregation (avoided per house style, see
  // ! context/architecture.md) — same strategy spec 13 chose, ported exactly, not "simplified"
  // ! into a single orderBy: [{status: ...}, ...] query
  const statusOrder = Object.values(AccessoryStatus);
  const requestedStatuses: TAccessoryStatus[] =
    typeof filterQuery.status === "string" &&
    (statusOrder as string[]).includes(filterQuery.status)
      ? [filterQuery.status as TAccessoryStatus]
      : statusOrder;
  delete filterQuery.status;

  const sortStr =
    (typeof sanitizedQuery.sort === "string" ? sanitizedQuery.sort : "") ||
    "-createdAt";
  const orderBy = sortStr
    .trim()
    .split(/[\s,]+/)
    .map((field) =>
      field.startsWith("-")
        ? { [field.slice(1)]: "desc" as const }
        : { [field]: "asc" as const },
    );

  const limit = Number(sanitizedQuery.limit) || 10;
  const page = Number(sanitizedQuery.page) || 1;
  const skip = (page - 1) * limit;

  const baseWhere = { bikeId, isDeleted: false, ...filterQuery };

  const resultsByStatus = await Promise.all(
    requestedStatuses.map((status) =>
      prisma.bikeAccessory.findMany({
        where: { ...baseWhere, status },
        orderBy,
      }),
    ),
  );

  const result = resultsByStatus
    .flat()
    .slice(skip, skip + limit)
    .map(toApiShape);

  const meta = await prisma.bikeAccessory.count({
    where: { ...baseWhere, status: { in: requestedStatuses } },
  });

  return { result, meta };
};

const getBikeAccessoryByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  return toApiShape(accessory);
};

const updateBikeAccessoryInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeAccessory>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  // ! once purchased, status is a one-way permanent lock — every other field stays editable
  if (
    accessory.status === AccessoryStatus.purchased &&
    payload.status !== undefined &&
    payload.status !== AccessoryStatus.purchased
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This accessory is already marked as purchased and its status cannot be changed",
    );
  }

  const existingPrice =
    accessory.price !== null ? Number(accessory.price) : undefined;
  const resultingStatus = payload.status ?? accessory.status;
  const resultingPrice = payload.price ?? existingPrice;

  if (resultingStatus === AccessoryStatus.purchased && !resultingPrice) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Price is required when marking an accessory as purchased",
    );
  }

  const updateData: Record<string, unknown> = { ...payload };

  // ! stamp purchaseDate exactly once, at the moment status actually transitions into
  // ! purchased — never re-stamped afterward, since the lock above guarantees this only
  // ! ever fires once per accessory
  const justPurchased =
    accessory.status !== AccessoryStatus.purchased &&
    resultingStatus === AccessoryStatus.purchased;

  if (justPurchased) {
    updateData.purchaseDate = new Date();
  }

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: updateData,
  });

  return {
    accessory: toApiShape(updated),
    justPurchased,
    bikeNickname: bike.nickname,
  };
};

const deleteBikeAccessoryFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

const uploadBikeAccessoryImageIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  file: Express.Multer.File | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  const existingProductImage = accessory.productImage as {
    url: string;
    publicId: string;
  } | null;

  if (existingProductImage) {
    await deleteCloudinaryImage(existingProductImage.publicId);
  }

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: { productImage: { url: file.path, publicId: file.filename } },
  });

  return toApiShape(updated);
};

const deleteBikeAccessoryImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  const existingProductImage = accessory.productImage as {
    url: string;
    publicId: string;
  } | null;

  if (!existingProductImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Product image not found");
  }

  await deleteCloudinaryImage(existingProductImage.publicId);

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: { productImage: Prisma.JsonNull },
  });

  return toApiShape(updated);
};

// ! month-based spending summary for the app's accessories "Purchased" tab (spec 59):
// ! all-time total, current-month total, and a per-month breakdown (newest-first) that
// ! includes every month from the earliest purchase to the current one — empty in-between
// ! months (and an empty current month) are returned with total 0 so the client can render
// ! the gaps without re-deriving the calendar itself.
const getAccessorySpendingSummaryFromDB = async (
  bikeId: string,
  userId: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! only purchased, non-deleted accessories count as real spending — same filter the
  // ! spending module uses (pending/cancelled wishlist entries are never money spent)
  const purchased = await prisma.bikeAccessory.findMany({
    where: { bikeId, isDeleted: false, status: AccessoryStatus.purchased },
    orderBy: { purchaseDate: "desc" },
  });

  // ! "YYYY-MM" in server-local time — same month-boundary convention as
  // ! resolveSpendingDateRange in spending.service.ts (date-fns is not a server dependency)
  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const now = new Date();
  const currentMonth = monthKey(now);

  type TApiAccessory = ReturnType<typeof toApiShape>;
  const buckets = new Map<
    string,
    { total: number; accessories: TApiAccessory[] }
  >();
  let allTimeTotal = 0;
  let earliest: Date | null = null;

  for (const accessory of purchased) {
    // purchaseDate is always stamped on the purchase transition; createdAt is a defensive fallback
    const when = accessory.purchaseDate ?? accessory.createdAt;
    const key = monthKey(when);
    const price = accessory.price !== null ? Number(accessory.price) : 0;

    allTimeTotal += price;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { total: 0, accessories: [] };
      buckets.set(key, bucket);
    }
    bucket.total += price;
    bucket.accessories.push(toApiShape(accessory));

    if (!earliest || when < earliest) {
      earliest = when;
    }
  }

  const currentMonthTotal = buckets.get(currentMonth)?.total ?? 0;

  const months: { month: string; total: number; accessories: TApiAccessory[] }[] =
    [];

  // ! no purchases at all → empty list; the client shows its "wishlist is empty" state
  if (earliest) {
    const rangeStart = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    // walk backwards month-by-month from the current month to the earliest, so the
    // result is newest-first and every month in between is represented
    const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    while (cursor >= rangeStart) {
      const key = monthKey(cursor);
      const bucket = buckets.get(key);
      months.push({
        month: key,
        total: bucket?.total ?? 0,
        accessories: bucket?.accessories ?? [],
      });
      cursor.setMonth(cursor.getMonth() - 1);
    }
  }

  return { allTimeTotal, currentMonth, currentMonthTotal, months };
};

export const bikeAccessoryServices = {
  createBikeAccessoryIntoDB,
  getAccessorySpendingSummaryFromDB,
  getBikeAccessoriesFromDB,
  getBikeAccessoryByIdFromDB,
  updateBikeAccessoryInDB,
  deleteBikeAccessoryFromDB,
  uploadBikeAccessoryImageIntoDB,
  deleteBikeAccessoryImageFromDB,
};
