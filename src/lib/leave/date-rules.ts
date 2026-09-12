import { getISTHourAndDate, toDateKey, addMonthsDateKey } from "@/lib/ist";

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
    return "Same-day leave only before 10:00 AM IST. Apply tomorrow or earlier tomorrow morning.";
  }

  const maxKey = addMonthsDateKey(today, 3);
  if (startKey > maxKey) {
    return `From date is too far. Leave only allowed until ${maxKey} (3 months).`;
  }
  if (endKey > maxKey) {
    return `To date is too far. Leave only allowed until ${maxKey} (3 months).`;
  }

  return null;
}

export { toDateKey, addMonthsDateKey };
