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
        orderBy: { name: "asc" },
    });
    return result.map((item) => (Object.assign(Object.assign({}, item), { _id: item.id })));
});
exports.engineOilTypeServices = {
    createEngineOilTypeIntoDB,
    getEngineOilTypesFromDB,
};
