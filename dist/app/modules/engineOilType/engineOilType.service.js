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
exports.engineOilTypeServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const createEngineOilTypeIntoDB = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    // ! Spec 41 §I/§F: `name` is @unique, so re-adding a soft-deleted name would otherwise
    // ! hit P2002 and claim it "already exists" about a row the user can no longer see.
    // ! Revive that row, preserving its id so historical logs stay correctly labelled.
    const softDeleted = yield prisma_1.prisma.engineOilType.findFirst({
        where: { name: payload.name, isDeleted: true },
    });
    if (softDeleted) {
        const revived = yield prisma_1.prisma.engineOilType.update({
            where: { id: softDeleted.id },
            data: {
                isDeleted: false,
                suggestedIntervalKm: payload.suggestedIntervalKm,
            },
        });
        return Object.assign(Object.assign({}, revived), { _id: revived.id });
    }
    try {
        const result = yield prisma_1.prisma.engineOilType.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                name: payload.name,
                suggestedIntervalKm: payload.suggestedIntervalKm,
            },
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new AppError_1.default(http_status_1.default.CONFLICT, "An engine oil type with this name already exists");
        }
        throw error;
    }
});
const getEngineOilTypesFromDB = () => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.engineOilType.findMany({
        where: { isDeleted: false },
        orderBy: { name: "asc" },
    });
    return result.map((item) => (Object.assign(Object.assign({}, item), { _id: item.id })));
});
const updateEngineOilTypeInDB = (id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.engineOilType.findUnique({ where: { id } });
    // ! Spec 41 §G: a soft-deleted row is invisible to the client, so it must 404 rather
    // ! than silently accept an edit.
    if (!existing || existing.isDeleted) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
    }
    try {
        const result = yield prisma_1.prisma.engineOilType.update({
            where: { id },
            data: {
                name: payload.name,
                suggestedIntervalKm: payload.suggestedIntervalKm,
            },
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new AppError_1.default(http_status_1.default.CONFLICT, "An engine oil type with this name already exists");
        }
        throw error;
    }
});
const deleteEngineOilTypeFromDB = (id) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.engineOilType.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
    }
    // ! Spec 41 §I / decision 2: same rule as the maintenance catalog — only LIVE logs block.
    // ! MaintenanceLog.oilTypeId is nullable (String?), so a log that recorded no oil type
    // ! simply never matches here; `count` handles that for free, no null-guard needed.
    // ! Runs BEFORE the update: globalErrorHandler has no P2003 branch, so an unguarded FK
    // ! violation would reach the client as a generic 500.
    const inUse = yield prisma_1.prisma.maintenanceLog.count({
        where: { oilTypeId: id, isDeleted: false },
    });
    if (inUse > 0) {
        // ! User-facing copy — shown verbatim in the clients' warning toast.
        throw new AppError_1.default(http_status_1.default.CONFLICT, `"${existing.name}" is used by ${inUse} maintenance log${inUse === 1 ? "" : "s"} and can't be deleted. Remove or re-assign ${inUse === 1 ? "it" : "them"} first.`);
    }
    const result = yield prisma_1.prisma.engineOilType.update({
        where: { id },
        data: { isDeleted: true },
    });
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
exports.engineOilTypeServices = {
    createEngineOilTypeIntoDB,
    getEngineOilTypesFromDB,
    updateEngineOilTypeInDB,
    deleteEngineOilTypeFromDB,
};
