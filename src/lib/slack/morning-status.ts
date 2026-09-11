import { HolidayType, LeaveRequestStatus } from "@prisma/client";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getSlackClient, postSlackMessage } from "@/lib/slack/client";
import { isSlackChannelId, normalizeSlackId } from "@/lib/slack/ids";
import { formatDateRange } from "@/lib/utils";
import { logger } from "@/lib/logger";

export const SETTING_MORNING_STATUS_SLACK_ID = "slack_morning_status_recipient";
export const SETTING_MORNING_STATUS_HOUR_IST = "morning_status_hour_ist";
export const SETTING_MORNING_STATUS_LAST_SENT = "morning_status_last_sent_date";
export const SETTING_FRIDAY_HOLIDAY_LAST_SENT = "friday_holiday_digest_last_sent";

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
  // Some runtimes report midnight as 24
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

/** Start/end of "today" in IST for leave overlap checks. */
function getISTDayBounds(dateKey: string) {
  const dayStart = new Date(`${dateKey}T00:00:00+05:30`);
  const dayEnd = new Date(`${dateKey}T23:59:59.999+05:30`);
  return { dayStart, dayEnd };
}

/** Next calendar week (Mon–Sun) after the current IST week. */
export function getNextWeekMonSunIST(now = new Date()) {
  const { dateKey } = getISTHourAndDate(now);
  // Noon IST avoids DST-edge issues (IST has none, but keeps date stable)
  const todayNoon = new Date(`${dateKey}T12:00:00+05:30`);
  const jsDay = todayNoon.getUTCDay(); // 0 Sun … 6 Sat in terms of the IST calendar day
  // Days until next Monday (if today is Monday, next Monday is +7)
  const daysUntilNextMonday = ((8 - jsDay) % 7) || 7;
  const nextMonday = new Date(todayNoon);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilNextMonday);
  const nextSunday = new Date(nextMonday);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + 6);

  const toKey = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return parts; // YYYY-MM-DD
  };

  const startKey = toKey(nextMonday);
  const endKey = toKey(nextSunday);
  return {
    startKey,
    endKey,
    start: new Date(`${startKey}T00:00:00+05:30`),
    end: new Date(`${endKey}T23:59:59.999+05:30`),
    rangeLabel: `${format(new Date(`${startKey}T12:00:00+05:30`), "dd MMM")} – ${format(new Date(`${endKey}T12:00:00+05:30`), "dd MMM yyyy")}`,
  };
}

export async function getMorningStatusHourIst() {
  const raw = await getAppSetting(SETTING_MORNING_STATUS_HOUR_IST);
  const hour = raw ? Number(raw) : 6;
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 6;
}

export async function getAppSetting(key: string) {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string) {
  return prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function getMorningChannel() {
  const recipient = normalizeSlackId(await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID));
  if (!recipient) {
    return {
      ok: false as const,
      reason: "No channel ID set. Go to Slack Settings and paste your channel ID (C…).",
    };
  }
  if (!isSlackChannelId(recipient) || !/^[CG]/i.test(recipient)) {
    return {
      ok: false as const,
      reason:
        "Morning status must use a channel ID (starts with C). Invite the Leave Tracker bot to that channel.",
    };
  }
  return { ok: true as const, recipient };
}

export async function sendMorningStatusDigest() {
  const channel = await getMorningChannel();
  if (!channel.ok) return { ok: false, reason: channel.reason };

  const { dateKey, dateLabel } = getISTHourAndDate();
  const { dayStart, dayEnd } = getISTDayBounds(dateKey);

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
  });

  const onLeave = await prisma.leaveRequest.findMany({
    where: {
      status: LeaveRequestStatus.APPROVED,
      startDate: { lte: dayEnd },
      endDate: { gte: dayStart },
    },
    include: { employee: true, leaveType: true },
  });

  const onLeaveIds = new Set(onLeave.map((r) => r.employeeId));
  const working = employees.filter((e) => !onLeaveIds.has(e.id));

  const leaveLines = onLeave.length
    ? onLeave.map(
        (r) =>
          `• *${r.employee.name}* — ${r.leaveType.name} (${formatDateRange(r.startDate, r.endDate)})`
      )
    : ["• _No one on leave today_"];

  const workingLines = working.length
    ? working.map((e) => `• ${e.name}`)
    : ["• _Everyone is on leave today_"];

  const text = [
    `📅 *Team Status — ${dateLabel}*`,
    "",
    "🏖️ *On leave today:*",
    ...leaveLines,
    "",
    "✅ *Working today:*",
    ...workingLines,
  ].join("\n");

  try {
    const client = getSlackClient();
    await postSlackMessage(client, channel.recipient, {
      text: `Team status for ${dateLabel}`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    });

    return { ok: true, onLeave: onLeave.length, working: working.length };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Slack API error";
    const reason =
      raw.includes("messages_tab_disabled") || raw.includes("cannot_dm_app")
        ? "Cannot DM this user from the bot. Use a channel ID (C…) instead — invite the Leave Tracker bot to that channel first."
        : raw.includes("not_in_channel")
          ? "Bot is not in that channel. Invite the Leave Tracker app to the channel first."
          : raw;
    return { ok: false, reason };
  }
}

