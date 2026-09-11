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
export const askOpenRouter = async (
  messages: TChatMessage[],
  options?: TAskOptions,
): Promise<string> => {
  let lastError: unknown;

  for (const model of FREE_MODELS) {
    try {
      const response = await openRouterClient.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        ...(options?.jsonMode
          ? { response_format: { type: "json_object" as const } }
          : {}),
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error("Empty response from model");
      }

      return content;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  console.error("openRouterClient: all free models failed", lastError);

  throw new AppError(
    httpStatus.SERVICE_UNAVAILABLE,
    "AI service is busy right now, please try again shortly",
  );
};
