import { format } from "date-fns";
import { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSlackClient, resolveSlackMessageTarget } from "@/lib/slack/client";
import { formatDateRange } from "@/lib/utils";

export const SETTING_MORNING_STATUS_SLACK_ID = "slack_morning_status_recipient";

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
  const recipient = await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID);
  if (!recipient?.trim()) {
    return { ok: false, reason: "No morning status Slack recipient configured" };
  }

  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

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

  const dateLabel = format(today, "EEEE, d MMM yyyy");
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
    const channelId = await resolveSlackMessageTarget(client, recipient);
    await client.chat.postMessage({
      channel: channelId,
      text: `Team status for ${dateLabel}`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    });

    return { ok: true, onLeave: onLeave.length, working: working.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Slack API error";
    return { ok: false, reason: msg };
  }
}
