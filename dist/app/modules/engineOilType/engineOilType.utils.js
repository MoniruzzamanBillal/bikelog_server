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
exports.findOwnedEngineOilTypeOrThrow = void 0;
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
