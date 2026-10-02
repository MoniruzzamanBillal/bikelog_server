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
exports.maintenanceTypeServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const createMaintenanceTypeIntoDB = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    // ! Spec 41 §F: `name` is @unique, so re-adding a soft-deleted name would otherwise hit
    // ! P2002 and tell the user it "already exists" about a row they can no longer see.
    // ! Revive that row instead of inserting a second one — keeping the original id means
    // ! historical maintenance logs referencing it stay correctly labelled.
    const softDeleted = yield prisma_1.prisma.maintenanceType.findFirst({
        where: { name: payload.name, isDeleted: true },
    });
    if (softDeleted) {
        const revived = yield prisma_1.prisma.maintenanceType.update({
            where: { id: softDeleted.id },
            data: {
                isDeleted: false,
                defaultIntervalKm: payload.defaultIntervalKm,
                defaultIntervalDays: payload.defaultIntervalDays,
            },
        });
        return Object.assign(Object.assign({}, revived), { _id: revived.id });
    }
    try {
        const result = yield prisma_1.prisma.maintenanceType.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                name: payload.name,
                defaultIntervalKm: payload.defaultIntervalKm,
                defaultIntervalDays: payload.defaultIntervalDays,
            },
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new AppError_1.default(http_status_1.default.CONFLICT, "A maintenance type with this name already exists");
        }
        throw error;
    }
});
const getMaintenanceTypesFromDB = () => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.maintenanceType.findMany({
        where: { isDeleted: false },
        orderBy: { name: "asc" },
    });
    return result.map((item) => (Object.assign(Object.assign({}, item), { _id: item.id })));
});
const updateMaintenanceTypeInDB = (id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.maintenanceType.findUnique({ where: { id } });
    // ! Spec 41 §G: a soft-deleted row is invisible to the client, so it must 404 rather
    // ! than silently accept an edit.
    if (!existing || existing.isDeleted) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
    }
    try {
        const result = yield prisma_1.prisma.maintenanceType.update({
            where: { id },
            data: {
                name: payload.name,
                defaultIntervalKm: payload.defaultIntervalKm,
                defaultIntervalDays: payload.defaultIntervalDays,
            },
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new AppError_1.default(http_status_1.default.CONFLICT, "A maintenance type with this name already exists");
        }
        throw error;
    }
});
const deleteMaintenanceTypeFromDB = (id) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.maintenanceType.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
    }
    // ! Spec 41 §E / decision 2: only LIVE logs block a delete. A soft-deleted log does not —
    // ! otherwise a type used even once could never be removed. Safe either way, since the
    // ! catalog row is never actually removed, so the FK stays valid regardless.
    // ! This count must run BEFORE the update: globalErrorHandler has no P2003 branch, so an
    // ! unguarded FK violation would reach the client as a generic 500.
    const inUse = yield prisma_1.prisma.maintenanceLog.count({
        where: { maintenanceTypeId: id, isDeleted: false },
    });
    if (inUse > 0) {
        // ! User-facing copy — the clients show this verbatim in a warning toast, so it names
        // ! the type, gives the count, and says what to do next.
        throw new AppError_1.default(http_status_1.default.CONFLICT, `"${existing.name}" is used by ${inUse} maintenance log${inUse === 1 ? "" : "s"} and can't be deleted. Remove or re-assign ${inUse === 1 ? "it" : "them"} first.`);
    }
    const result = yield prisma_1.prisma.maintenanceType.update({
        where: { id },
        data: { isDeleted: true },
    });
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
exports.maintenanceTypeServices = {
    createMaintenanceTypeIntoDB,
    getMaintenanceTypesFromDB,
    updateMaintenanceTypeInDB,
    deleteMaintenanceTypeFromDB,
};
