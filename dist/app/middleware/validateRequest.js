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
const catchAsync_1 = __importDefault(require("../util/catchAsync"));
const validateRequest = (Schema) => {
    return (0, catchAsync_1.default)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
        const parsed = yield Schema.parseAsync({
            body: req.body,
        });
        // ! reassign the parsed result back onto req.body — zod strips unrecognized keys by
        // ! default, but that only takes effect if the parsed output is actually used; without
        // ! this, unvalidated/extra client-supplied fields (e.g. isDeleted, owner) reach services untouched
        req.body = parsed.body;
        next();
    }));
};
exports.default = validateRequest;
