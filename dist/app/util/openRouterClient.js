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
exports.askOpenRouter = void 0;
const http_status_1 = __importDefault(require("http-status"));
const openai_1 = __importDefault(require("openai"));
const AppError_1 = __importDefault(require("../Error/AppError"));
const config_1 = __importDefault(require("../config"));
const openRouterClient = new openai_1.default({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config_1.default.openRouterApiKey,
    timeout: 20000,
    maxRetries: 0,
    defaultHeaders: {
        // ! placeholder — swap for bikelog_client-web-'s deployed URL once it has one
        "HTTP-Referer": "https://bikelog-server.vercel.app",
        "X-Title": "Bike Log",
    },
});
// ! free models to try in order - if one is rate limited/down, fall back to the next
// ! ordered fastest-first by architecture, not measured latency (no live benchmark run against
// ! OpenRouter for this pass): "lightning" is explicitly speed-branded; gemma-4-26b-a4b-it's 4B
// ! active params (MoE) beat nano-omni's 3B once you factor in nano-omni's "-reasoning" variant,
// ! which emits extra chain-of-thought tokens before the real answer, inflating total latency
// ! despite its smaller active size; nemotron-3-super's 12B active params make it slower still;
// ! minimax-m2.7 is MiniMax's large flagship-tier model, placed last as the likely slowest.
// ! Re-order this list from real timing data (e.g. log askOpenRouter's per-model duration) once
// ! that's available - this ordering is a best-effort inference, not a confirmed ranking.
const FREE_MODELS = [
    "nvidia/nemotron-3.5-lightning:free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "minimax/minimax-m2.7:free",
];
// ! single choke point every ai feature talks through
const askOpenRouter = (messages, options) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    let lastError;
    for (const model of FREE_MODELS) {
        try {
            const response = yield openRouterClient.chat.completions.create(Object.assign({ model,
                messages, temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7 }, ((options === null || options === void 0 ? void 0 : options.jsonMode)
                ? { response_format: { type: "json_object" } }
                : {})));
            const content = (_c = (_b = response.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content;
            if (!content) {
                throw new Error("Empty response from model");
            }
            return content;
        }
        catch (error) {
            lastError = error;
            continue;
        }
    }
    console.error("openRouterClient: all free models failed", lastError);
    throw new AppError_1.default(http_status_1.default.SERVICE_UNAVAILABLE, "AI service is busy right now, please try again shortly");
});
exports.askOpenRouter = askOpenRouter;
