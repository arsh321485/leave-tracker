import { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/prisma";
import { remainingBalance, formatDateRange } from "@/lib/utils";
import { getSlackClient, openDmChannel } from "@/lib/slack/client";
import { managerApprovalBlocks } from "@/lib/slack/blocks";

async function dmUser(client: WebClient, slackUserId: string, text: string) {
  const channelId = await openDmChannel(client, slackUserId);
  if (channelId) {
    await client.chat.postMessage({ channel: channelId, text });
  } else {
    await client.chat.postMessage({ channel: slackUserId, text });
  }
}

export async function notifyManagerOfLeave(requestId: string) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: { include: { manager: true } },
      leaveType: true,
    },
  });
  if (!request?.employee.manager?.slackUserId) return;

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

  const client = getSlackClient();
  const channelId = await openDmChannel(client, request.employee.manager.slackUserId);
  if (!channelId) return;

  const result = await client.chat.postMessage({
    channel: channelId,
    text: "Leave approval required",
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
      slackChannelId: channelId,
    },
  });
}

export async function notifyEmployeeLeaveApproved(
  requestId: string,
  approverName: string
) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: true, leaveType: true },
  });
  if (!request?.employee.slackUserId) return;

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

  const client = getSlackClient();
  await dmUser(
    client,
    request.employee.slackUserId,
    `✅ LEAVE APPROVED\n\nYour leave request has been approved.\n\nLeave: ${request.leaveType.name}\nDate: ${formatDateRange(request.startDate, request.endDate)}\nDays: ${request.days}\nApproved By: ${approverName}\nRemaining Balance: ${bal ? remainingBalance(bal) : "n/a"} days`
  );
}

export async function notifyEmployeeLeaveRejected(
  requestId: string,
  rejectorName: string,
  reason: string
) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: true, leaveType: true },
  });
  if (!request?.employee.slackUserId) return;

  const client = getSlackClient();
  await dmUser(
    client,
    request.employee.slackUserId,
    `❌ LEAVE REJECTED\n\nYour leave request has been rejected.\n\nLeave: ${request.leaveType.name}\nDate: ${formatDateRange(request.startDate, request.endDate)}\nReason: ${reason}\nRejected By: ${rejectorName}`
  );
}

export async function updateManagerSlackMessage(
  requestId: string,
  text: string
) {
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
