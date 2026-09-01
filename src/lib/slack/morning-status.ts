import { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSlackClient, postSlackMessage } from "@/lib/slack/client";
import { isSlackChannelId, normalizeSlackId } from "@/lib/slack/ids";
import { formatDateRange } from "@/lib/utils";

export const SETTING_MORNING_STATUS_SLACK_ID = "slack_morning_status_recipient";
export const SETTING_MORNING_STATUS_HOUR_IST = "morning_status_hour_ist";
export const SETTING_MORNING_STATUS_LAST_SENT = "morning_status_last_sent_date";

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
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  return {
    hour,
    dateKey: `${year}-${month}-${day}`,
    dateLabel: `${weekday}, ${Number(day)} ${formatMonth(Number(month))} ${year}`,
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

export async function sendMorningStatusDigest() {
  const recipient = normalizeSlackId(await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID));
  if (!recipient) {
    return { ok: false, reason: "No channel ID set. Go to Slack Settings and paste your channel ID (C…)." };
  }
  if (!isSlackChannelId(recipient)) {
    return {
      ok: false,
      reason: "Morning status must use a channel ID (starts with C). Invite the Leave Tracker bot to that channel.",
    };
  }

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

  const dateLabelText = dateLabel;
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
    `📅 *Team Status — ${dateLabelText}*`,
    "",
    "🏖️ *On leave today:*",
    ...leaveLines,
    "",
    "✅ *Working today:*",
    ...workingLines,
  ].join("\n");

  try {
    const client = getSlackClient();
    await postSlackMessage(client, recipient, {
      text: `Team status for ${dateLabelText}`,
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

/** Called hourly by Vercel cron — sends only at the configured IST hour, once per day. */
export async function sendMorningStatusDigestIfScheduled() {
  const targetHour = await getMorningStatusHourIst();
  const { hour, dateKey } = getISTHourAndDate();

  if (hour !== targetHour) {
    return { ok: true, skipped: true, reason: `Not send time (now ${hour}:xx IST, configured ${targetHour}:00 IST)` };
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
