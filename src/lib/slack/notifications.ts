import type { KnownBlock } from "@slack/web-api";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { remainingBalance, formatDateRange } from "@/lib/utils";
import { getSlackClient, postSlackMessage, slackErrorCode } from "@/lib/slack/client";
import { managerApprovalBlocks, managerCompOffApprovalBlocks } from "@/lib/slack/blocks";
import { logger } from "@/lib/logger";
import { isPublicSlackChannel, normalizeSlackId } from "@/lib/slack/ids";
import { formatPaidLeaveLabel, parseBalanceSplit } from "@/lib/leave/pool";

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

async function postManagerLeaveRequestPrivate(
  managerSlackUserId: string,
  blocks: KnownBlock[],
  text: string
): Promise<{ channel: string; ts: string; via: "dm" }> {
  const managerId = normalizeSlackId(managerSlackUserId)!;
  const client = getSlackClient();
  const result = await postSlackMessage(client, managerId, { text, blocks });
  return { ...result, via: "dm" };
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
      reason: `Manager "${manager.name}" has no Slack User ID. Edit them on Employees and link Slack.`,
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

  const split = parseBalanceSplit(request.balanceSplit);
  const leaveTypeLabel = split?.length
    ? formatPaidLeaveLabel(split)
    : request.leaveType.name;

  const blocks = managerApprovalBlocks({
    requestId: request.id,
    employeeName: request.employee.name,
    leaveType: leaveTypeLabel,
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
        slackChannelId: result.channel,
      },
    });

    logger.info(
      { requestId, managerId: manager.id, managerSlack: managerSlackId, via: result.via },
      "Manager notified on Slack DM"
    );
    return { ok: true, via: result.via };
  } catch (err) {
    const msg = slackErrorMessage(err);
    logger.error({ err, requestId, managerSlack: managerSlackId }, "Manager Slack notify failed");
    return { ok: false, reason: msg };
  }
}

export async function notifyManagerOfCompOff(creditId: string): Promise<NotifyResult> {
  const credit = await prisma.compOffCredit.findUnique({
    where: { id: creditId },
    include: { employee: { include: { manager: true } } },
  });

  if (!credit) return { ok: false, reason: "Comp Off request not found" };

  const manager = credit.employee.manager;
  if (!manager) {
    return {
      ok: false,
      reason: `No manager assigned to ${credit.employee.name}. Set a manager on the Employees page.`,
    };
  }

  const managerSlackId = normalizeSlackId(manager.slackUserId);
  if (!managerSlackId) {
    return {
      ok: false,
      reason: `Manager "${manager.name}" has no Slack User ID. Edit them on Employees and link Slack.`,
    };
  }

  const blocks = managerCompOffApprovalBlocks({
    creditId: credit.id,
    employeeName: credit.employee.name,
    workDate: format(credit.workDate, "dd MMM yyyy"),
    days: credit.days,
    reason: credit.reason,
  });

  try {
    const result = await postManagerLeaveRequestPrivate(
      managerSlackId,
      blocks,
      `Comp Off credit approval — ${credit.employee.name}`
    );

    await prisma.compOffCredit.update({
      where: { id: credit.id },
      data: {
        slackMessageTs: result.ts || null,
        slackChannelId: result.channel,
      },
    });

    return { ok: true, via: result.via };
  } catch (err) {
    const msg = slackErrorMessage(err);
    logger.error({ err, creditId, managerSlack: managerSlackId }, "Manager Comp Off notify failed");
    return { ok: false, reason: msg };
  }
}

