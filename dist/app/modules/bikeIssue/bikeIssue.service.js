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
exports.bikeIssueServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const Queryuilder_1 = __importDefault(require("../../builder/Queryuilder"));
const bike_utils_1 = require("../bike/bike.utils");
const bikeIssue_constant_1 = require("./bikeIssue.constant");
const bikeIssue_model_1 = require("./bikeIssue.model");
const createBikeIssueIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issueData = Object.assign(Object.assign({}, payload), { bike: bikeId, status: bikeIssue_constant_1.BikeIssueStatus.open, dateReported: (_a = payload.dateReported) !== null && _a !== void 0 ? _a : new Date() });
    const issue = yield bikeIssue_model_1.bikeIssueModel.create(issueData);
    return issue;
});
const getBikeIssuesFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
    // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
    // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const issuesQuery = new Queryuilder_1.default(bikeIssue_model_1.bikeIssueModel.find({ bike: bikeId, isDeleted: false }), sanitizedQuery)
        .filter()
        .sort("-dateReported")
        .pagination()
        .field();
    const result = yield issuesQuery.queryModel;
    const meta = yield issuesQuery.countTotal();
    return { result, meta };
});
const getBikeIssueByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield bikeIssue_model_1.bikeIssueModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    return issue;
});
const updateBikeIssueInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield bikeIssue_model_1.bikeIssueModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    const updateData = Object.assign({}, payload);
    delete updateData.status;
    Object.assign(issue, updateData);
    yield issue.save();
    return issue;
});
const deleteBikeIssueFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield bikeIssue_model_1.bikeIssueModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    issue.isDeleted = true;
    yield issue.save();
    return issue;
});
const reopenBikeIssueInDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield bikeIssue_model_1.bikeIssueModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    if (issue.status === bikeIssue_constant_1.BikeIssueStatus.open) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Issue is already open");
    }
    const result = yield bikeIssue_model_1.bikeIssueModel.findByIdAndUpdate(issue === null || issue === void 0 ? void 0 : issue.id, {
        status: bikeIssue_constant_1.BikeIssueStatus.open,
    });
    return result;
});
exports.bikeIssueServices = {
    createBikeIssueIntoDB,
    getBikeIssuesFromDB,
    getBikeIssueByIdFromDB,
    updateBikeIssueInDB,
    deleteBikeIssueFromDB,
    reopenBikeIssueInDB,
};
