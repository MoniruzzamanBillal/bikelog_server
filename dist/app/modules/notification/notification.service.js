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
exports.notificationServices = void 0;
const expo_server_sdk_1 = require("expo-server-sdk");
const bike_model_1 = require("../bike/bike.model");
const user_model_1 = require("../user/user.model");
const mileageRecord_service_1 = require("../mileageRecord/mileageRecord.service");
const spending_service_1 = require("../spending/spending.service");
const notification_utils_1 = require("./notification.utils");
const expo = new expo_server_sdk_1.Expo();
// ! sends one Expo push per bike that had at least one fuel log in the last completed
// ! Friday–Thursday week, to every user with a registered expoPushToken. Bikes with zero
// ! fuel logs that week are skipped (nothing meaningful to summarize) rather than sent an
// ! empty digest — see notification.utils.ts / spec 21 for the exact week-boundary logic.
const sendWeeklySummaries = () => __awaiter(void 0, void 0, void 0, function* () {
    const users = yield user_model_1.userModel
        .find({ expoPushToken: { $ne: null }, isDeleted: false })
        .lean();
    const { startDate, endDate } = (0, notification_utils_1.getLastCompletedWeekRange)(new Date());
    let bikesSkipped = 0;
    let notificationsFailed = 0;
    const messages = [];
    for (const user of users) {
        if (!user.expoPushToken || !expo_server_sdk_1.Expo.isExpoPushToken(user.expoPushToken)) {
            notificationsFailed += 1;
            continue;
        }
        const bikes = yield bike_model_1.bikeModel
            .find({ owner: user._id, isDeleted: false })
            .lean();
        for (const bike of bikes) {
            const bikeId = bike._id.toString();
            const [mileage, spending] = yield Promise.all([
                mileageRecord_service_1.mileageRecordServices.computeMileageForRange(bikeId, startDate, endDate),
                spending_service_1.spendingServices.computeSpendingForRange(bikeId, startDate, endDate),
            ]);
            if (mileage.fuelLogCount === 0) {
                bikesSkipped += 1;
                continue;
            }
            const mileageKmPerLiter = mileage.totalLitersConsumed > 0
                ? mileage.totalDistanceKm / mileage.totalLitersConsumed
                : null;
            const bodyParts = [
                `${mileage.totalDistanceKm.toFixed(1)} km`,
                `${mileage.totalLitersConsumed.toFixed(1)} L`,
                mileageKmPerLiter !== null
                    ? `${mileageKmPerLiter.toFixed(1)} km/L`
                    : "—",
                `৳${spending.totalSpending.toFixed(0)} spent`,
            ];
            messages.push({
                to: user.expoPushToken,
                sound: "default",
                title: `🏍️ ${bike.nickname} — Weekly Summary`,
                body: bodyParts.join(" • "),
                data: { bikeId, type: "weekly-summary" },
            });
        }
    }
    let notificationsSent = 0;
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
        try {
            const tickets = yield expo.sendPushNotificationsAsync(chunk);
            for (const ticket of tickets) {
                if (ticket.status === "ok") {
                    notificationsSent += 1;
                }
                else {
                    notificationsFailed += 1;
                }
            }
        }
        catch (error) {
            notificationsFailed += chunk.length;
        }
    }
    return {
        usersProcessed: users.length,
        bikesSkipped,
        notificationsSent,
        notificationsFailed,
    };
});
//
exports.notificationServices = {
    sendWeeklySummaries,
};
