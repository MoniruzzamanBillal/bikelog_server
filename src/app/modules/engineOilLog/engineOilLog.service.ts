import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { deleteCloudinaryImage } from "../../util/cloudinary";
import {
  computeFallbackKmPerDay,
  computeKmPerDay,
  DAY_MS,
} from "../../util/ridingRate";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "../bike/bike.utils";
import { findOwnedEngineOilTypeOrThrow } from "../engineOilType/engineOilType.utils";
import { TEngineOilLog, TEngineOilStatus } from "./engineOilLog.interface";
import {
  assertOilOdometerInSequence,
  computeNextDueOdometer,
  evaluateOilDue,
  findLatestEngineOilLog,
} from "./engineOilLog.utils";

// ! Deliberately NO `isDeleted` filter on this include — spec 41's rule, same as
// ! maintenanceLog's `catalogInclude`: a historical log must still resolve the name of a
// ! type that has since been soft-deleted. No owner filter either: both write paths below
// ! only accept a type the bike's owner owns, so a log's oil type is owner-coherent by
// ! construction (spec 46 §D).
const oilTypeInclude = {
  oilType: { select: { id: true, name: true } },
} as const;

// mirrors fuelLog.service.ts's: the _id/bike remap plus Decimal->Number for cost, and the
// catalog relation populated as { _id, name } when it was included
const toApiShape = <
  T extends {
    id: string;
    bikeId: string;
    oilTypeId: string | null;
    cost: unknown;
    oilType?: { id: string; name: string } | null;
  },
>(
  log: T,
) => ({
  ...log,
  _id: log.id,
  bike: log.bikeId,
  // ! falls back to the bare id string when the caller did not include the relation, the
  // ! same two-shape contract maintenanceLog already has
  oilType: log.oilType
    ? { _id: log.oilType.id, name: log.oilType.name }
    : log.oilTypeId,
  cost: Number(log.cost),
});

// ! mirrors fuelLog/maintenanceLog: an oil change can't predate owning the bike (spec 50 §4)
const assertNotBeforePurchase = (changeDate: Date, purchaseDate: Date) => {
  if (changeDate < purchaseDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Engine oil change date cannot be before the bike's purchase date (${purchaseDate.toISOString().split("T")[0]})`,
    );
  }
};

// ! §C: the ORDER of these steps is the point — nothing is written until every check has
// ! passed, so a rejected request leaves no orphan row behind and does not bump the bike's
// ! odometer (spec 48 §D).
const createEngineOilLogIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TEngineOilLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const changeDate = payload.changeDate ?? new Date();
  assertNotBeforePurchase(changeDate, bike.purchaseDate);

  // ! 404 on another user's id, not 403 — this repo's convention (spec 46 §E). Must happen
  // ! on BOTH create and update; spec 46 §D records the update path as the IDOR site people miss.
  const oilType = await findOwnedEngineOilTypeOrThrow(
    payload.oilType as string,
    userId,
  );

  const odometerReading = payload.odometerReading as number;
  await assertOilOdometerInSequence(bike, {
    reading: odometerReading,
    date: changeDate,
  });

  // ! D3: the client normally sends `intervalKmUsed`, pre-filled from the oil type and
  // ! editable by the rider. This `??` is the safety net for callers that omit it (the
  // ! import, Postman, bikelog_app before its half ships) — not the main path. Resolved
  // ! once, here, and then frozen on the row: reading the catalog live on every status
  // ! request would let a catalog edit retroactively move a past change's due point (H6).
  const intervalKmUsed = payload.intervalKmUsed ?? oilType.suggestedIntervalKm;
  const nextDueOdometer =
    intervalKmUsed !== undefined && intervalKmUsed !== null
      ? computeNextDueOdometer(odometerReading, intervalKmUsed)
      : undefined;

  const log = await prisma.engineOilLog.create({
    data: {
      id: generateObjectId(),
      bikeId,
      oilTypeId: oilType.id,
      odometerReading,
      intervalKmUsed,
      nextDueOdometer,
      quantityLiters: payload.quantityLiters,
      oilFilterChanged: payload.oilFilterChanged ?? false,
      cost: payload.cost as number,
      changeDate,
      serviceCenter: payload.serviceCenter,
      notes: payload.notes,
    },
    include: oilTypeInclude,
  });

  // ! the atomic conditional write from specs 45/49 — a no-op when the reading is lower
  await bumpOdometerIfHigher(bike, odometerReading);

  return {
    log: toApiShape(log),
    oilTypeName: oilType.name,
    bikeNickname: bike.nickname,
  };
};

