"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentWeekRange = void 0;
// ! Asia/Dhaka is UTC+6 with no DST, so a fixed-offset constant is enough — no timezone
// ! library needed. Based on the ৳ currency used throughout this app's UI; adjust this
// ! constant if the deployed audience isn't actually in this timezone.
const WEEK_TZ_OFFSET_MINUTES = 360;
// ! Returns the Friday 00:00:00.000–Thursday 23:59:59.999 window that CONTAINS `now`, in the
// ! fixed timezone above. The cron trigger fires Thursday 22:00 local time — i.e. ~2 hours
// ! BEFORE that same week's own Thursday-midnight end — so "the week containing now" (not
// ! "the last fully completed week") is the correct target: it's the week that's about to
// ! finish that same night, which is what the user actually wants summarized. One accepted,
// ! deliberate gap from firing 2 hours early: a fuel log dated in that final 22:00–23:59:59
// ! window won't be captured by any week's summary (this week's was already sent; next week's
// ! window starts fresh from the following Friday) — a minor tradeoff for a fixed 10pm send
// ! time, not a bug.
const getCurrentWeekRange = (now) => {
    const offsetMs = WEEK_TZ_OFFSET_MINUTES * 60 * 1000;
    const localNow = new Date(now.getTime() + offsetMs);
    const localDow = localNow.getUTCDay(); // 0=Sun..6=Sat, read off the shifted clock
    const daysSinceFriday = (localDow - 5 + 7) % 7;
    const weekStartLocalMs = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() - daysSinceFriday, 0, 0, 0, 0);
    const weekEndLocalMs = weekStartLocalMs + 7 * 24 * 60 * 60 * 1000 - 1;
    return {
        startDate: new Date(weekStartLocalMs - offsetMs),
        endDate: new Date(weekEndLocalMs - offsetMs),
    };
};
exports.getCurrentWeekRange = getCurrentWeekRange;
