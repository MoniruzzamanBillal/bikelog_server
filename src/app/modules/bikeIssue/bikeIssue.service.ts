import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { maintenanceLogModel } from "../maintenanceLog/maintenanceLog.model";
import { BikeIssueStatus } from "./bikeIssue.constant";
import { bikeIssueModel } from "./bikeIssue.model";
import { TBikeIssue, TBikeIssueHistoryEntry } from "./bikeIssue.interface";

const createBikeIssueIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeIssue>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issueData = {
    ...payload,
    bike: bikeId,
    status: BikeIssueStatus.open,
    history: [],
    dateReported: payload.dateReported ?? new Date(),
  };

  const issue = await bikeIssueModel.create(issueData);

  return issue;
};

const getBikeIssuesFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
  // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
  // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const issuesQuery = new QueryBuilder(
    bikeIssueModel.find({ bike: bikeId, isDeleted: false }),
    sanitizedQuery,
  )
    .filter()
    .sort("-dateReported")
    .pagination()
    .field();

  const result = await issuesQuery.queryModel;
  const meta = await issuesQuery.countTotal();

  return { result, meta };
};

const getBikeIssueByIdFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  return issue;
};

const updateBikeIssueInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeIssue>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const updateData = { ...payload };
  delete updateData.status;
  delete updateData.history;

  Object.assign(issue, updateData);
  await issue.save();

  return issue;
};

const deleteBikeIssueFromDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  issue.isDeleted = true;
  await issue.save();

  return issue;
};

const resolveBikeIssueInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: { resolvedInMaintenanceLog?: string },
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  if (issue.status === BikeIssueStatus.resolved) {
    throw new AppError(httpStatus.BAD_REQUEST, "Issue is already resolved");
  }

  if (payload.resolvedInMaintenanceLog) {
    const maintenanceLog = await maintenanceLogModel.findOne({
      _id: payload.resolvedInMaintenanceLog,
      bike: bikeId,
      isDeleted: false,
    });
    if (!maintenanceLog) {
      throw new AppError(httpStatus.NOT_FOUND, "Maintenance log not found");
    }
  }

  issue.history.push({
    resolvedAt: new Date(),
    ...(payload.resolvedInMaintenanceLog && {
      resolvedInMaintenanceLog: payload.resolvedInMaintenanceLog,
    }),
  } as unknown as TBikeIssueHistoryEntry);
  issue.status = BikeIssueStatus.resolved;

  await issue.save();

  return issue;
};

const reopenBikeIssueInDB = async (bikeId: string, userId: string, id: string) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  if (issue.status === BikeIssueStatus.open) {
    throw new AppError(httpStatus.BAD_REQUEST, "Issue is already open");
  }

  const lastEntry = issue.history[issue.history.length - 1];
  if (!lastEntry) {
    throw new AppError(httpStatus.BAD_REQUEST, "Issue has no resolution history to reopen");
  }

  lastEntry.reopenedAt = new Date();
  issue.status = BikeIssueStatus.open;

  issue.markModified("history");
  await issue.save();

  return issue;
};

export const bikeIssueServices = {
  createBikeIssueIntoDB,
  getBikeIssuesFromDB,
  getBikeIssueByIdFromDB,
  updateBikeIssueInDB,
  deleteBikeIssueFromDB,
  resolveBikeIssueInDB,
  reopenBikeIssueInDB,
};
