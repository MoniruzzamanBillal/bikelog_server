"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateObjectId = void 0;
const bson_objectid_1 = __importDefault(require("bson-objectid"));
const generateObjectId = () => new bson_objectid_1.default().toHexString();
exports.generateObjectId = generateObjectId;
