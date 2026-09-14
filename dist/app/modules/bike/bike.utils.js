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
exports.updateBikeManual = exports.bumpOdometerIfHigher = exports.findOwnedBikeOrThrow = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
// Returns the raw Prisma row (ownerId, id — NOT API-shaped with _id/owner).
// Consumed internally by 9 other still-Mongoose-backed modules, all of which
// either discard the return value or read a plain scalar field off it —
// never send this directly as an HTTP response body.
const findOwnedBikeOrThrow = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield prisma_1.prisma.bike.findFirst({
        where: { id: bikeId, ownerId: userId, isDeleted: false },
    });
    if (!bike)
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike not found");
    return bike;
});
exports.findOwnedBikeOrThrow = findOwnedBikeOrThrow;
const bumpOdometerIfHigher = (bike, newReading) => __awaiter(void 0, void 0, void 0, function* () {
    if (newReading > bike.currentOdometer) {
        yield prisma_1.prisma.bike.update({
            where: { id: bike.id },
            data: { currentOdometer: newReading },
        });
    }
});
exports.bumpOdometerIfHigher = bumpOdometerIfHigher;
// ! only used by bikeManual.service.ts (replaces its old `bike.manual = ...; bike.save()`
// ! pattern, which broke the moment findOwnedBikeOrThrow stopped returning a Mongoose doc)
const updateBikeManual = (bikeId, manual) => __awaiter(void 0, void 0, void 0, function* () {
    return prisma_1.prisma.bike.update({
        where: { id: bikeId },
        data: { manual: manual === null ? client_1.Prisma.JsonNull : manual },
    });
});
exports.updateBikeManual = updateBikeManual;
