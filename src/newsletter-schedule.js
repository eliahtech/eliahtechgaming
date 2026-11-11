// Pure helpers for the daily-capped newsletter sender (no I/O, easy to test).
// A "day" is the UTC calendar day because that is when Resend's free-plan daily quota resets
// (00:00 UTC = 03:00 in Kenya).
export const DEFAULT_DAILY_LIMIT = 30;
export const MAX_DAILY_LIMIT = 1000;
export const MAX_ATTEMPTS = 3; // a failed delivery is retried on later days until it has been tried this many times
const DAY_MS = 86_400_000;

export const clampLimit = (value, fallback = DEFAULT_DAILY_LIMIT) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAILY_LIMIT ? n : fallback;
};
export const utcDayStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const nextUtcDay = (now = new Date()) => new Date(utcDayStart(now).getTime() + DAY_MS);

// How many more newsletter emails may go out right now. Emails already accepted today and rows claimed but still in flight both count.
export const allowanceFor = ({ limit, sentToday = 0, inFlight = 0 }) => Math.max(0, Math.floor(limit) - Math.max(0, sentToday) - Math.max(0, inFlight));

// Sending days still needed. Today only counts while some allowance is left.
export function daysLeft({ remaining, limit, allowance }) {
  if (!(remaining > 0)) return 0;
  const afterToday = Math.max(0, remaining - allowance);
  return (allowance > 0 ? 1 : 0) + Math.ceil(afterToday / limit);
}
export function estimatedFinish({ remaining, limit, allowance, now = new Date() }) {
  const days = daysLeft({ remaining, limit, allowance });
  if (!days) return null;
  return new Date(utcDayStart(now).getTime() + (days - 1 + (allowance > 0 ? 0 : 1)) * DAY_MS);
}
