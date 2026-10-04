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
