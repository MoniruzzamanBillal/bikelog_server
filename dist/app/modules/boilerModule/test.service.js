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
exports.orderServices = void 0;
const test_model_1 = __importDefault(require("./test.model"));
// ! create order into DBb
const createOrderInDB = (orderData) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield test_model_1.default.create(orderData);
    return response;
});
//! getting all data from db
const getAllProduct = (email) => __awaiter(void 0, void 0, void 0, function* () {
    let query = {};
    if (email) {
        query = { email };
    }
    const result = yield test_model_1.default.find(query);
    return result;
});
//
exports.orderServices = {
    createOrderInDB,
    getAllProduct,
};
