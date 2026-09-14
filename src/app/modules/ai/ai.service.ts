import { askOpenRouter, TChatMessage } from "../../util/openRouterClient";
import { prisma } from "../../lib/prisma";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { bikeManualServices } from "../bikeManual/bikeManual.service";
import { TBikeManualMeta } from "../bikeManual/bikeManual.interface";
import { mileageRecordServices } from "../mileageRecord/mileageRecord.service";
import { spendingServices } from "../spending/spending.service";
import {
  TBikeChatResponse,
  TChatRequestMessage,
  TMileageInsightResponse,
  TSpendingInsightResponse,
} from "./ai.interface";

const NO_DATA_SPENDING_MESSAGE =
  "No spending data yet for this bike — log a fuel-up or maintenance entry to get an AI-generated spending insight.";

const NO_DATA_MILEAGE_MESSAGE =
  "No mileage data yet for this bike — log a fuel-up to get an AI-generated mileage insight.";

// ! recent-log cap for the chat context — bounds prompt size/cost regardless of how much
// ! history a bike accumulates; a question about older history should be answered honestly
// ! as out-of-scope rather than guessed (see the system prompt below)
const CHAT_LOG_LIMIT = 20;

// ! how many manual excerpts to inject per chat question — bounds prompt size
const MANUAL_CHUNK_TOP_K = 4;

const getSpendingInsightFromDB = async (
  bikeId: string,
  userId: string,
): Promise<TSpendingInsightResponse> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const [fuelLogCount, maintenanceLogCount] = await Promise.all([
    prisma.fuelLog.count({ where: { bikeId, isDeleted: false } }),
    prisma.maintenanceLog.count({ where: { bikeId, isDeleted: false } }),
  ]);
  const currentLogCount = fuelLogCount + maintenanceLogCount;

  if (currentLogCount === 0) {
    return {
      insight: NO_DATA_SPENDING_MESSAGE,
      generated: false,
      cached: false,
    };
  }

  if (
    bike.aiSpendingInsight &&
    bike.aiSpendingInsightLogCount === currentLogCount
  ) {
    return { insight: bike.aiSpendingInsight, generated: true, cached: true };
  }

  const summary = await spendingServices.getSpendingSummaryFromDB(
    bikeId,
    userId,
    "lifetime",
  );

  const systemMessage: TChatMessage = {
    role: "system",
    content:
      `You are a motorcycle spending assistant. Here is this bike's lifetime spending data:\n` +
      `Total spending: ${summary.totalSpending}\n` +
      `Category breakdown: ${JSON.stringify(summary.categoryBreakdown)}\n\n` +
      `Write a short (2-4 sentence), friendly insight about this bike's spending. ` +
      `Only use the numbers given above, never invent figures. ` +
      `Format the reply in markdown — short paragraphs, **bold** for key numbers, and a bullet list if you mention more than one figure; skip headings.`,
  };

  const insight = await askOpenRouter([systemMessage]);

  await prisma.bike.update({
    where: { id: bikeId },
    data: {
      aiSpendingInsight: insight,
      aiSpendingInsightLogCount: currentLogCount,
    },
  });

  return { insight, generated: true, cached: false };
};

const getMileageInsightFromDB = async (
  bikeId: string,
  userId: string,
): Promise<TMileageInsightResponse> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const currentFuelLogCount = await prisma.fuelLog.count({
    where: { bikeId, isDeleted: false },
  });

  if (currentFuelLogCount === 0) {
    return {
      insight: NO_DATA_MILEAGE_MESSAGE,
      generated: false,
      cached: false,
    };
  }

  if (
    bike.aiMileageInsight &&
    bike.aiMileageInsightFuelLogCount === currentFuelLogCount
  ) {
    return { insight: bike.aiMileageInsight, generated: true, cached: true };
  }

  const lifetime = await mileageRecordServices.getLifetimeMileageFromDB(bikeId);
  // ! spec 15's trend endpoint is optional context here — this endpoint must not
  // ! hard-depend on it, lifetime totals alone are enough to generate an insight
  const trend = await mileageRecordServices.getMileageTrendFromDB(bikeId, 3);

  const systemMessage: TChatMessage = {
    role: "system",
    content:
      `You are a motorcycle mileage assistant. Here is this bike's mileage data:\n` +
      `Lifetime totals: ${JSON.stringify(lifetime)}\n` +
      `Last 3 months trend: ${JSON.stringify(trend)}\n\n` +
      `Write a short (2-4 sentence), friendly insight about this bike's fuel mileage. ` +
      `Only use the numbers given above, never invent figures. ` +
      `Format the reply in markdown — short paragraphs, **bold** for key numbers, and a bullet list if you mention more than one figure; skip headings.`,
  };

  const insight = await askOpenRouter([systemMessage]);

  await prisma.bike.update({
    where: { id: bikeId },
    data: {
      aiMileageInsight: insight,
      aiMileageInsightFuelLogCount: currentFuelLogCount,
    },
  });

  return { insight, generated: true, cached: false };
};