// ! D12: the two derived fields the list endpoint adds per row. A change's reading marks
// ! where that oil's life ENDED, so a row's period is the run of the oil it drained —
// ! `kmOnThisOil` is this reading minus the OLDER neighbour's (the previous change). The
// ! oldest change on record has no older neighbour, so it counts from odometer 0 and the
// ! figure IS its reading. `costPerKm` is the cost of the oil that actually ran that
// ! distance — i.e. the OLDER neighbour's cost, not this row's (this row's cost bought the
// ! NEW oil) — so price and distance describe the same oil. The oldest change therefore has
// ! a distance but no `costPerKm` (no earlier cost to divide).
// ! Computed server-side on purpose: a client deriving it from the page it happens to be
// ! holding gets a figure that appears and vanishes with pagination, because the
// ! neighbouring change sits on the next page at every boundary
// ! (`bikelog_client-web-` spec 33 H-W12).
const withPeriodFields = <
  T extends { odometerReading: number; cost: number },
>(
  row: T,
  olderNeighbour: { odometerReading: number; cost: number } | null,
) => {
  const kmOnThisOil = olderNeighbour
    ? row.odometerReading - olderNeighbour.odometerReading
    : row.odometerReading;

  return {
    ...row,
    kmOnThisOil,
    // ! null, never Infinity — two changes can legitimately share an odometer reading
    // ! (the sequence check allows equal readings), and `cost / 0` would serialise as
    // ! `null` through JSON anyway while breaking any arithmetic on the way there. Also
    // ! null for the oldest change: `olderNeighbour` is absent, so there is no prior oil's
    // ! cost to spread over the distance.
    costPerKm:
      olderNeighbour && kmOnThisOil > 0
        ? olderNeighbour.cost / kmOnThisOil
        : null,
  };
};

const getEngineOilLogsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach
  // ! buildPrismaListQuery — it merges whatever is left in `query` as equality filters, so
  // ! an unsanitized `?bike=<otherBikeId>` would override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const { where, orderBy, skip, take } = buildPrismaListQuery({
    baseWhere: { bikeId, isDeleted: false },
    query: sanitizedQuery,
    defaultSort: "-changeDate",
  });

  const [result, meta] = await Promise.all([
    prisma.engineOilLog.findMany({
      where,
      orderBy,
      skip,
      take,
      include: oilTypeInclude,
    }),
    prisma.engineOilLog.count({ where }),
  ]);

  const shaped = result.map(toApiShape);

  // ! D12. Pair each row with its OLDER neighbour (the previous change, whose oil this one
  // ! drained). Ordering the page myself rather than trusting "the next element" keeps this
  // ! correct even if a caller passes `?sort=changeDate` — same pairing under the default
  // ! `-changeDate`, which is the only sort anything actually uses. H13's tie-break is
  // ! applied here too, so two changes on one calendar day pair in the same order the list
  // ! shows them in.
  const newestFirst = [...shaped].sort(
    (a, b) =>
      b.changeDate.getTime() - a.changeDate.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );

  // ! Only the page's OLDEST row has an off-page neighbour, so ONE extra query covers
  // ! every page boundary — two queries per list request in total, both served by
  // ! `@@index([bikeId, changeDate])`. Without it, the last row on a full page would read
  // ! `—` and the page boundary would look like a bug (spec 33 V15). `cost` is selected too
  // ! (as a Decimal) because `costPerKm` now divides the OLDER neighbour's cost; mirror
  // ! `toApiShape`'s Number() conversion so it matches the in-page shaped rows.
  const pageOldest = newestFirst[newestFirst.length - 1];
  const offPageNeighbourRaw = pageOldest
    ? await prisma.engineOilLog.findFirst({
        where: {
          bikeId,
          isDeleted: false,
          OR: [
            { changeDate: { lt: pageOldest.changeDate } },
            {
              changeDate: pageOldest.changeDate,
              createdAt: { lt: pageOldest.createdAt },
            },
          ],
        },
        orderBy: [{ changeDate: "desc" }, { createdAt: "desc" }],
        select: { odometerReading: true, cost: true },
      })
    : null;
  const offPageNeighbour = offPageNeighbourRaw
    ? {
        odometerReading: offPageNeighbourRaw.odometerReading,
        cost: Number(offPageNeighbourRaw.cost),
      }
    : null;

  const neighbourById = new Map<
    string,
    { odometerReading: number; cost: number } | null
  >();
  newestFirst.forEach((row, index) => {
    neighbourById.set(
      row.id,
      index === newestFirst.length - 1
        ? offPageNeighbour
        : newestFirst[index + 1],
    );
  });

  return {
    result: shaped.map((row) =>
      withPeriodFields(row, neighbourById.get(row.id) ?? null),
    ),
    meta,
  };
};

const getEngineOilLogByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.engineOilLog.findFirst({
    where: { id, bikeId, isDeleted: false },
    include: oilTypeInclude,
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil log not found");
  }

  // ! D12: present but always `null` here rather than running the neighbour lookup —
  // ! nothing consumes the figure on a single read, and a key that exists on the list
  // ! shape but not this one is the kind of difference a client discovers at runtime.
  return { ...toApiShape(log), kmOnThisOil: null, costPerKm: null };
};

const updateEngineOilLogInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TEngineOilLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.engineOilLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil log not found");
  }

  if (payload.oilType) {
    await findOwnedEngineOilTypeOrThrow(payload.oilType, userId);
  }

  if (payload.changeDate) {
    assertNotBeforePurchase(payload.changeDate, bike.purchaseDate);
  }

  // ! re-run the sequence check whenever the reading or the date moves; excludeId keeps a
  // ! log from conflicting with itself, so correcting a typo on the newest log still works
  if (payload.odometerReading !== undefined || payload.changeDate !== undefined) {
    await assertOilOdometerInSequence(bike, {
      reading: payload.odometerReading ?? log.odometerReading,
      date: payload.changeDate ?? log.changeDate,
      excludeId: id,
    });
  }

  const updateData: Record<string, unknown> = { ...payload };
  // ! client sends `oilType` (a plain id string); the Prisma column is `oilTypeId`
  if ("oilType" in updateData) {
    updateData.oilTypeId = updateData.oilType;
    delete updateData.oilType;
  }

  // ! D3: recompute the due point when the reading or the interval moves — and ONLY then.
  // ! Changing `oilType` alone must NOT re-seed the interval from the new catalog row: a
  // ! rider relabelling a past change would otherwise silently move its due point. The
  // ! client re-seeds its own visible field and submits the number if that is what it wants.
  const newOdometer = payload.odometerReading ?? log.odometerReading;
  const newInterval = payload.intervalKmUsed ?? log.intervalKmUsed ?? undefined;
  if (
    (payload.odometerReading !== undefined ||
      payload.intervalKmUsed !== undefined) &&
    newInterval !== undefined
  ) {
    updateData.nextDueOdometer = computeNextDueOdometer(newOdometer, newInterval);
  }

  const updated = await prisma.engineOilLog.update({
    where: { id: log.id },
    data: updateData,
    include: oilTypeInclude,
  });

  // ! an edit that raises the reading must bump the bike too, or currentOdometer ends up
  // ! below the highest logged reading with no race involved (spec 49 §C)
  if (payload.odometerReading !== undefined) {
    await bumpOdometerIfHigher(bike, updated.odometerReading);
  }

  return toApiShape(updated);
};

// ! Soft delete. There is no "locked" rule here, unlike fuel logs: nothing downstream
// ! closes a period over an oil log (that is MileageRecord's job and it is untouched by
// ! this module), so there is nothing to protect.
const deleteEngineOilLogFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.engineOilLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil log not found");
  }

  const updated = await prisma.engineOilLog.update({
    where: { id: log.id },
    data: { isDeleted: true },
    include: oilTypeInclude,
  });

  return toApiShape(updated);
};

