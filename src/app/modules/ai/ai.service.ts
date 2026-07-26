import { bikeModel } from "../bike/bike.model";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { fuelLogModel } from "../fuelLog/fuelLog.model";
import { maintenanceLogModel } from "../maintenanceLog/maintenanceLog.model";
import { mileageRecordServices } from "../mileageRecord/mileageRecord.service";
import { spendingServices } from "../spending/spending.service";
import { askOpenRouter, TChatMessage } from "../../util/openRouterClient";
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

const getSpendingInsightFromDB = async (
  bikeId: string,
  userId: string,
): Promise<TSpendingInsightResponse> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const [fuelLogCount, maintenanceLogCount] = await Promise.all([
    fuelLogModel.countDocuments({ bike: bikeId, isDeleted: false }),
    maintenanceLogModel.countDocuments({ bike: bikeId, isDeleted: false }),
  ]);
  const currentLogCount = fuelLogCount + maintenanceLogCount;

  if (currentLogCount === 0) {
    return { insight: NO_DATA_SPENDING_MESSAGE, generated: false, cached: false };
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
      `Only use the numbers given above, never invent figures.`,
  };

  const insight = await askOpenRouter([systemMessage]);

  await bikeModel.findByIdAndUpdate(bikeId, {
    aiSpendingInsight: insight,
    aiSpendingInsightLogCount: currentLogCount,
  });

  return { insight, generated: true, cached: false };
};

const getMileageInsightFromDB = async (
  bikeId: string,
  userId: string,
): Promise<TMileageInsightResponse> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const currentFuelLogCount = await fuelLogModel.countDocuments({
    bike: bikeId,
    isDeleted: false,
  });

  if (currentFuelLogCount === 0) {
    return { insight: NO_DATA_MILEAGE_MESSAGE, generated: false, cached: false };
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
      `Only use the numbers given above, never invent figures.`,
  };

  const insight = await askOpenRouter([systemMessage]);

  await bikeModel.findByIdAndUpdate(bikeId, {
    aiMileageInsight: insight,
    aiMileageInsightFuelLogCount: currentFuelLogCount,
  });

  return { insight, generated: true, cached: false };
};

const getBikeChatReply = async (
  bikeId: string,
  userId: string,
  messages: TChatRequestMessage[],
): Promise<TBikeChatResponse> => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const [recentFuelLogs, recentMaintenanceLogs, lifetimeSpending] = await Promise.all([
    fuelLogModel
      .find({ bike: bikeId, isDeleted: false })
      .sort({ date: -1 })
      .limit(CHAT_LOG_LIMIT)
      .lean(),
    maintenanceLogModel
      .find({ bike: bikeId, isDeleted: false })
      .sort({ date: -1 })
      .limit(CHAT_LOG_LIMIT)
      .populate("maintenanceType", "name")
      .lean(),
    spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime"),
  ]);

  const systemMessage: TChatMessage = {
    role: "system",
    content:
      `You are a helpful assistant for a motorcycle called "${bike.nickname}" ` +
      `(${bike.brand} ${bike.model}). Current odometer: ${bike.currentOdometer} km.\n\n` +
      `Recent fuel logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentFuelLogs)}\n\n` +
      `Recent maintenance logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentMaintenanceLogs)}\n\n` +
      `Lifetime spending: ${JSON.stringify(lifetimeSpending)}\n\n` +
      `Answer only using the data given above. If asked something this data doesn't cover, ` +
      `say so honestly instead of guessing.`,
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
