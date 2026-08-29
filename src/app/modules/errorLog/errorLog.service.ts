import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { TErrorLog } from "./errorLog.interface";
import { errorLogModel } from "./errorLog.model";

const createErrorLog = async (payload: TErrorLog) => {
  return await errorLogModel.create(payload);
};

const getErrorLogsFromDB = async (query: Record<string, unknown>) => {
  const errorLogsQuery = new QueryBuilder(errorLogModel.find(), query)
    .filter()
    .sort()
    .pagination()
    .field();

  const result = await errorLogsQuery.queryModel;
  const meta = await errorLogsQuery.countTotal();

  return { result, meta };
};

const getErrorLogByIdFromDB = async (id: string) => {
  const errorLog = await errorLogModel.findById(id);

  if (!errorLog) {
    throw new AppError(httpStatus.NOT_FOUND, "Error log not found");
  }

  return errorLog;
};

export const errorLogServices = {
  createErrorLog,
  getErrorLogsFromDB,
  getErrorLogByIdFromDB,
};
