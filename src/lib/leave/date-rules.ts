import { getISTHourAndDate } from "@/lib/slack/morning-status";

/** YYYY-MM-DD from a date string or Date (prefer explicit date-only strings). */
export function toDateKey(input: string | Date): string {
  if (typeof input === "string") {
    const m = input.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = typeof input === "string" ? new Date(input) : input;
  return getISTHourAndDate(d).dateKey;
}

/** Add calendar months to a YYYY-MM-DD key (IST calendar). */
export function addMonthsDateKey(dateKey: string, months: number): string {
  const [y, m, day] = dateKey.split("-").map(Number);
  const intendedMonthIndex = m - 1 + months;
  const lastDayOfTarget = new Date(Date.UTC(y, intendedMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTarget);
  const result = new Date(Date.UTC(y, intendedMonthIndex, clampedDay));
  const yy = result.getUTCFullYear();
  const mm = String(result.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(result.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Leave date rules (IST). Returns an error message or null if OK.
 * - No past dates
 * - Same-day leave only before 10:00 AM IST
 * - Start/end within 3 months from today
 */
export function leaveDateWindowError(
  startInput: string | Date,
  endInput: string | Date,
  now = new Date()
): string | null {
  const startKey = toDateKey(startInput);
  const endKey = toDateKey(endInput);
  const { dateKey: today, hour } = getISTHourAndDate(now);

  if (endKey < startKey) {
    return "Start date must be on or before end date.";
  }

  if (startKey < today) {
    return "Cannot apply leave for past dates. Choose today or a future date.";
  }

  if (startKey === today && hour >= 10) {
    return "Same-day leave can only be applied before 10:00 AM IST.";
  }

  const maxKey = addMonthsDateKey(today, 3);
  if (startKey > maxKey || endKey > maxKey) {
    return `Leave can only be applied up to 3 months ahead (until ${maxKey}).`;
  }

  return null;
}
