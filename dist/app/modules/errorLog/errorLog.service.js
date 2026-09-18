"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorLogServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
// ! 30-day retention, matching the old Mongo TTL index's expireAfterSeconds value exactly —
// ! see context/specs/36a-decision-b-retention-default-chosen-autonomously.md for why a
// ! GitHub-Actions-cron cleanup endpoint was chosen over pg_cron
const RETENTION_DAYS = 30;
const toApiShape = (errorLog) => (Object.assign(Object.assign({}, errorLog), { _id: errorLog.id }));
const createErrorLog = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    return yield prisma_1.prisma.errorLog.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
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
});
const getErrorLogsFromDB = (query) => __awaiter(void 0, void 0, void 0, function* () {
    // ! no IDOR-stripping needed here — admin-only endpoint, never scoped to a
    // ! bike/user to begin with (unlike every other buildPrismaListQuery consumer)
    const { where, orderBy, skip, take } = (0, buildPrismaListQuery_1.buildPrismaListQuery)({
        baseWhere: {},
        query,
        defaultSort: "-createdAt",
    });
    const [result, meta] = yield Promise.all([
        prisma_1.prisma.errorLog.findMany({ where, orderBy, skip, take }),
        prisma_1.prisma.errorLog.count({ where }),
    ]);
    return { result: result.map(toApiShape), meta };
});
const getErrorLogByIdFromDB = (id) => __awaiter(void 0, void 0, void 0, function* () {
    const errorLog = yield prisma_1.prisma.errorLog.findUnique({ where: { id } });
    if (!errorLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Error log not found");
    }
    return toApiShape(errorLog);
});
// ! daily cron target (see errorLog.controller.ts's cleanupExpiredErrorLogs) — Postgres has
// ! no TTL-index equivalent to Mongo's background-sweep expiry, so this must be triggered externally
const cleanupExpiredErrorLogsFromDB = () => __awaiter(void 0, void 0, void 0, function* () {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = yield prisma_1.prisma.errorLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
    });
    return { deletedCount: count, cutoff };
});
exports.errorLogServices = {
    createErrorLog,
    getErrorLogsFromDB,
    getErrorLogByIdFromDB,
    cleanupExpiredErrorLogsFromDB,
};
