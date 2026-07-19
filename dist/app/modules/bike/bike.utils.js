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
exports.bumpOdometerIfHigher = exports.findOwnedBikeOrThrow = void 0;
const http_status_1 = __importDefault(require("http-status"));
const bike_model_1 = require("./bike.model");
const AppError_1 = __importDefault(require("../../Error/AppError"));
const findOwnedBikeOrThrow = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield bike_model_1.bikeModel.findOne({
        _id: bikeId,
        owner: userId,
        isDeleted: false,
    });
    if (!bike)
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike not found");
    return bike;
});
exports.findOwnedBikeOrThrow = findOwnedBikeOrThrow;
const bumpOdometerIfHigher = (bike, newReading) => __awaiter(void 0, void 0, void 0, function* () {
    if (newReading > bike.currentOdometer) {
        bike.currentOdometer = newReading;
        yield bike.save();
    }
});
exports.bumpOdometerIfHigher = bumpOdometerIfHigher;
