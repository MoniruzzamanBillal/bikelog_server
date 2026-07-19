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
const bike_model_1 = require("./bike.model");
const bike_utils_1 = require("./bike.utils");
const createBikeIntoDB = (payload, userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const startingOdometer = (_a = payload.currentOdometer) !== null && _a !== void 0 ? _a : 0;
    const bikeData = Object.assign(Object.assign({}, payload), { owner: userId, currentOdometer: startingOdometer, initialOdometer: startingOdometer });
    const result = yield bike_model_1.bikeModel.create(bikeData);
    return result;
});
const getBikesFromDB = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bike_model_1.bikeModel.find({ owner: userId, isDeleted: false });
    return result;
});
const getBikeByIdFromDB = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(id, userId);
    return bike;
});
const updateBikeInDB = (id, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(id, userId);
    const allowedPayload = Object.assign({}, payload);
    delete allowedPayload.owner;
    delete allowedPayload.currentOdometer;
    delete allowedPayload.initialOdometer;
    Object.assign(bike, allowedPayload);
    yield bike.save();
    return bike;
});
const deleteBikeFromDB = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(id, userId);
    bike.isDeleted = true;
    yield bike.save();
    return bike;
});
exports.bikeServices = {
    createBikeIntoDB,
    getBikesFromDB,
    getBikeByIdFromDB,
    updateBikeInDB,
    deleteBikeFromDB,
    bumpOdometerIfHigher: bike_utils_1.bumpOdometerIfHigher,
};
