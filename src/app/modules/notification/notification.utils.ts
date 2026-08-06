// ! Asia/Dhaka is UTC+6 with no DST, so a fixed-offset constant is enough — no timezone
// ! library needed. Based on the ৳ currency used throughout this app's UI; adjust this
// ! constant if the deployed audience isn't actually in this timezone.
const WEEK_TZ_OFFSET_MINUTES = 360;

// ! Returns the most recently COMPLETED Friday 00:00:00.000–Thursday 23:59:59.999 window,
// ! relative to `now`, in the fixed timezone above. "Completed" means: find the most recent
// ! Friday-local-midnight <= now (the start of the current, possibly still in-progress week),
// ! then step back one full week from there. This is correct regardless of what day `now`
// ! falls on — including being called on the Friday the new week starts, which is exactly
// ! when the weekly-summary cron is expected to run.
export const getLastCompletedWeekRange = (
  now: Date,
): { startDate: Date; endDate: Date } => {
  const offsetMs = WEEK_TZ_OFFSET_MINUTES * 60 * 1000;
  const localNow = new Date(now.getTime() + offsetMs);

  const localDow = localNow.getUTCDay(); // 0=Sun..6=Sat, read off the shifted clock
  const daysSinceFriday = (localDow - 5 + 7) % 7;

  const mostRecentFridayLocalMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() - daysSinceFriday,
    0,
    0,
    0,
    0,
  );

  const weekStartLocalMs = mostRecentFridayLocalMs - 7 * 24 * 60 * 60 * 1000;
  const weekEndLocalMs = mostRecentFridayLocalMs - 1;

  return {
    startDate: new Date(weekStartLocalMs - offsetMs),
    endDate: new Date(weekEndLocalMs - offsetMs),
  };
};