const getBikeChatReply = async (
  bikeId: string,
  userId: string,
  messages: TChatRequestMessage[],
): Promise<TBikeChatResponse> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);
  // ! bike.manual is a Prisma Json? column, deserialized as an untyped JsonValue —
  // ! cast to the known shape (same pattern as bikeManual.service.ts)
  const manual = bike.manual as TBikeManualMeta | null;

  const latestUserQuestion =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const [
    rawRecentFuelLogs,
    rawRecentMaintenanceLogs,
    lifetimeSpending,
    relevantManualChunks,
  ] = await Promise.all([
    prisma.fuelLog.findMany({
      where: { bikeId, isDeleted: false },
      orderBy: { date: "desc" },
      take: CHAT_LOG_LIMIT,
    }),
    prisma.maintenanceLog.findMany({
      where: { bikeId, isDeleted: false },
      orderBy: { serviceDate: "desc" },
      take: CHAT_LOG_LIMIT,
      include: { maintenanceType: { select: { name: true } } },
    }),
    spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime"),
    manual
      ? bikeManualServices.getRelevantManualChunksForChat(
          bikeId,
          latestUserQuestion,
          MANUAL_CHUNK_TOP_K,
        )
      : Promise.resolve([]),
  ]);

  // ! JSON.stringify on a raw Prisma Decimal instance produces a STRING in the resulting
  // ! JSON text (e.g. "totalCost":"450.00"), not a bare number — silently changes what the
  // ! model sees. Convert before stringifying, same as the list/get endpoints' toApiShape.
  const recentFuelLogs = rawRecentFuelLogs.map((log) => ({
    ...log,
    pricePerLiter: Number(log.pricePerLiter),
    totalCost: Number(log.totalCost),
  }));
  const recentMaintenanceLogs = rawRecentMaintenanceLogs.map((log) => ({
    ...log,
    cost: Number(log.cost),
  }));

  // ! only non-empty when relevant chunks were actually found — otherwise the section
  // ! is omitted entirely rather than injecting an empty/misleading heading
  const manualSection =
    relevantManualChunks.length > 0
      ? `Relevant excerpts from the owner's manual ("${manual?.originalName}"):\n` +
        relevantManualChunks.map((chunk) => chunk.chunkText).join("\n---\n") +
        `\n\n`
      : "";

  const systemMessage: TChatMessage = {
    role: "system",
    content:
      `You are a helpful assistant for a motorcycle called "${bike.nickname}" ` +
      `(${bike.brand} ${bike.model}). Current odometer: ${bike.currentOdometer} km.\n\n` +
      `Recent fuel logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentFuelLogs)}\n\n` +
      `Recent maintenance logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentMaintenanceLogs)}\n\n` +
      `Lifetime spending: ${JSON.stringify(lifetimeSpending)}\n\n` +
      manualSection +
      `Answer only using the data given above. If asked something this data doesn't cover, ` +
      `say so honestly instead of guessing. ` +
      `Format the reply in markdown — short paragraphs, **bold** for key numbers, and bullet points for lists or breakdowns; skip headings, this is a chat.`,
  };

  const chatMessages: TChatMessage[] = [
    systemMessage,
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const reply = await askOpenRouter(chatMessages);

  return { reply };
};

export const aiServices = {
  getSpendingInsightFromDB,
  getMileageInsightFromDB,
  getBikeChatReply,
};
