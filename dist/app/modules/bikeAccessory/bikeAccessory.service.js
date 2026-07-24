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
const bike_utils_1 = require("../bike/bike.utils");
const bikeAccessory_constant_1 = require("./bikeAccessory.constant");
const bikeAccessory_model_1 = require("./bikeAccessory.model");
const createBikeAccessoryIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessoryData = Object.assign(Object.assign({}, payload), { bike: bikeId });
    const accessory = yield bikeAccessory_model_1.bikeAccessoryModel.create(accessoryData);
    return accessory;
});
const getBikeAccessoriesFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach the filter object —
    // ! an unsanitized `?bike=<otherBikeId>` would otherwise override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const filterQuery = Object.assign({}, sanitizedQuery);
    delete filterQuery.searchTerm;
    delete filterQuery.sort;
    delete filterQuery.limit;
    delete filterQuery.page;
    delete filterQuery.fields;
    // ! grouping is done by running one query per status (in the enum's declared order) and
    // ! merging the results, rather than a persisted/derived rank field — this sorts correctly
    // ! on documents that already existed before this change, with no migration step required
    const statusOrder = Object.values(bikeAccessory_constant_1.AccessoryStatus);
    const requestedStatuses = typeof filterQuery.status === "string" &&
        statusOrder.includes(filterQuery.status)
        ? [filterQuery.status]
        : statusOrder;
    delete filterQuery.status;
    const sortBy = (typeof sanitizedQuery.sort === "string" ? sanitizedQuery.sort : "")
        .split(",")
        .join(" ") || "-createdAt";
    const fields = (typeof sanitizedQuery.fields === "string" ? sanitizedQuery.fields : "")
        .split(",")
        .join(" ") || "-__v";
    const limit = Number(sanitizedQuery.limit) || 10;
    const page = Number(sanitizedQuery.page) || 1;
    const skip = (page - 1) * limit;
    const baseFilter = Object.assign({ bike: bikeId, isDeleted: false }, filterQuery);
    const resultsByStatus = yield Promise.all(requestedStatuses.map((status) => bikeAccessory_model_1.bikeAccessoryModel
        .find(Object.assign(Object.assign({}, baseFilter), { status }))
        .sort(sortBy)
        .select(fields)));
    const result = resultsByStatus.flat().slice(skip, skip + limit);
    const meta = yield bikeAccessory_model_1.bikeAccessoryModel.countDocuments(Object.assign(Object.assign({}, baseFilter), { status: { $in: requestedStatuses } }));
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
