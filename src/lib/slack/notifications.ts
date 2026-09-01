import { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/prisma";
import { remainingBalance, formatDateRange } from "@/lib/utils";
import { getSlackClient, postSlackMessage } from "@/lib/slack/client";
import { managerApprovalBlocks } from "@/lib/slack/blocks";
import { logger } from "@/lib/logger";

export type NotifyResult = { ok: true } | { ok: false; reason: string };

function slackErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return err instanceof Error ? err.message : "Slack API error";
}

export async function dmEmployee(
  slackUserId: string,
  text: string,
  blocks?: Parameters<typeof postSlackMessage>[2]["blocks"]
): Promise<NotifyResult> {
  if (!slackUserId?.trim()) {
    return { ok: false, reason: "No Slack User ID on employee record" };
  }
  try {
    const client = getSlackClient();
    await postSlackMessage(client, slackUserId, { text, blocks });
    return { ok: true };
  } catch (err) {
    const code = slackErrorMessage(err);
    logger.error({ err, slackUserId }, "Failed to DM employee on Slack");
    if (code.includes("messages_tab_disabled")) {
      return {
        ok: false,
        reason:
          "This person has disabled app DMs in Slack. They must open Leave Tracker once via /leave, or enable app messages in Slack settings.",
      };
    }
    return { ok: false, reason: code };
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
    logger.warn({ requestId, employeeId: request.employeeId }, "Employee has no manager assigned");
    return {
      ok: false,
      reason: `No manager assigned to ${request.employee.name}. Set a manager on the Employees page.`,
    };
  }

  if (!manager.slackUserId?.trim()) {
    logger.warn(
      { requestId, managerId: manager.id, managerName: manager.name },
      "Manager has no Slack User ID"
    );
    return {
      ok: false,
      reason: `Manager "${manager.name}" has no Slack User ID. Edit them on Employees page and add their Slack ID (U…).`,
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

  try {
    const client = getSlackClient();
    const result = await postSlackMessage(client, manager.slackUserId, {
      text: `Leave approval required — ${request.employee.name}`,
      blocks: managerApprovalBlocks({
        requestId: request.id,
        employeeName: request.employee.name,
        leaveType: request.leaveType.name,
        dateRange: formatDateRange(request.startDate, request.endDate),
        days: request.days,
        reason: request.reason,
        balanceRemaining: balance ? remainingBalance(balance) : 0,
      }),
    });

    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        slackMessageTs: result.ts,
        slackChannelId: result.channel,
      },
    });

    logger.info(
      { requestId, managerId: manager.id, managerSlack: manager.slackUserId },
      "Manager notified on Slack"
    );
    return { ok: true };
  } catch (err) {
    const msg = slackErrorMessage(err);
    logger.error({ err, requestId, managerSlack: manager.slackUserId }, "Manager Slack notify failed");
    return { ok: false, reason: msg };
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
