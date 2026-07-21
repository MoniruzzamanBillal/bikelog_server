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
exports.bikeAccessoryServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const Queryuilder_1 = __importDefault(require("../../builder/Queryuilder"));
const bike_utils_1 = require("../bike/bike.utils");
const bikeAccessory_model_1 = require("./bikeAccessory.model");
const createBikeAccessoryIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessoryData = Object.assign(Object.assign({}, payload), { bike: bikeId });
    const accessory = yield bikeAccessory_model_1.bikeAccessoryModel.create(accessoryData);
    return accessory;
});
const getBikeAccessoriesFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
    // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
    // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const accessoriesQuery = new Queryuilder_1.default(bikeAccessory_model_1.bikeAccessoryModel.find({ bike: bikeId, isDeleted: false }), sanitizedQuery)
        .filter()
        .sort()
        .pagination()
        .field();
    const result = yield accessoriesQuery.queryModel;
    const meta = yield accessoriesQuery.countTotal();
    return { result, meta };
});
const getBikeAccessoryByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield bikeAccessory_model_1.bikeAccessoryModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    return accessory;
});
const updateBikeAccessoryInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield bikeAccessory_model_1.bikeAccessoryModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    Object.assign(accessory, payload);
    yield accessory.save();
    return accessory;
});
const deleteBikeAccessoryFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield bikeAccessory_model_1.bikeAccessoryModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    accessory.isDeleted = true;
    yield accessory.save();
    return accessory;
});
exports.bikeAccessoryServices = {
    createBikeAccessoryIntoDB,
    getBikeAccessoriesFromDB,
    getBikeAccessoryByIdFromDB,
    updateBikeAccessoryInDB,
    deleteBikeAccessoryFromDB,
};
