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
exports.findSoftDeletedNameMatches = exports.findLiveNameConflict = exports.findOwnedEngineOilTypeOrThrow = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
// Spec 46 §D — the exact mirror of `findOwnedMaintenanceTypeOrThrow`. One helper per
// module rather than one generic helper over two Prisma delegates: the two catalog modules
// are exact 5-file mirrors today and this repo leans on that property.
//
// ! 404, not 403 (§E) — see the note on the maintenanceType helper.
const findOwnedEngineOilTypeOrThrow = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const row = yield prisma_1.prisma.engineOilType.findFirst({
        where: { id, ownerId: userId, isDeleted: false },
    });
    if (!row) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
    }
    return row;
});
exports.findOwnedEngineOilTypeOrThrow = findOwnedEngineOilTypeOrThrow;
// Spec 50 §C. The catalog's `(ownerId, name)` unique is case-sensitive, so "engine oil" would
// sit next to "Engine Oil". Compare ignoring case, LIVE rows only: soft-deleted rows are
// handled by the revive path in the create service. `excludeId` lets a row be renamed to a
// different casing of its own name.
//
// ! raw `lower(name) = lower($1)`, NOT Prisma's `mode: "insensitive"`: on PostgreSQL that
// ! compiles to ILIKE, where `_` and `%` in a user's name act as wildcards ("A_C" would
// ! falsely collide with "ABC"). Verified by the spec 50 wildcard test cases.
const findLiveNameConflict = (userId, name, excludeId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const rows = yield prisma_1.prisma.$queryRaw `
    SELECT id FROM engine_oil_types
     WHERE "ownerId" = ${userId}
       AND "isDeleted" = false
       AND lower(name) = lower(${name})
       ${excludeId ? client_1.Prisma.sql `AND id <> ${excludeId}` : client_1.Prisma.empty}
     LIMIT 1`;
    return (_a = rows[0]) !== null && _a !== void 0 ? _a : null;
});
exports.findLiveNameConflict = findLiveNameConflict;
// Soft-deleted rows of this owner whose name equals `name` ignoring case (same wildcard note).
const findSoftDeletedNameMatches = (userId, name) => __awaiter(void 0, void 0, void 0, function* () {
    const rows = yield prisma_1.prisma.$queryRaw `
    SELECT id FROM engine_oil_types
     WHERE "ownerId" = ${userId}
       AND "isDeleted" = true
       AND lower(name) = lower(${name})`;
    if (rows.length === 0)
        return [];
    return prisma_1.prisma.engineOilType.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
});
exports.findSoftDeletedNameMatches = findSoftDeletedNameMatches;
