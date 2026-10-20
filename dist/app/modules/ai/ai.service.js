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
const prisma_1 = require("../../lib/prisma");
const openRouterClient_1 = require("../../util/openRouterClient");
const bike_utils_1 = require("../bike/bike.utils");
const bikeManual_service_1 = require("../bikeManual/bikeManual.service");
const mileageRecord_service_1 = require("../mileageRecord/mileageRecord.service");
const spending_service_1 = require("../spending/spending.service");
const NO_DATA_SPENDING_MESSAGE = "No spending data yet for this bike — log a fuel-up, a maintenance entry or an engine oil change to get an AI-generated spending insight.";
const NO_DATA_MILEAGE_MESSAGE = "No mileage data yet for this bike — log a fuel-up to get an AI-generated mileage insight.";
// ! recent-log cap for the chat context — bounds prompt size/cost regardless of how much
// ! history a bike accumulates; a question about older history should be answered honestly
// ! as out-of-scope rather than guessed (see the system prompt below)
const CHAT_LOG_LIMIT = 8;
// ! how many manual excerpts to inject per chat question — bounds prompt size
const MANUAL_CHUNK_TOP_K = 4;
// ! per-excerpt character cap so four long chunks can't dominate the prompt
const MANUAL_CHUNK_MAX_CHARS = 1200;
const getSpendingInsightFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! Spec 58 K1: all THREE spending tables, because getSpendingSummaryFromDB sums all
    // ! three (spec 54 §F added the `Engine Oil` category). This sum is both the cache key
    // ! and the no-data guard below, so omitting oil meant an oil change moved the numbers
    // ! the insight is generated from without moving the count that decides whether to
    // ! regenerate — a cached insight describing spending it was never told had changed.
    // ! Do NOT copy this into getMileageInsightFromDB: an oil change does not move km/l (HK4).
    const [fuelLogCount, maintenanceLogCount, engineOilLogCount] = yield Promise.all([
        prisma_1.prisma.fuelLog.count({ where: { bikeId, isDeleted: false } }),
        prisma_1.prisma.maintenanceLog.count({ where: { bikeId, isDeleted: false } }),
        prisma_1.prisma.engineOilLog.count({ where: { bikeId, isDeleted: false } }),
    ]);
    const currentLogCount = fuelLogCount + maintenanceLogCount + engineOilLogCount;
    if (currentLogCount === 0) {
        return {
            insight: NO_DATA_SPENDING_MESSAGE,
            generated: false,
            cached: false,
        };
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
            `Only use the numbers given above, never invent figures. ` +
            `Format the reply in markdown — short paragraphs, **bold** for key numbers, and a bullet list if you mention more than one figure; skip headings.`,
    };
    const insight = yield (0, openRouterClient_1.askOpenRouter)([systemMessage]);
    yield prisma_1.prisma.bike.update({
        where: { id: bikeId },
        data: {
            aiSpendingInsight: insight,
            aiSpendingInsightLogCount: currentLogCount,
        },
    });
    return { insight, generated: true, cached: false };
});
const getMileageInsightFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const currentFuelLogCount = yield prisma_1.prisma.fuelLog.count({
        where: { bikeId, isDeleted: false },
    });
    if (currentFuelLogCount === 0) {
        return {
            insight: NO_DATA_MILEAGE_MESSAGE,
            generated: false,
            cached: false,
        };
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
            `Only use the numbers given above, never invent figures. ` +
            `Format the reply in markdown — short paragraphs, **bold** for key numbers, and a bullet list if you mention more than one figure; skip headings.`,
    };
    const insight = yield (0, openRouterClient_1.askOpenRouter)([systemMessage]);
    yield prisma_1.prisma.bike.update({
        where: { id: bikeId },
        data: {
            aiMileageInsight: insight,
            aiMileageInsightFuelLogCount: currentFuelLogCount,
        },
    });
    return { insight, generated: true, cached: false };
});
const getBikeChatReply = (bikeId, userId, messages) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! bike.manual is a Prisma Json? column, deserialized as an untyped JsonValue —
    // ! cast to the known shape (same pattern as bikeManual.service.ts)
    const manual = bike.manual;
    const latestUserQuestion = (_b = (_a = [...messages].reverse().find((m) => m.role === "user")) === null || _a === void 0 ? void 0 : _a.content) !== null && _b !== void 0 ? _b : "";
    const [rawRecentFuelLogs, rawRecentMaintenanceLogs, rawRecentEngineOilLogs, lifetimeSpending, relevantManualChunks,] = yield Promise.all([
        prisma_1.prisma.fuelLog.findMany({
            where: { bikeId, isDeleted: false },
            orderBy: { date: "desc" },
            take: CHAT_LOG_LIMIT,
        }),
        prisma_1.prisma.maintenanceLog.findMany({
            where: { bikeId, isDeleted: false },
            orderBy: { serviceDate: "desc" },
            take: CHAT_LOG_LIMIT,
            include: { maintenanceType: { select: { name: true } } },
        }),
        // ! Spec 58 K2: engine oil is its own table since spec 54, and that spec's `--finalize`
        // ! soft-deleted the source maintenance logs — so without this query the model is told
        // ! the bike has never had an oil change, and answers the app's first suggested chip
        // ! ("When is my next oil change due?") confidently and wrongly.
        prisma_1.prisma.engineOilLog.findMany({
            where: { bikeId, isDeleted: false },
            // ! the same `changeDate` tie-break the rest of the oil module uses, so two changes
            // ! on one calendar day reach the prompt in the order the app's list shows them
            orderBy: [{ changeDate: "desc" }, { createdAt: "desc" }],
            take: CHAT_LOG_LIMIT,
            include: { oilType: { select: { name: true } } },
        }),
        spending_service_1.spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime"),
        manual
            ? bikeManual_service_1.bikeManualServices.getRelevantManualChunksForChat(bikeId, latestUserQuestion, MANUAL_CHUNK_TOP_K)
            : Promise.resolve([]),
    ]);
    // ! JSON.stringify on a raw Prisma Decimal instance produces a STRING in the resulting
    // ! JSON text (e.g. "totalCost":"450.00"), not a bare number — silently changes what the
    // ! model sees. Convert before stringifying, same as the list/get endpoints' toApiShape.
    // ! project only the fields the model can use - ids, timestamps, image URLs etc. are noise
    const recentFuelLogs = rawRecentFuelLogs.map((log) => ({
        date: log.date,
        odometerReading: log.odometerReading,
        litersAdded: log.litersAdded,
        isFullTank: log.isFullTank,
        pricePerLiter: Number(log.pricePerLiter),
        totalCost: Number(log.totalCost),
        fuelStation: log.fuelStation,
        notes: log.notes,
    }));
    const recentMaintenanceLogs = rawRecentMaintenanceLogs.map((log) => ({
        serviceDate: log.serviceDate,
        odometerReading: log.odometerReading,
        type: log.maintenanceType.name,
        cost: Number(log.cost),
        serviceCenter: log.serviceCenter,
        partsReplaced: log.partsReplaced,
        nextDueOdometer: log.nextDueOdometer,
        nextDueDate: log.nextDueDate,
        notes: log.notes,
    }));
    // ! `cost` through Number() for the same Decimal reason as above — this projection is
    // ! where it would be easiest to reintroduce the bug the comment above describes.
    // ! `oilType` is `?? null` and never left undefined: JSON.stringify DROPS an undefined
    // ! value from the object entirely, which would make a typeless imported row (spec 54 H7
    // ! allows `oilTypeId: null`) indistinguishable from a field this prompt never sends.
    const recentEngineOilLogs = rawRecentEngineOilLogs.map((log) => {
        var _a, _b;
        return ({
            changeDate: log.changeDate,
            odometerReading: log.odometerReading,
            oilType: (_b = (_a = log.oilType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
            intervalKmUsed: log.intervalKmUsed,
            nextDueOdometer: log.nextDueOdometer,
            quantityLiters: log.quantityLiters,
            oilFilterChanged: log.oilFilterChanged,
            cost: Number(log.cost),
            serviceCenter: log.serviceCenter,
            notes: log.notes,
        });
    });
    // ! only non-empty when relevant chunks were actually found — otherwise the section
    // ! is omitted entirely rather than injecting an empty/misleading heading
    const manualSection = relevantManualChunks.length > 0
        ? `Relevant excerpts from the owner's manual ("${manual === null || manual === void 0 ? void 0 : manual.originalName}"):\n` +
            relevantManualChunks
                .map((chunk) => chunk.chunkText.slice(0, MANUAL_CHUNK_MAX_CHARS))
                .join("\n---\n") +
            `\n\n`
        : "";
    const systemMessage = {
        role: "system",
        content: `You are a helpful assistant for a motorcycle called "${bike.nickname}" ` +
            `(${bike.brand} ${bike.model}). Current odometer: ${bike.currentOdometer} km.\n\n` +
            `Recent fuel logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentFuelLogs)}\n\n` +
            `Recent maintenance logs (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentMaintenanceLogs)}\n\n` +
            // ! emitted even when empty, unlike manualSection below: an absent block would let the
            // ! model guess about a bike it was told nothing about, where `[]` plus the closing
            // ! "answer only using the data given above" makes it say it has no oil history.
            // ! Deliberately the RAW rows, not `getEngineOilStatusFromDB`'s computed due date —
            // ! that would be a second source of truth for a figure the app's oil screen renders,
            // ! and the maintenance block above hands over nextDueOdometer raw too (spec 58 HK2).
            `Recent engine oil changes (up to ${CHAT_LOG_LIMIT} most recent): ${JSON.stringify(recentEngineOilLogs)}\n\n` +
            `Lifetime spending: ${JSON.stringify(lifetimeSpending)}\n\n` +
            manualSection +
            `Answer only using the data given above. If asked something this data doesn't cover, ` +
            `say so honestly instead of guessing. ` +
            `Format the reply in markdown — short paragraphs, **bold** for key numbers, and bullet points for lists or breakdowns; skip headings, this is a chat.`,
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
