import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";

// Spec 46 §D — the exact mirror of `findOwnedMaintenanceTypeOrThrow`. One helper per
// module rather than one generic helper over two Prisma delegates: the two catalog modules
// are exact 5-file mirrors today and this repo leans on that property.
//
// ! 404, not 403 (§E) — see the note on the maintenanceType helper.
export const findOwnedEngineOilTypeOrThrow = async (
  id: string,
  userId: string,
) => {
  const row = await prisma.engineOilType.findFirst({
    where: { id, ownerId: userId, isDeleted: false },
  });
  if (!row) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
  }
  return row;
};

// Spec 50 §C. The catalog's `(ownerId, name)` unique is case-sensitive, so "engine oil" would
// sit next to "Engine Oil". Compare ignoring case, LIVE rows only: soft-deleted rows are
// handled by the revive path in the create service. `excludeId` lets a row be renamed to a
// different casing of its own name.
//
// ! raw `lower(name) = lower($1)`, NOT Prisma's `mode: "insensitive"`: on PostgreSQL that
// ! compiles to ILIKE, where `_` and `%` in a user's name act as wildcards ("A_C" would
// ! falsely collide with "ABC"). Verified by the spec 50 wildcard test cases.
export const findLiveNameConflict = async (
  userId: string,
  name: string,
  excludeId?: string,
) => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM engine_oil_types
     WHERE "ownerId" = ${userId}
       AND "isDeleted" = false
       AND lower(name) = lower(${name})
       ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
     LIMIT 1`;
  return rows[0] ?? null;
};

// Soft-deleted rows of this owner whose name equals `name` ignoring case (same wildcard note).
export const findSoftDeletedNameMatches = async (userId: string, name: string) => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM engine_oil_types
     WHERE "ownerId" = ${userId}
       AND "isDeleted" = true
       AND lower(name) = lower(${name})`;
  if (rows.length === 0) return [];
  return prisma.engineOilType.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
};