/** Called after leave is saved — must be awaited (e.g. in after()), never fire-and-forget. */
export async function sendLeaveSubmittedNotifications(
  requestId: string,
  applicantSlackUserId: string
): Promise<{ managerOk: boolean; managerReason?: string; applicantOk: boolean }> {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { leaveType: true },
  });
  if (!request) {
    return { managerOk: false, managerReason: "Request not found", applicantOk: false };
  }

  const managerNotify = await notifyManagerOfLeave(requestId);

  let applicantText: string;
  if (managerNotify.ok) {
    applicantText = `✅ Leave request submitted (${request.days} day(s)).\n\n*Leave:* ${request.leaveType.name}\n*Dates:* ${formatDateRange(request.startDate, request.endDate)}\n\nYour manager was notified on Slack DM.`;
  } else {
    applicantText = `✅ Leave saved (${request.days} day(s)) — it appears in the admin Requests list.\n\n⚠️ Your manager was *not* notified on Slack.\nReason: ${managerNotify.reason}`;
  }

  const applicantNotify = await dmEmployee(applicantSlackUserId, applicantText);

  return {
    managerOk: managerNotify.ok,
    managerReason: managerNotify.ok ? undefined : managerNotify.reason,
    applicantOk: applicantNotify.ok,
  };
}

export async function sendCompOffSubmittedNotifications(
  creditId: string,
  applicantSlackUserId: string
): Promise<{ managerOk: boolean; managerReason?: string; applicantOk: boolean }> {
  const credit = await prisma.compOffCredit.findUnique({ where: { id: creditId } });
  if (!credit) {
    return { managerOk: false, managerReason: "Request not found", applicantOk: false };
  }

  const managerNotify = await notifyManagerOfCompOff(creditId);

  let applicantText: string;
  if (managerNotify.ok) {
    applicantText = `✅ Comp Off credit requested (${credit.days} day(s)) for work on ${format(credit.workDate, "dd MMM yyyy")}.\n\nYour manager was notified. After approval, Comp Off will appear in your balance and you can apply it like other leave.`;
  } else {
    applicantText = `✅ Comp Off credit saved (${credit.days} day(s)) — it appears in the admin Comp Off list.\n\n⚠️ Your manager was *not* notified on Slack.\nReason: ${managerNotify.reason}`;
  }

  const applicantNotify = await dmEmployee(applicantSlackUserId, applicantText);
  return {
    managerOk: managerNotify.ok,
    managerReason: managerNotify.ok ? undefined : managerNotify.reason,
    applicantOk: applicantNotify.ok,
  };
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

export async function notifyEmployeeCompOffApproved(
  creditId: string,
  approverName: string
): Promise<NotifyResult> {
  const credit = await prisma.compOffCredit.findUnique({
    where: { id: creditId },
    include: { employee: true },
  });
  if (!credit?.employee.slackUserId) {
    return {
      ok: false,
      reason: `${credit?.employee.name ?? "Employee"} has no Slack User ID mapped`,
    };
  }

  return dmEmployee(
    credit.employee.slackUserId,
    `✅ *COMP OFF APPROVED*\n\n*+${credit.days} day(s)* added to your Comp Off balance.\n*Work date:* ${format(credit.workDate, "dd MMM yyyy")}\n*Approved by:* ${approverName}\n\nYou can now apply Comp Off leave from Apply Leave.`
  );
}

export async function notifyEmployeeCompOffRejected(
  creditId: string,
  rejectorName: string,
  reason: string
): Promise<NotifyResult> {
  const credit = await prisma.compOffCredit.findUnique({
    where: { id: creditId },
    include: { employee: true },
  });
  if (!credit?.employee.slackUserId) {
    return {
      ok: false,
      reason: `${credit?.employee.name ?? "Employee"} has no Slack User ID mapped`,
    };
  }

  return dmEmployee(
    credit.employee.slackUserId,
    `❌ *COMP OFF REJECTED*\n\n*Work date:* ${format(credit.workDate, "dd MMM yyyy")}\n*Reason:* ${reason}\n*Rejected by:* ${rejectorName}`
  );
}

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

export async function finalizeManagerCompOffRequest(creditId: string, text: string) {
  const credit = await prisma.compOffCredit.findUnique({ where: { id: creditId } });
  if (!credit?.slackChannelId || !credit.slackMessageTs) return;

  const client = getSlackClient();
  try {
    await client.chat.update({
      channel: credit.slackChannelId,
      ts: credit.slackMessageTs,
      text,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
    });
  } catch (e) {
    logger.warn({ err: e, creditId }, "Could not update manager DM after Comp Off action");
  }
}

export const updateManagerSlackMessage = finalizeManagerLeaveRequest;
