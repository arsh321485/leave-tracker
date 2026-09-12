/** Pure IST helpers — no DB imports (safe for Slack 3s submit path). */

export function getISTHourAndDate(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  const parts = formatter.formatToParts(now);
  let hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  if (hour === 24) hour = 0;
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  return {
    hour,
    dateKey: `${year}-${month}-${day}`,
    dateLabel: `${weekday}, ${Number(day)} ${formatMonth(Number(month))} ${year}`,
    weekday: weekday || "",
  };
}

function formatMonth(m: number) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    m - 1
  ];
}

export function toDateKey(input: string | Date): string {
  if (typeof input === "string") {
    const m = input.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = typeof input === "string" ? new Date(input) : input;
  return getISTHourAndDate(d).dateKey;
}

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

export function getISTDayBounds(dateKey: string) {
  const dayStart = new Date(`${dateKey}T00:00:00+05:30`);
  const dayEnd = new Date(`${dateKey}T23:59:59.999+05:30`);
  return { dayStart, dayEnd };
}

/** Next calendar week (Mon–Sun) after the current IST week. */
export function getNextWeekMonSunIST(now = new Date()) {
  const { dateKey } = getISTHourAndDate(now);
  const todayNoon = new Date(`${dateKey}T12:00:00+05:30`);
  const jsDay = todayNoon.getUTCDay();
  const daysUntilNextMonday = ((8 - jsDay) % 7) || 7;
  const nextMonday = new Date(todayNoon);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilNextMonday);
  const nextSunday = new Date(nextMonday);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + 6);

  const toKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const startKey = toKey(nextMonday);
  const endKey = toKey(nextSunday);
  const fmt = (key: string, pattern: string) => {
    const d = new Date(`${key}T12:00:00+05:30`);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    if (pattern === "short") return `${day} ${mon}`;
    return `${day} ${mon} ${year}`;
  };
  return {
    startKey,
    endKey,
    start: new Date(`${startKey}T00:00:00+05:30`),
    end: new Date(`${endKey}T23:59:59.999+05:30`),
    rangeLabel: `${fmt(startKey, "short")} – ${fmt(endKey, "long")}`,
  };
}
