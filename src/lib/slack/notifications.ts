import type { KnownBlock } from "@slack/web-api";
import { prisma } from "@/lib/prisma";
import { remainingBalance, formatDateRange } from "@/lib/utils";
import { getSlackClient, postSlackMessage, slackErrorCode } from "@/lib/slack/client";
import { managerApprovalBlocks } from "@/lib/slack/blocks";
import { logger } from "@/lib/logger";
import { normalizeSlackId } from "@/lib/slack/ids";

export type NotifyResult = { ok: true; via?: "dm" | "channel" } | { ok: false; reason: string };

function slackErrorMessage(err: unknown): string {
  const code = slackErrorCode(err);
  if (code) return code;
  return err instanceof Error ? err.message : "Slack API error";
}

export async function dmEmployee(
  slackUserId: string,
  text: string,
  blocks?: Parameters<typeof postSlackMessage>[2]["blocks"]
): Promise<NotifyResult> {
  const id = normalizeSlackId(slackUserId);
  if (!id) {
    return { ok: false, reason: "No Slack User ID on employee record" };
  }
  try {
    const client = getSlackClient();
    await postSlackMessage(client, id, { text, blocks });
    return { ok: true, via: "dm" };
  } catch (err) {
    const code = slackErrorMessage(err);
    logger.error({ err, slackUserId: id }, "Failed to DM employee on Slack");
    return { ok: false, reason: code };
  }
}

async function postManagerLeaveRequest(
  managerSlackUserId: string,
  blocks: KnownBlock[],
  text: string
): Promise<{ channel: string; ts: string; via: "dm" | "channel" }> {
  const managerId = normalizeSlackId(managerSlackUserId)!;
  const client = getSlackClient();

  try {
    const result = await postSlackMessage(client, managerId, { text, blocks });
    return { ...result, via: "dm" };
  } catch (dmErr) {
    const code = slackErrorMessage(dmErr);
    logger.warn({ err: dmErr, managerId, code }, "Manager DM failed, trying leave channel");

    const leaveChannel = process.env.SLACK_LEAVE_CHANNEL_ID?.trim();
    if (!leaveChannel) {
      throw dmErr;
    }

    const channelBlocks: KnownBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${managerId}> 🔔 *Leave approval required* — please review below.`,
        },
      },
      ...blocks,
    ];

    const result = await postSlackMessage(client, leaveChannel, {
      text: `<@${managerId}> Leave approval required`,
      blocks: channelBlocks,
    });
    return { ...result, via: "channel" };
  }
}

export async function notifyManagerOfLeave(requestId: string): Promise<NotifyResult> {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: { include: { manager: true } },
      leaveType: true,
    },
  });

  if (!request) {
    return { ok: false, reason: "Leave request not found" };
  }

  const manager = request.employee.manager;
  if (!manager) {
    return {
      ok: false,
      reason: `No manager assigned to ${request.employee.name}. Set a manager on the Employees page.`,
    };
  }

  const managerSlackId = normalizeSlackId(manager.slackUserId);
  if (!managerSlackId) {
    return {
      ok: false,
      reason: `Manager "${manager.name}" has no Slack User ID. Edit them on Employees and link via Slack sync.`,
    };
  }

  const year = request.startDate.getUTCFullYear();
  const balance = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year,
      },
    },
  });

  const blocks = managerApprovalBlocks({
    requestId: request.id,
    employeeName: request.employee.name,
    leaveType: request.leaveType.name,
    dateRange: formatDateRange(request.startDate, request.endDate),
    days: request.days,
    reason: request.reason,
    balanceRemaining: balance ? remainingBalance(balance) : 0,
  });

  try {
    const result = await postManagerLeaveRequest(
      managerSlackId,
      blocks,
      `Leave approval required — ${request.employee.name}`
    );

    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        slackMessageTs: result.ts,
        slackChannelId: result.channel,
      },
    });

    logger.info(
      { requestId, managerId: manager.id, managerSlack: managerSlackId, via: result.via },
      "Manager notified on Slack"
    );
    return { ok: true, via: result.via };
  } catch (err) {
    const msg = slackErrorMessage(err);
    logger.error({ err, requestId, managerSlack: managerSlackId }, "Manager Slack notify failed");
    return {
      ok: false,
      reason: `${msg}. Set SLACK_LEAVE_CHANNEL_ID, invite the bot to that channel, and ensure manager Slack ID is correct.`,
    };
  }
}

export async function notifyEmployeeLeaveApproved(
  requestId: string,
  approverName: string
): Promise<NotifyResult> {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: true, leaveType: true },
  });
  if (!request?.employee.slackUserId) {
    return {
      ok: false,
      reason: `${request?.employee.name ?? "Employee"} has no Slack User ID mapped`,
    };
  }

  const year = request.startDate.getUTCFullYear();
  const bal = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year,
      },
    },
  });

  return dmEmployee(
    request.employee.slackUserId,
    `✅ *LEAVE APPROVED*\n\nYour leave request has been approved.\n\n*Leave:* ${request.leaveType.name}\n*Date:* ${formatDateRange(request.startDate, request.endDate)}\n*Days:* ${request.days}\n*Approved by:* ${approverName}\n*Remaining balance:* ${bal ? remainingBalance(bal) : "n/a"} days`
  );
}

export async function notifyEmployeeLeaveRejected(
  requestId: string,
  rejectorName: string,
  reason: string
): Promise<NotifyResult> {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: true, leaveType: true },
  });
  if (!request?.employee.slackUserId) {
    return {
      ok: false,
      reason: `${request?.employee.name ?? "Employee"} has no Slack User ID mapped`,
    };
  }

  return dmEmployee(
    request.employee.slackUserId,
    `❌ *LEAVE REJECTED*\n\nYour leave request has been rejected.\n\n*Leave:* ${request.leaveType.name}\n*Date:* ${formatDateRange(request.startDate, request.endDate)}\n*Reason:* ${reason}\n*Rejected by:* ${rejectorName}`
  );
}

export async function updateManagerSlackMessage(requestId: string, text: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request?.slackChannelId || !request.slackMessageTs) return;

  const client = getSlackClient();
  await client.chat.update({
    channel: request.slackChannelId,
    ts: request.slackMessageTs,
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  });
}
