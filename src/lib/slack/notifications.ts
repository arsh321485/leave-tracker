import type { KnownBlock } from "@slack/web-api";
import { prisma } from "@/lib/prisma";
import { remainingBalance, formatDateRange } from "@/lib/utils";
import { getSlackClient, postSlackMessage, slackErrorCode } from "@/lib/slack/client";
import { managerApprovalBlocks } from "@/lib/slack/blocks";
import { logger } from "@/lib/logger";
import { isPublicSlackChannel, normalizeSlackId } from "@/lib/slack/ids";
import { getAppSetting, SETTING_MORNING_STATUS_SLACK_ID } from "@/lib/slack/morning-status";

export type NotifyResult =
  | { ok: true; via?: "dm" | "ephemeral" }
  | { ok: false; reason: string };

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

/** Manager-only: DM first, then ephemeral (visible only to manager, not the whole channel). */
async function postManagerLeaveRequestPrivate(
  managerSlackUserId: string,
  blocks: KnownBlock[],
  text: string
): Promise<{ channel: string; ts: string; via: "dm" | "ephemeral" }> {
  const managerId = normalizeSlackId(managerSlackUserId)!;
  const client = getSlackClient();

  try {
    const result = await postSlackMessage(client, managerId, { text, blocks });
    return { ...result, via: "dm" };
  } catch (dmErr) {
    logger.warn({ err: dmErr, managerId }, "Manager DM failed, trying ephemeral");

    const settingsChannel = normalizeSlackId(
      await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID)
    );
    const leaveChannel =
      process.env.SLACK_LEAVE_CHANNEL_ID?.trim() ||
      (settingsChannel && isPublicSlackChannel(settingsChannel) ? settingsChannel : null);

    if (!leaveChannel) {
      throw dmErr;
    }

    await client.chat.postEphemeral({
      channel: leaveChannel,
      user: managerId,
      text,
      blocks,
    });

    return { channel: leaveChannel, ts: "", via: "ephemeral" };
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
    const result = await postManagerLeaveRequestPrivate(
      managerSlackId,
      blocks,
      `Leave approval required — ${request.employee.name}`
    );

    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        slackMessageTs: result.ts || null,
        slackChannelId: result.via === "dm" ? result.channel : null,
      },
    });

    logger.info(
      { requestId, managerId: manager.id, managerSlack: managerSlackId, via: result.via },
      "Manager notified privately on Slack"
    );
    return { ok: true, via: result.via };
  } catch (err) {
    const msg = slackErrorMessage(err);
    logger.error({ err, requestId, managerSlack: managerSlackId }, "Manager Slack notify failed");
    return {
      ok: false,
      reason: `${msg}. Manager must use /leave once so the bot can DM them, or approve via the admin panel.`,
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

/**
 * After approve/reject: update manager's private DM, or delete any old public channel message.
 * Never post approve/reject status to a channel everyone can see.
 */
export async function finalizeManagerLeaveRequest(requestId: string, text: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request?.slackChannelId || !request.slackMessageTs) return;

  const client = getSlackClient();

  if (isPublicSlackChannel(request.slackChannelId)) {
    try {
      await client.chat.delete({
        channel: request.slackChannelId,
        ts: request.slackMessageTs,
      });
    } catch (e) {
      logger.warn({ err: e, requestId }, "Could not delete public leave approval message");
    }
    return;
  }

  try {
    await client.chat.update({
      channel: request.slackChannelId,
      ts: request.slackMessageTs,
      text,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    });
  } catch (e) {
    logger.warn({ err: e, requestId }, "Could not update manager DM after leave action");
  }
}

/** @deprecated Use finalizeManagerLeaveRequest */
export const updateManagerSlackMessage = finalizeManagerLeaveRequest;
