import { addDays, format, isWeekend, parseISO, startOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { LeaveDuration } from "@prisma/client";

function toDateOnly(d: Date | string): Date {
  if (typeof d === "string") {
    return startOfDay(parseISO(d.length === 10 ? d : d.slice(0, 10)));
  }
  return startOfDay(d);
}

export async function getHolidayDates(
  start: Date,
  end: Date
): Promise<Set<string>> {
  const holidays = await prisma.holiday.findMany({
    where: {
      status: "ACTIVE",
      date: { gte: start, lte: end },
      isOptional: false,
    },
  });

  const set = new Set<string>();
  for (const h of holidays) {
    set.add(format(h.date, "yyyy-MM-dd"));
  }
  return set;
}

export type WorkingDaysOptions = {
  weekendsNonWorking?: boolean;
  holidayDates?: Set<string>;
  duration?: LeaveDuration;
};

/**
 * Calculate leave days. Never trust a client-supplied total.
 * Weekends and non-optional company holidays are excluded by default.
 * Half-day requests on a single working day count as 0.5.
 */
export function calculateWorkingDays(
  startInput: Date | string,
  endInput: Date | string,
  options: WorkingDaysOptions = {}
): number {
  const start = toDateOnly(startInput);
  const end = toDateOnly(endInput);
  if (end < start) return 0;

  const weekendsNonWorking =
    options.weekendsNonWorking ?? process.env.WEEKENDS_NON_WORKING !== "false";
  const holidayDates = options.holidayDates ?? new Set<string>();
  const duration = options.duration ?? LeaveDuration.FULL_DAY;

  let days = 0;
  let cursor = start;
  while (cursor <= end) {
    const key = format(cursor, "yyyy-MM-dd");
    const weekend = weekendsNonWorking && isWeekend(cursor);
    const holiday = holidayDates.has(key);
    if (!weekend && !holiday) {
      days += 1;
    }
    cursor = addDays(cursor, 1);
  }

  if (duration === LeaveDuration.HALF_DAY) {
    if (format(start, "yyyy-MM-dd") !== format(end, "yyyy-MM-dd")) {
      // Half-day only valid for single calendar day; treat as half of working day if that day is working
      return days > 0 ? 0.5 : 0;
    }
    return days > 0 ? 0.5 : 0;
  }

  return days;
}

export async function calculateLeaveDays(
  startInput: Date | string,
  endInput: Date | string,
  duration: LeaveDuration = LeaveDuration.FULL_DAY
): Promise<number> {
  const start = toDateOnly(startInput);
  const end = toDateOnly(endInput);
  const holidayDates = await getHolidayDates(start, end);
  return calculateWorkingDays(start, end, { holidayDates, duration });
}
