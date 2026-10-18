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
const engineOilType_utils_1 = require("./engineOilType.utils");
// ! Spec 46: this catalog is per-user, not global. Every query below must carry BOTH
// ! `ownerId` and `isDeleted: false`. `ownerId` is never read from the request body (it is
// ! deliberately absent from the Zod schemas and from TEngineOilType); it always comes
// ! from the verified JWT.
const createEngineOilTypeIntoDB = (userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // ! Spec 50 §C: a LIVE row whose name differs only by case is a duplicate too — the
    // ! (ownerId, name) unique can't see that, so check it before anything else.
    if (yield (0, engineOilType_utils_1.findLiveNameConflict)(userId, payload.name)) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "An engine oil type with this name already exists");
    }
    // ! Spec 41 §I/§F, re-scoped by spec 46 §B: the unique is now `(ownerId, name)` and still
    // ! covers soft-deleted rows, so re-adding a name THIS USER deleted would otherwise hit
    // ! P2002 and claim it "already exists" about a row they can no longer see. Revive their
    // ! row, preserving its id so their historical logs stay correctly labelled.
    // ! Spec 50 §C: the revive match ignores case as well; prefer an exact-name row if several
    // ! match. The row takes the casing the user just typed. That cannot collide on
    // ! (ownerId, name): an exact match would have been preferred, and a live case-variant was
    // ! refused above.
    const softDeletedMatches = yield (0, engineOilType_utils_1.findSoftDeletedNameMatches)(userId, payload.name);
    const softDeleted = (_a = softDeletedMatches.find((row) => row.name === payload.name)) !== null && _a !== void 0 ? _a : softDeletedMatches[0];
    if (softDeleted) {
        const revived = yield prisma_1.prisma.engineOilType.update({
            where: { id: softDeleted.id },
            data: {
                isDeleted: false,
                name: payload.name,
                suggestedIntervalKm: payload.suggestedIntervalKm,
            },
        });
        return Object.assign(Object.assign({}, revived), { _id: revived.id });
    }
    try {
        const result = yield prisma_1.prisma.engineOilType.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                ownerId: userId,
                name: payload.name,
                suggestedIntervalKm: payload.suggestedIntervalKm,
            },
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            // ! Message unchanged — it now fires on `(ownerId, name)`, so it is finally true
            // ! from the user's point of view.
            throw new AppError_1.default(http_status_1.default.CONFLICT, "An engine oil type with this name already exists");
        }
        throw error;
    }
});
const getEngineOilTypesFromDB = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.engineOilType.findMany({
        where: { ownerId: userId, isDeleted: false },
        orderBy: { name: "asc" },
    });
    // ! An empty array is a legitimate response for a brand-new user (spec 46 decision 2).
    return result.map((item) => (Object.assign(Object.assign({}, item), { _id: item.id })));
});
const updateEngineOilTypeInDB = (userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    // ! Spec 41 §G + spec 46 §D/§E: one lookup covers unknown id, soft-deleted row and
    // ! another user's row — all as a 404.
    yield (0, engineOilType_utils_1.findOwnedEngineOilTypeOrThrow)(id, userId);
    // ! Spec 50 §C: renaming onto a case-variant of another live row is a duplicate; excluding
    // ! this row's own id still lets it change the casing of its own name.
    if (payload.name !== undefined &&
        (yield (0, engineOilType_utils_1.findLiveNameConflict)(userId, payload.name, id))) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "An engine oil type with this name already exists");
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
const deleteEngineOilTypeFromDB = (userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield (0, engineOilType_utils_1.findOwnedEngineOilTypeOrThrow)(id, userId);
    // ! Spec 41 §I / decision 2: same rule as the maintenance catalog — only LIVE logs block.
    // ! MaintenanceLog.oilTypeId is nullable (String?), so a log that recorded no oil type
    // ! simply never matches here; `count` handles that for free, no null-guard needed.
    // ! Runs BEFORE the update: globalErrorHandler has no P2003 branch, so an unguarded FK
    // ! violation would reach the client as a generic 500.
    // ! Spec 46 §D: deliberately NOT joined through to the bike's owner. `id` has just been
    // ! proven to belong to `userId`, so every log that can match is necessarily this
    // ! user's. An owner join here would be redundant, not a hardening. Don't add one.
    // ! Spec 54 §G / H12: BOTH tables, not just maintenance logs. After spec 54 an oil type
    // ! used only by engine oil logs would otherwise sail past this guard and soft-delete,
    // ! leaving the current oil's type unresolvable on the status card. The engine_oil_logs
    // ! FK is ON DELETE RESTRICT (unlike maintenance_logs', which is SET NULL) — but a soft
    // ! delete is an UPDATE, so no FK is involved either way and this count is the only guard.
    const [maintenanceInUse, oilLogInUse] = yield Promise.all([
        prisma_1.prisma.maintenanceLog.count({
            where: { oilTypeId: id, isDeleted: false },
        }),
        prisma_1.prisma.engineOilLog.count({
            where: { oilTypeId: id, isDeleted: false },
        }),
    ]);
    const inUse = maintenanceInUse + oilLogInUse;
    if (inUse > 0) {
        // ! User-facing copy — shown verbatim in the clients' warning toast. Widened from
        // ! "maintenance log" to name both places it can be in use; the shape, status and
        // ! closing sentence are unchanged.
        const where = [
            maintenanceInUse > 0
                ? `${maintenanceInUse} maintenance log${maintenanceInUse === 1 ? "" : "s"}`
                : null,
            oilLogInUse > 0
                ? `${oilLogInUse} engine oil log${oilLogInUse === 1 ? "" : "s"}`
                : null,
        ]
            .filter(Boolean)
            .join(" and ");
        throw new AppError_1.default(http_status_1.default.CONFLICT, `"${existing.name}" is used by ${where} and can't be deleted. Remove or re-assign ${inUse === 1 ? "it" : "them"} first.`);
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