// ! Spec 56 §B — one place that turns a SIGNED `kmRemaining` plus a km/day figure into a
// ! calendar date, used for both the real forecast and §C's provisional one. Negative
// ! remaining is not an error here: the oil ran out in the past, and that past date is the
// ! most useful thing the card can say about an overdue change ("was due ~ 3 Oct").
// ! `projectedDaysRemaining` is left undefined in that case rather than going negative,
// ! because `bikelog_client-web-`'s status card prints it straight into an audit line.
const projectDueDate = (
  kmRemaining: number,
  kmPerDay: number,
): { dueDate: Date; daysRemaining?: number; overdueDays?: number } => {
  if (kmRemaining > 0) {
    const daysRemaining = Math.max(0, Math.floor(kmRemaining / kmPerDay));
    return {
      dueDate: new Date(Date.now() + daysRemaining * DAY_MS),
      daysRemaining,
    };
  }

  const overdueDays = Math.max(
    0,
    Math.floor(Math.abs(kmRemaining) / kmPerDay),
  );
  return {
    dueDate: new Date(Date.now() - overdueDays * DAY_MS),
    overdueDays,
  };
};

// §D — the forecast. Nothing is stored: every figure is derived on read from the newest
// live oil log, `bike.currentOdometer` read LIVE on this request, and the riding rate.
// ! That is exactly what satisfies the developer's "based on the updated odometer reading
// ! I should see updated data" requirement (D4/H5) — a Settings odometer update (spec 44)
// ! shows up on the very next request, with no recompute job and no cache to go stale.
const getEngineOilStatusFromDB = async (
  bikeId: string,
  userId: string,
): Promise<TEngineOilStatus> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const last = await findLatestEngineOilLog(bikeId);

  // state 1 — no oil log yet. Not an error: the client shows a "log your last oil change" CTA.
  if (!last) {
    return {
      status: "unknown",
      currentOdometer: bike.currentOdometer,
      lastChange: null,
    };
  }

  // ! The STRICT rate, and the only one `evaluateOilDue` is ever given: it decides `status`
  // ! and therefore which reminders fire, so spec 56 left it exactly as it was (its H2).
  const rate = await computeKmPerDay(bikeId);
  const due = evaluateOilDue(last, bike.currentOdometer, rate);

  // ! Spec 56 §B — the DATE-only rate. When the strict one comes back null (which is the
  // ! common case for a rider who fills up less than twice a month) the card used to have
  // ! no date to show at all. This fallback answers "around when?" from the bike's whole
  // ! fuel history, or failing that its lifetime odometer average, and `rateBasis.source`
  // ! tells the client which it got so it can hedge the wording.
  const projectionRate = rate ?? (await computeFallbackKmPerDay(bike));

  const lastChange: TEngineOilStatus["lastChange"] = {
    _id: last.id,
    changeDate: last.changeDate,
    odometerReading: last.odometerReading,
    oilType: last.oilType
      ? { _id: last.oilType.id, name: last.oilType.name }
      : null,
    oilFilterChanged: last.oilFilterChanged,
  };

  if (last.intervalKmUsed !== null) {
    lastChange.intervalKm = last.intervalKmUsed;
  }
  if (last.nextDueOdometer !== null) {
    lastChange.nextDueOdometer = last.nextDueOdometer;
  }

  const result: TEngineOilStatus = {
    status: due.status,
    currentOdometer: bike.currentOdometer,
    lastChange,
    kmSinceChange: due.kmSinceChange,
  };

  // state 2 — a log with no interval (H7's imported row): the distance is still worth
  // showing, so `kmSinceChange` stays and everything derived from an interval is omitted.
  if (due.kmRemaining !== undefined) {
    result.kmRemaining = due.kmRemaining;
    result.percentUsed = due.percentUsed;
  }

  // state 3 — no usable riding rate at all, not even the fallback (a brand-new bike with
  // no fuel history and under 100 km or 14 days of ownership): the distance fields stay and
  // the projection is omitted. `status` already fell back to the 50 km rule inside
  // evaluateOilDue regardless of which rate reached this line.
  if (projectionRate) {
    // ! 1dp — a raw 42.857142857142854 in a payload is noise. Reported even when overdue:
    // ! spec 52 D6, without it a wrong date is undebuggable.
    result.kmPerDay = Math.round(projectionRate.kmPerDay * 10) / 10;
    result.rateBasis = {
      spanDays: projectionRate.spanDays,
      distanceKm: projectionRate.distanceKm,
      source: projectionRate.source,
    };
  }

  // ! Spec 56 §B. Both branches below are `Math.floor` for the reason spec 52 H5 gives —
  // ! `currentOdometer` lags reality between logs, so every figure here is biased late, and
  // ! late is the one direction an oil-change date must not err in. When `projectionRate`
  // ! IS `rate`, the first branch reproduces `due.projectedDays` by construction (same
  // ! dividend, same divisor, same floor), so nothing about today's answers changes.
  if (due.kmRemaining !== undefined && projectionRate) {
    const projected = projectDueDate(due.kmRemaining, projectionRate.kmPerDay);

    result.projectedDueDate = projected.dueDate;
    if (projected.daysRemaining !== undefined) {
      result.projectedDaysRemaining = projected.daysRemaining;
    }
    if (projected.overdueDays !== undefined) {
      result.overdueDays = projected.overdueDays;
    }
  }

  // ! Spec 56 §C — the provisional forecast for a change with no interval of its own. The
  // ! rider's real problem was not a missing rate but a missing interval: spec 54 seeds
  // ! `intervalKmUsed` on new changes, and every change logged before it has none, so the
  // ! card could only say "set an interval to get a due date". The oil type still carries a
  // ! `suggestedIntervalKm`, which is a good enough answer to "around when?" as long as it
  // ! is labelled an estimate — and it is kept in its own object so no existing field
  // ! silently becomes a guess (H3).
  if (last.nextDueOdometer === null && last.oilType) {
    const intervalKm = last.oilType.suggestedIntervalKm;
    const nextDueOdometer = computeNextDueOdometer(
      last.odometerReading,
      intervalKm,
    );
    const estimated = evaluateOilDue(
      { odometerReading: last.odometerReading, nextDueOdometer },
      bike.currentOdometer,
      rate,
    );

    if (estimated.kmRemaining !== undefined) {
      const estimate: NonNullable<TEngineOilStatus["estimate"]> = {
        basis: "oilTypeSuggestion",
        // ! never "unknown" here: a synthetic `nextDueOdometer` is always non-null, so
        // ! `evaluateOilDue`'s unknown branch is unreachable for it
        status: estimated.status as "ok" | "upcoming" | "overdue",
        intervalKm,
        nextDueOdometer,
        kmRemaining: estimated.kmRemaining,
        percentUsed: estimated.percentUsed as number,
      };

      if (projectionRate) {
        const projected = projectDueDate(
          estimated.kmRemaining,
          projectionRate.kmPerDay,
        );
        estimate.projectedDueDate = projected.dueDate;
        if (projected.daysRemaining !== undefined) {
          estimate.projectedDaysRemaining = projected.daysRemaining;
        }
        if (projected.overdueDays !== undefined) {
          estimate.overdueDays = projected.overdueDays;
        }
      }

      result.estimate = estimate;
    }
  }

  return result;
};

const uploadEngineOilLogImageIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  file: Express.Multer.File | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const log = await prisma.engineOilLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil log not found");
  }

  const existingReceiptImage = log.receiptImage as {
    url: string;
    publicId: string;
  } | null;

  if (existingReceiptImage) {
    await deleteCloudinaryImage(existingReceiptImage.publicId);
  }

  const updated = await prisma.engineOilLog.update({
    where: { id: log.id },
    data: { receiptImage: { url: file.path, publicId: file.filename } },
    include: oilTypeInclude,
  });

  return toApiShape(updated);
};

// ! H8: on an IMPORTED row the `{ url, publicId }` here was copied from the source
// ! maintenance log's `serviceImage` — the file itself was never re-uploaded, so the asset
// ! had two owners until `--finalize` soft-deleted that source log. Finalize is what leaves
// ! exactly one live owner, which is the second reason §H's two steps are both mandatory.
const deleteEngineOilLogImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const log = await prisma.engineOilLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!log) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil log not found");
  }

  const existingReceiptImage = log.receiptImage as {
    url: string;
    publicId: string;
  } | null;

  if (!existingReceiptImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Receipt image not found");
  }

  await deleteCloudinaryImage(existingReceiptImage.publicId);

  const updated = await prisma.engineOilLog.update({
    where: { id: log.id },
    data: { receiptImage: Prisma.JsonNull },
    include: oilTypeInclude,
  });

  return toApiShape(updated);
};

export const engineOilLogServices = {
  createEngineOilLogIntoDB,
  getEngineOilLogsFromDB,
  getEngineOilLogByIdFromDB,
  updateEngineOilLogInDB,
  deleteEngineOilLogFromDB,
  getEngineOilStatusFromDB,
  uploadEngineOilLogImageIntoDB,
  deleteEngineOilLogImageFromDB,
};
