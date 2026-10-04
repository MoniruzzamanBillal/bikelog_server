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
const maintenanceType_utils_1 = require("./maintenanceType.utils");
// ! Spec 46: this catalog is per-user, not global. Every query below must carry BOTH
// ! `ownerId` and `isDeleted: false` — Prisma has no query hook to add either for us.
// ! `ownerId` is never read from the request body (it is deliberately absent from the Zod
// ! schemas and from TMaintenanceType); it always comes from the verified JWT.
const createMaintenanceTypeIntoDB = (userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    // ! Spec 41 §F, re-scoped by spec 46 §B: the unique is now `(ownerId, name)` and still
    // ! covers soft-deleted rows, so re-adding a name THIS USER deleted would otherwise hit
    // ! P2002 and claim it "already exists" about a row they can no longer see. Revive their
    // ! row instead of inserting a second one — keeping the original id means their
    // ! historical maintenance logs stay correctly labelled. Another user's row with the
    // ! same name is a different row with a different id and is never consulted.
    const softDeleted = yield prisma_1.prisma.maintenanceType.findFirst({
        where: { ownerId: userId, name: payload.name, isDeleted: true },
    });
    if (softDeleted) {
        const revived = yield prisma_1.prisma.maintenanceType.update({
            where: { id: softDeleted.id },
            data: {
                isDeleted: false,
                defaultIntervalKm: payload.defaultIntervalKm,
                defaultIntervalDays: payload.defaultIntervalDays,
                requiresOilType: payload.requiresOilType,
            },
        });
        return Object.assign(Object.assign({}, revived), { _id: revived.id });
    }
    try {
        const result = yield prisma_1.prisma.maintenanceType.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                ownerId: userId,
                name: payload.name,
                defaultIntervalKm: payload.defaultIntervalKm,
                defaultIntervalDays: payload.defaultIntervalDays,
                requiresOilType: payload.requiresOilType,
            },
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            // ! Message unchanged from spec 06 on purpose — it now fires on `(ownerId, name)`,
            // ! which finally makes it TRUE from the user's point of view. Before spec 46 it
            // ! could fire because a different user happened to own that name.
            throw new AppError_1.default(http_status_1.default.CONFLICT, "A maintenance type with this name already exists");
        }
        throw error;
    }
});
const getMaintenanceTypesFromDB = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.maintenanceType.findMany({
        where: { ownerId: userId, isDeleted: false },
        orderBy: { name: "asc" },
    });
    // ! An empty array is a legitimate response, not an error: spec 46 decision 2 gives new
    // ! users empty catalogs and there is no seeding (spec 42 removed the seed scripts).
    return result.map((item) => (Object.assign(Object.assign({}, item), { _id: item.id })));
});
const updateMaintenanceTypeInDB = (userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    // ! Spec 41 §G + spec 46 §D/§E: one lookup covers all three refusals — unknown id,
    // ! soft-deleted row, and another user's row — all as a 404.
    yield (0, maintenanceType_utils_1.findOwnedMaintenanceTypeOrThrow)(id, userId);
    try {
        const result = yield prisma_1.prisma.maintenanceType.update({
            where: { id },
            data: {
                name: payload.name,
                defaultIntervalKm: payload.defaultIntervalKm,
                defaultIntervalDays: payload.defaultIntervalDays,
                requiresOilType: payload.requiresOilType,
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
const deleteMaintenanceTypeFromDB = (userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield (0, maintenanceType_utils_1.findOwnedMaintenanceTypeOrThrow)(id, userId);
    // ! Spec 41 §E / decision 2: only LIVE logs block a delete. A soft-deleted log does not —
    // ! otherwise a type used even once could never be removed. Safe either way, since the
    // ! catalog row is never actually removed, so the FK stays valid regardless.
    // ! This count must run BEFORE the update: globalErrorHandler has no P2003 branch, so an
    // ! unguarded FK violation would reach the client as a generic 500.
    // ! Spec 46 §D: the count stays scoped on `maintenanceTypeId` alone and deliberately
    // ! does NOT join through to the bike's owner. `id` has just been proven to belong to
    // ! `userId`, so every log that can match is necessarily this user's — an owner join
    // ! here would be redundant, not a hardening. Don't add one.
    const inUse = yield prisma_1.prisma.maintenanceLog.count({
        where: { maintenanceTypeId: id, isDeleted: false },
    });
    if (inUse > 0) {
        // ! User-facing copy — the clients show this verbatim in a warning toast, so it names
        // ! the type, gives the count, and says what to do next. Byte-identical to pre-spec-46.
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
