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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const test_service_1 = require("./test.service");
const test_validation_1 = require("./test.validation");
// ! creating order
const createOrder = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const data = req.body;
    const parsedData = test_validation_1.orderValidationSchema.parse(data);
    const result = yield test_service_1.orderServices.createOrderInDB(parsedData);
    const resultObj = result.toObject();
    const _a = resultObj, { _id, __v } = _a, dataWithoutId = __rest(_a, ["_id", "__v"]);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "testing !!! ",
        data: dataWithoutId,
    });
}));
// ! getting all orders from DB
const getAllOrder = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userEmail = req.query.email;
    const result = yield test_service_1.orderServices.getAllProduct(userEmail);
    const resultObjWithoutId = result.map((res) => {
        const result = res.toObject();
        const _a = result, { _id, __v } = _a, dataWithoutId = __rest(_a, ["_id", "__v"]);
        return dataWithoutId;
    });
    res.status(200).json({
        success: true,
        message: "Orders fetched successfully for user email!",
        data: resultObjWithoutId,
    });
}));
exports.orderController = {
    getAllOrder,
    createOrder,
};
