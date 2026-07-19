"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openai = void 0;
const openai_1 = __importDefault(require("openai"));
const config_1 = __importDefault(require("../config"));
exports.openai = new openai_1.default({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config_1.default.openRouterApiKey,
});