/**
 * Friday digest: public & festival holidays for next Mon–Sun.
 */
export async function sendFridayUpcomingHolidaysDigest() {
  const channel = await getMorningChannel();
  if (!channel.ok) return { ok: false, reason: channel.reason };

  const week = getNextWeekMonSunIST();
  const holidays = await prisma.holiday.findMany({
    where: {
      status: "ACTIVE",
      type: { in: [HolidayType.PUBLIC, HolidayType.FESTIVAL] },
      date: { gte: week.start, lte: week.end },
    },
    orderBy: { date: "asc" },
  });

  const lines = holidays.length
    ? holidays.map((h) => {
        const d = format(h.date, "EEE, dd MMM");
        return `• *${d}* — ${h.name} _(${h.type === "PUBLIC" ? "Public" : "Festival"})_`;
      })
    : ["• _No public or festival holidays next week_"];

  const text = [
    `🎉 *Upcoming holidays — next week*`,
    `_${week.rangeLabel}_`,
    "",
    ...lines,
    "",
    "_Posted every Friday for the following week._",
  ].join("\n");

  try {
    const client = getSlackClient();
    await postSlackMessage(client, channel.recipient, {
      text: `Upcoming holidays for ${week.rangeLabel}`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    });
    return { ok: true, count: holidays.length, range: week.rangeLabel };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Slack API error";
    const reason = raw.includes("not_in_channel")
      ? "Bot is not in that channel. Invite the Leave Tracker app to the channel first."
      : raw;
    return { ok: false, reason };
  }
}

/**
 * Vercel Hobby runs this once/day at 00:30 UTC (= 6:00 AM IST).
 * We send based on that schedule (once per IST day), not a fragile hour match —
 * cron can be delayed a few minutes and would otherwise miss the window.
 */
export async function sendMorningStatusDigestIfScheduled() {
  const { dateKey, weekday, hour } = getISTHourAndDate();
  const targetHour = await getMorningStatusHourIst();

  // Soft window: allow configured hour ±1 in case of cron delay
  const inWindow =
    hour === targetHour || hour === (targetHour + 1) % 24 || hour === (targetHour + 23) % 24;

  if (!inWindow) {
    logger.info(
      { hour, targetHour, dateKey },
      "Morning status skipped — outside IST send window"
    );
    return {
      ok: true,
      skipped: true,
      reason: `Not send time (now ${hour}:xx IST, configured ~${targetHour}:00 IST)`,
    };
  }

  const lastSent = await getAppSetting(SETTING_MORNING_STATUS_LAST_SENT);
  if (lastSent === dateKey) {
    return { ok: true, skipped: true, reason: "Already sent today" };
  }

  const result = await sendMorningStatusDigest();
  if (result.ok) {
    await setAppSetting(SETTING_MORNING_STATUS_LAST_SENT, dateKey);
  }
  return result;
}

/** Friday only: next-week public/festival holidays (once per Friday). */
export async function sendFridayHolidayDigestIfScheduled() {
  const { dateKey, weekday } = getISTHourAndDate();
  if (weekday !== "Friday") {
    return { ok: true, skipped: true, reason: `Not Friday (today is ${weekday})` };
  }

  const lastSent = await getAppSetting(SETTING_FRIDAY_HOLIDAY_LAST_SENT);
  if (lastSent === dateKey) {
    return { ok: true, skipped: true, reason: "Friday holiday digest already sent" };
  }

  const result = await sendFridayUpcomingHolidaysDigest();
  if (result.ok) {
    await setAppSetting(SETTING_FRIDAY_HOLIDAY_LAST_SENT, dateKey);
  }
  return result;
}

/** Full daily cron job: morning status + Friday holiday preview. */
export async function runDailySlackCronJobs(opts?: { force?: boolean }) {
  if (opts?.force) {
    const morning = await sendMorningStatusDigest();
    const friday = await sendFridayUpcomingHolidaysDigest();
    return { morning, friday, forced: true };
  }

  const morning = await sendMorningStatusDigestIfScheduled();
  const friday = await sendFridayHolidayDigestIfScheduled();
  return { morning, friday, forced: false };
}
