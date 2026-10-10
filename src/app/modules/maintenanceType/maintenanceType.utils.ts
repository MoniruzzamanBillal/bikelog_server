import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";

// Spec 46 §D. Mirrors `findOwnedBikeOrThrow` (bike.utils.ts) deliberately: one query, one
// 404, collapsing "no such id", "soft-deleted" and "belongs to another user" into a single
// indistinguishable path.
//
// ! 404, not 403 (§E). It is this repo's established convention for exactly this case, it
// ! needs no client change (both clients already render a 404 from these endpoints — the
// ! spec 41 soft-delete path), and it does not confirm the existence of another user's row.
//
// Returns the raw Prisma row (`id`/`ownerId`, NOT the `_id`-shaped wire contract) — callers
// either discard it or read a scalar off it before shaping their own response.
export const findOwnedMaintenanceTypeOrThrow = async (
  id: string,
  userId: string,
) => {
  const row = await prisma.maintenanceType.findFirst({
    where: { id, ownerId: userId, isDeleted: false },
  });
  if (!row) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }
  return row;
};
