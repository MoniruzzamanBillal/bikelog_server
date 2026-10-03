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
// ! ordered by MEASURED latency (direct OpenRouter probes, 2026-10-01): super-120b 3.1s,
// ! ling-3.0-flash 4.3s, lfm-2.5 5.3s. The two 429 entries fail in <1s today, so they sit at the
// ! tail where a cheap failure costs nothing. Dropped: nemotron-3.5-lightning and
// ! nemotron-3-nano-omni (both hang, no response at 45s), minimax-m2.7 (404, unavailable for free).
// ! Free-model availability moves - re-check against the per-model logs in askOpenRouter.
const FREE_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "inclusionai/ling-3.0-flash-sante:free",
    "liquid/lfm-2.5-2.6b:free",
    "google/gemma-4-31b-it:free",
    "qwen/qwen3.8-27b:free",
];
// ! the OpenAI client-level timeout does not reliably abort stalled free-model requests, so
// ! every attempt gets its own AbortController. 8s sits above the 3-5s working models need;
// ! the total budget keeps the whole fallback walk well inside the clients' 60s axios cap.
const PER_MODEL_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 25000;
// ! single choke point every ai feature talks through
const askOpenRouter = (messages, options) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    let lastError;
    const startedAt = Date.now();
    for (const model of FREE_MODELS) {
        if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
            console.error("openRouterClient: total time budget exceeded, giving up");
            break;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
        const attemptStartedAt = Date.now();
        try {
            const response = yield openRouterClient.chat.completions.create(Object.assign({ model,
                messages, temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7 }, ((options === null || options === void 0 ? void 0 : options.jsonMode)
                ? { response_format: { type: "json_object" } }
                : {})), { signal: controller.signal });
            const content = (_c = (_b = response.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content;
            if (!content) {
                throw new Error("Empty response from model");
            }
            console.error(`openRouterClient: ${model} ok in ${Date.now() - attemptStartedAt}ms`);
            return content;
        }
        catch (error) {
            lastError = error;
            const outcome = controller.signal.aborted
                ? "abort"
                : ((_d = error === null || error === void 0 ? void 0 : error.status) !== null && _d !== void 0 ? _d : "error");
            console.error(`openRouterClient: ${model} failed (${outcome}) after ${Date.now() - attemptStartedAt}ms`);
            continue;
        }
        finally {
            clearTimeout(timer);
        }
    }
    console.error("openRouterClient: all free models failed", lastError);
    throw new AppError_1.default(http_status_1.default.SERVICE_UNAVAILABLE, "AI service is busy right now, please try again shortly");
});
exports.askOpenRouter = askOpenRouter;
