import httpStatus from "http-status";
import OpenAI from "openai";
import AppError from "../Error/AppError";
import config from "../config";

export type TChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type TAskOptions = {
  jsonMode?: boolean;
  temperature?: number;
};

const openRouterClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openRouterApiKey,
  timeout: 20_000,
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
const PER_MODEL_TIMEOUT_MS = 8_000;
const TOTAL_BUDGET_MS = 25_000;

// ! single choke point every ai feature talks through
export const askOpenRouter = async (
  messages: TChatMessage[],
  options?: TAskOptions,
): Promise<string> => {
  let lastError: unknown;
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
      const response = await openRouterClient.chat.completions.create(
        {
          model,
          messages,
          temperature: options?.temperature ?? 0.7,
          ...(options?.jsonMode
            ? { response_format: { type: "json_object" as const } }
            : {}),
        },
        { signal: controller.signal },
      );

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error("Empty response from model");
      }

      console.error(
        `openRouterClient: ${model} ok in ${Date.now() - attemptStartedAt}ms`,
      );
      return content;
    } catch (error) {
      lastError = error;
      const outcome = controller.signal.aborted
        ? "abort"
        : ((error as { status?: number })?.status ?? "error");
      console.error(
        `openRouterClient: ${model} failed (${outcome}) after ${Date.now() - attemptStartedAt}ms`,
      );
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  console.error("openRouterClient: all free models failed", lastError);

  throw new AppError(
    httpStatus.SERVICE_UNAVAILABLE,
    "AI service is busy right now, please try again shortly",
  );
};
