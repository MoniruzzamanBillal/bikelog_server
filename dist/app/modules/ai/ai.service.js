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
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiServices = void 0;
const bike_model_1 = require("../bike/bike.model");
const bike_utils_1 = require("../bike/bike.utils");
const fuelLog_model_1 = require("../fuelLog/fuelLog.model");
const maintenanceLog_model_1 = require("../maintenanceLog/maintenanceLog.model");
const mileageRecord_service_1 = require("../mileageRecord/mileageRecord.service");
const spending_service_1 = require("../spending/spending.service");
const openRouterClient_1 = require("../../util/openRouterClient");
const NO_DATA_SPENDING_MESSAGE = "No spending data yet for this bike — log a fuel-up or maintenance entry to get an AI-generated spending insight.";
const NO_DATA_MILEAGE_MESSAGE = "No mileage data yet for this bike — log a fuel-up to get an AI-generated mileage insight.";
// ! recent-log cap for the chat context — bounds prompt size/cost regardless of how much
// ! history a bike accumulates; a question about older history should be answered honestly
// ! as out-of-scope rather than guessed (see the system prompt below)
const CHAT_LOG_LIMIT = 20;
const getSpendingInsightFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const [fuelLogCount, maintenanceLogCount] = yield Promise.all([
        fuelLog_model_1.fuelLogModel.countDocuments({ bike: bikeId, isDeleted: false }),
        maintenanceLog_model_1.maintenanceLogModel.countDocuments({ bike: bikeId, isDeleted: false }),
    ]);
    const currentLogCount = fuelLogCount + maintenanceLogCount;
    if (currentLogCount === 0) {
        return { insight: NO_DATA_SPENDING_MESSAGE, generated: false, cached: false };
    }
    if (bike.aiSpendingInsight &&
        bike.aiSpendingInsightLogCount === currentLogCount) {
        return { insight: bike.aiSpendingInsight, generated: true, cached: true };
    }
    const summary = yield spending_service_1.spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime");
    const systemMessage = {
        role: "system",
        content: `You are a motorcycle spending assistant. Here is this bike's lifetime spending data:\n` +
            `Total spending: ${summary.totalSpending}\n` +
            `Category breakdown: ${JSON.stringify(summary.categoryBreakdown)}\n\n` +
            `Write a short (2-4 sentence), friendly insight about this bike's spending. ` +
            `Only use the numbers given above, never invent figures.`,
    };
    const insight = yield (0, openRouterClient_1.askOpenRouter)([systemMessage]);
    yield bike_model_1.bikeModel.findByIdAndUpdate(bikeId, {
        aiSpendingInsight: insight,
        aiSpendingInsightLogCount: currentLogCount,
    });
    return { insight, generated: true, cached: false };
});
const getMileageInsightFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const currentFuelLogCount = yield fuelLog_model_1.fuelLogModel.countDocuments({
        bike: bikeId,
        isDeleted: false,
    });
    if (currentFuelLogCount === 0) {
        return { insight: NO_DATA_MILEAGE_MESSAGE, generated: false, cached: false };
    }
    if (bike.aiMileageInsight &&
        bike.aiMileageInsightFuelLogCount === currentFuelLogCount) {
        return { insight: bike.aiMileageInsight, generated: true, cached: true };
    }
    const lifetime = yield mileageRecord_service_1.mileageRecordServices.getLifetimeMileageFromDB(bikeId);
    // ! spec 15's trend endpoint is optional context here — this endpoint must not
    // ! hard-depend on it, lifetime totals alone are enough to generate an insight
    const trend = yield mileageRecord_service_1.mileageRecordServices.getMileageTrendFromDB(bikeId, 3);
    const systemMessage = {
        role: "system",
        content: `You are a motorcycle mileage assistant. Here is this bike's mileage data:\n` +
            `Lifetime totals: ${JSON.stringify(lifetime)}\n` +
            `Last 3 months trend: ${JSON.stringify(trend)}\n\n` +
            `Write a short (2-4 sentence), friendly insight about this bike's fuel mileage. ` +
            `Only use the numbers given above, never invent figures.`,
    };
    const insight = yield (0, openRouterClient_1.askOpenRouter)([systemMessage]);
    yield bike_model_1.bikeModel.findByIdAndUpdate(bikeId, {
        aiMileageInsight: insight,
        aiMileageInsightFuelLogCount: currentFuelLogCount,
    });
    return { insight, generated: true, cached: false };
});
const getBikeChatReply = (bikeId, userId, messages) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const [recentFuelLogs, recentMaintenanceLogs, lifetimeSpending] = yield Promise.all([
        fuelLog_model_1.fuelLogModel
            .find({ bike: bikeId, isDeleted: false })
            .sort({ date: -1 })
            .limit(CHAT_LOG_LIMIT)
            .lean(),
        maintenanceLog_model_1.maintenanceLogModel
            .find({ bike: bikeId, isDeleted: false })
            .sort({ date: -1 })
            .limit(CHAT_LOG_LIMIT)
            .populate("maintenanceType", "name")
            .lean(),
        spending_service_1.spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime"),
    ]);
    const systemMessage = {
        role: "system",
        content: `You are a helpful assistant for a motorcycle called "${bike.nickname}" ` +
            `(${bike.brand} ${bike.model}). Current odometer: ${bike.currentOdometer} km.\n\n` +
            `Recent fuel logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentFuelLogs)}\n\n` +
            `Recent maintenance logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentMaintenanceLogs)}\n\n` +
            `Lifetime spending: ${JSON.stringify(lifetimeSpending)}\n\n` +
            `Answer only using the data given above. If asked something this data doesn't cover, ` +
            `say so honestly instead of guessing.`,
    };
    const chatMessages = [
        systemMessage,
        ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const reply = yield (0, openRouterClient_1.askOpenRouter)(chatMessages);
    return { reply };
});
exports.aiServices = {
    getSpendingInsightFromDB,
    getMileageInsightFromDB,
    getBikeChatReply,
};
