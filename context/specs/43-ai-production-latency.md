# 43: AI production latency

Status: ✅ Complete — implemented 2026-10-02.

## Problem

AI chat / insights time out in production. The backend answers correctly but too slowly: chat took 36.4 / 60.2 / 44.9 / 54.7 / 24.2s over 5 runs; `/ai/spending-insight` took 147s. Both clients cap axios at 60s and Vercel has its own duration limit, so requests are cancelled.

## Root cause

`askOpenRouter` walks `FREE_MODELS` in order. Measured 2026-10-01:

| model | result |
| --- | --- |
| nvidia/nemotron-3.5-lightning:free | hangs (no response at 15s / 45s) |
| google/gemma-4-26b-a4b-it:free | 429 in 0.5s |
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | hangs (45s) |
| nvidia/nemotron-3-super-120b-a12b:free | 200 in 3.1s |
| minimax/minimax-m2.7:free | 404, unavailable for free |

The client-level `timeout: 20_000` does not reliably abort stalled requests; an explicit `AbortController` does. Regression introduced by 17f953f.

Secondary: cross-region DB latency (iad1 -> ap-southeast-1), unbounded manual chunk read (87 chunks / ~120 KB per message), insight cache never written when the request is killed.

## Design

1. `openRouterClient.ts`: per-attempt `AbortController` (`PER_MODEL_TIMEOUT_MS = 8_000`), `TOTAL_BUDGET_MS = 25_000` checked before each attempt, existing 503 as terminal case.
2. Replace `FREE_MODELS` with the measured list; hanging and dead slugs dropped, 429 entries kept at the tail.
3. Log model, elapsed ms and outcome for every attempt.
4. `getRelevantManualChunksForChat`: SQL keyword pre-filter (`tokenize` + `contains`, insensitive) with `take: 40`; unfiltered fallback only when nothing matches. Full-text search is a separate future spec.
5. Chat prompt: `CHAT_LOG_LIMIT` 20 -> 8, project only model-useful log fields, cap manual excerpts at 1,200 chars.

No response shape changes; no client changes. `vercel.json` untouched.
