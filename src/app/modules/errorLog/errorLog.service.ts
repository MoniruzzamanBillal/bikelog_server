import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { TErrorLog } from "./errorLog.interface";

// ! 30-day retention, matching the old Mongo TTL index's expireAfterSeconds value exactly —
// ! see context/specs/36a-decision-b-retention-default-chosen-autonomously.md for why a
// ! GitHub-Actions-cron cleanup endpoint was chosen over pg_cron
const RETENTION_DAYS = 30;

const toApiShape = <T extends { id: string }>(errorLog: T) => ({
  ...errorLog,
  _id: errorLog.id,
});

const createErrorLog = async (payload: TErrorLog) => {
  return await prisma.errorLog.create({
    data: {
      id: generateObjectId(),
      status: payload.status,
      message: payload.message,
      errorName: payload.errorName,
      errorSources: payload.errorSources,
      stack: payload.stack,
      method: payload.method,
      path: payload.path,
      userId: payload.userId,
      userEmail: payload.userEmail,
    },
  });
};

const getErrorLogsFromDB = async (query: Record<string, unknown>) => {
  // ! no IDOR-stripping needed here — admin-only endpoint, never scoped to a
  // ! bike/user to begin with (unlike every other buildPrismaListQuery consumer)
  const { where, orderBy, skip, take } = buildPrismaListQuery({
    baseWhere: {},
    query,
    defaultSort: "-createdAt",
  });

  const [result, meta] = await Promise.all([
    prisma.errorLog.findMany({ where, orderBy, skip, take }),
    prisma.errorLog.count({ where }),
  ]);

  return { result: result.map(toApiShape), meta };
};

const getErrorLogByIdFromDB = async (id: string) => {
  const errorLog = await prisma.errorLog.findUnique({ where: { id } });

  if (!errorLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Error log not found");
  }

  return toApiShape(errorLog);
};

// ! daily cron target (see errorLog.controller.ts's cleanupExpiredErrorLogs) — Postgres has
// ! no TTL-index equivalent to Mongo's background-sweep expiry, so this must be triggered externally
const cleanupExpiredErrorLogsFromDB = async () => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { count } = await prisma.errorLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return { deletedCount: count, cutoff };
};

export const errorLogServices = {
  createErrorLog,
  getErrorLogsFromDB,
  getErrorLogByIdFromDB,
  cleanupExpiredErrorLogsFromDB,
};
