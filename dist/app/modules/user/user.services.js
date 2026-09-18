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
exports.userServices = void 0;
const argon2_1 = __importDefault(require("argon2"));
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const config_1 = __importDefault(require("../../config"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
// every field except `password`, so a newly-added sensitive field never leaks by accident
const safeUserSelect = {
    id: true,
    name: true,
    email: true,
    isDeleted: true,
    userRole: true,
    expoPushToken: true,
    createdAt: true,
    updatedAt: true,
};
// ! for creating a user
const createUser = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const hashedPassword = yield argon2_1.default.hash(payload.password);
        const result = yield prisma_1.prisma.user.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                name: payload.name,
                email: payload.email,
                password: hashedPassword,
            },
            select: safeUserSelect,
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new AppError_1.default(http_status_1.default.CONFLICT, "A user with this email already exists");
        }
        throw error;
    }
});
const loginFromDb = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    const userData = yield prisma_1.prisma.user.findUnique({
        where: { email: payload === null || payload === void 0 ? void 0 : payload.email },
    });
    if (!userData) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User dont exist with this email !!!");
    }
    const isPasswordMatch = yield argon2_1.default.verify(userData === null || userData === void 0 ? void 0 : userData.password, payload === null || payload === void 0 ? void 0 : payload.password);
    if (!isPasswordMatch) {
        throw new AppError_1.default(http_status_1.default.FORBIDDEN, "Password don't match !!");
    }
    const jwtPayload = {
        userId: userData === null || userData === void 0 ? void 0 : userData.id,
        userEmail: userData === null || userData === void 0 ? void 0 : userData.email,
        userRole: userData === null || userData === void 0 ? void 0 : userData.userRole,
    };
    const token = jsonwebtoken_1.default.sign(jwtPayload, config_1.default.jwt_secret, {
        expiresIn: config_1.default.jwt_expires_in,
    });
    return token;
});
const getMeFromDb = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: safeUserSelect,
    });
    if (!result) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
// ! registers/updates this device's Expo push token, feeding the weekly-summary cron job
const updatePushToken = (userId, expoPushToken) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    const result = yield prisma_1.prisma.user.update({
        where: { id: userId },
        data: { expoPushToken },
        select: safeUserSelect,
    });
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
//
exports.userServices = {
    createUser,
    loginFromDb,
    getMeFromDb,
    updatePushToken,
};
