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
exports.findOwnedMaintenanceTypeOrThrow = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
// Spec 46 §D. Mirrors `findOwnedBikeOrThrow` (bike.utils.ts) deliberately: one query, one
// 404, collapsing "no such id", "soft-deleted" and "belongs to another user" into a single
// indistinguishable path.
//
// ! 404, not 403 (§E). It is this repo's established convention for exactly this case, it
// ! needs no client change (both clients already render a 404 from these endpoints — the
// ! spec 41 soft-delete path), and it does not confirm the existence of another user's row.
//
// Returns the raw Prisma row (`id`/`ownerId`, NOT the `_id`-shaped wire contract) — callers
// either discard it or read a scalar off it before shaping their own response.
const findOwnedMaintenanceTypeOrThrow = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const row = yield prisma_1.prisma.maintenanceType.findFirst({
        where: { id, ownerId: userId, isDeleted: false },
    });
    if (!row) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
    }
    return row;
});
exports.findOwnedMaintenanceTypeOrThrow = findOwnedMaintenanceTypeOrThrow;
