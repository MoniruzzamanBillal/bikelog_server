import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { bikeModel } from "../bike/bike.model";
import { userModel } from "../user/user.model";
import { mileageRecordServices } from "../mileageRecord/mileageRecord.service";
import { spendingServices } from "../spending/spending.service";
import { getLastCompletedWeekRange } from "./notification.utils";

const expo = new Expo();

type TWeeklySummaryResult = {
  usersProcessed: number;
  bikesSkipped: number;
  notificationsSent: number;
  notificationsFailed: number;
};

// ! sends one Expo push per bike that had at least one fuel log in the last completed
// ! Friday–Thursday week, to every user with a registered expoPushToken. Bikes with zero
// ! fuel logs that week are skipped (nothing meaningful to summarize) rather than sent an
// ! empty digest — see notification.utils.ts / spec 21 for the exact week-boundary logic.
const sendWeeklySummaries = async (): Promise<TWeeklySummaryResult> => {
  const users = await userModel
    .find({ expoPushToken: { $ne: null }, isDeleted: false })
    .lean();

  const { startDate, endDate } = getLastCompletedWeekRange(new Date());

  let bikesSkipped = 0;
  let notificationsFailed = 0;
  const messages: ExpoPushMessage[] = [];

  for (const user of users) {
    if (!user.expoPushToken || !Expo.isExpoPushToken(user.expoPushToken)) {
      notificationsFailed += 1;
      continue;
    }

    const bikes = await bikeModel
      .find({ owner: user._id, isDeleted: false })
      .lean();

    for (const bike of bikes) {
      const bikeId = bike._id.toString();

      const [mileage, spending] = await Promise.all([
        mileageRecordServices.computeMileageForRange(bikeId, startDate, endDate),
        spendingServices.computeSpendingForRange(bikeId, startDate, endDate),
      ]);

      if (mileage.fuelLogCount === 0) {
        bikesSkipped += 1;
        continue;
      }

      const mileageKmPerLiter =
        mileage.totalLitersConsumed > 0
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
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === "ok") {
          notificationsSent += 1;
        } else {
          notificationsFailed += 1;
        }
      }
    } catch (error) {
      notificationsFailed += chunk.length;
    }
  }

  return {
    usersProcessed: users.length,
    bikesSkipped,
    notificationsSent,
    notificationsFailed,
  };
};

//
export const notificationServices = {
  sendWeeklySummaries,
};
