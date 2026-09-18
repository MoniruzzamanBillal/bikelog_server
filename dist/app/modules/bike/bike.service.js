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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeServices = void 0;
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const bike_utils_1 = require("./bike.utils");
// every Bike row returned to a controller gets both the Prisma-era `id`→`_id`
// remap (spec 31 decision A) and the relational `ownerId`→`owner` remap that
// both clients' TBike type still requires (spec 32 decision A)
const toApiShape = (bike) => (Object.assign(Object.assign({}, bike), { _id: bike.id, owner: bike.ownerId }));
const createBikeIntoDB = (payload, userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const startingOdometer = (_a = payload.currentOdometer) !== null && _a !== void 0 ? _a : 0;
    const bike = yield prisma_1.prisma.bike.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            nickname: payload.nickname,
            brand: payload.brand,
            model: payload.model,
            registrationNumber: payload.registrationNumber,
            purchaseDate: payload.purchaseDate,
            fuelTankCapacityLiters: payload.fuelTankCapacityLiters,
            ownerId: userId,
            currentOdometer: startingOdometer,
            initialOdometer: startingOdometer,
        },
    });
    return toApiShape(bike);
});
const getBikesFromDB = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.bike.findMany({
        where: { ownerId: userId, isDeleted: false },
    });
    return result.map(toApiShape);
});
const getBikeByIdFromDB = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(id, userId);
    return toApiShape(bike);
});
const updateBikeInDB = (id, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(id, userId);
    // ! defensive strip — currentOdometer is technically a valid field on
    // ! updateBikeSchema, but this endpoint has never allowed writing it
    // ! directly; port that behavior verbatim, don't "fix" it into editable
    const allowedPayload = Object.assign({}, payload);
    delete allowedPayload.owner;
    delete allowedPayload.currentOdometer;
    delete allowedPayload.initialOdometer;
    const updated = yield prisma_1.prisma.bike.update({
        where: { id: bike.id },
        data: allowedPayload,
    });
    return toApiShape(updated);
});
const deleteBikeFromDB = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(id, userId);
    const updated = yield prisma_1.prisma.bike.update({
        where: { id: bike.id },
        data: { isDeleted: true },
    });
    return toApiShape(updated);
});
exports.bikeServices = {
    createBikeIntoDB,
    getBikesFromDB,
    getBikeByIdFromDB,
    updateBikeInDB,
    deleteBikeFromDB,
    bumpOdometerIfHigher: bike_utils_1.bumpOdometerIfHigher,
};
