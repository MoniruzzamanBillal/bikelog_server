import axios from "axios";
import config from "../config";
import { errorLogServices } from "../modules/errorLog/errorLog.service";

export type TExpenseRequestPayload = {
  sourceType: "fuel" | "maintenance" | "accessory";
  sourceRecordId: string;
  userEmail: string;
  userId: string;
  title: string;
  description?: string;
  amount: number;
  occurredAt: Date;
};

// ! fire-and-forget — never awaited by callers, never throws, never blocks/fails
// ! bikelog's own API response. On failure, best-effort logged via errorLog for visibility.
export const notifyExpenseTracker = (payload: TExpenseRequestPayload): void => {
  const endpoint = `${config.expenseTrackerBaseUrl}/api/transaction-requests/ingest`;

  axios
    .post(
      endpoint,
      {
        sourceApp: "bikelog",
        sourceType: payload.sourceType,
        sourceRecordId: payload.sourceRecordId,
        userEmail: payload.userEmail,
        type: "expense",
        title: payload.title,
        description: payload.description,
        amount: payload.amount,
        occurredAt: payload.occurredAt.toISOString(),
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-integration-key": config.expenseTrackerIntegrationKey as string,
        },
      },
    )
    .catch(async (error) => {
      console.error("notifyExpenseTracker failed:", error);
      try {
        await errorLogServices.createErrorLog({
          status: 502,
          message: `Failed to sync ${payload.sourceType} spend to expenseTracker2: ${error?.message ?? error}`,
          errorName: "ExpenseTrackerSyncError",
          stack: error?.stack,
          method: "POST",
          path: "/api/transaction-requests/ingest",
          userId: payload.userId,
          userEmail: payload.userEmail,
        });
      } catch (logError) {
        // ! last resort: even error-logging must not throw out of a fire-and-forget call
        console.error("Failed to write errorLog for expenseTracker2 sync failure:", logError);
      }
    });
};
