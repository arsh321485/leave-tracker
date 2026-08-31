import { WebClient } from "@slack/web-api";
import { format } from "date-fns";
import { LeaveDuration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { remainingBalance, formatDateRange } from "@/lib/utils";
import {
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  LeaveValidationError,
} from "@/lib/leave/service";
import { leaveHomeBlocks, managerApprovalBlocks, welcomeBlocks } from "@/lib/slack/blocks";
import { getSlackClient, openDmChannel, SLACK_CALLBACKS } from "@/lib/slack/client";
import { logger } from "@/lib/logger";
import { hashPayload, withIdempotency } from "@/lib/idempotency";

export async function resolveEmployeeBySlackUserId(slackUserId: string) {
  return prisma.employee.findUnique({
    where: { slackUserId },
    include: { manager: true },
  });
}

export async function postWelcomeToLeaveChannel() {
  const channel = process.env.SLACK_LEAVE_CHANNEL_ID;
  if (!channel) throw new Error("SLACK_LEAVE_CHANNEL_ID is not set");
  const client = getSlackClient();
  await client.chat.postMessage({
    channel,
    text: "SecureITLab Leave Tracker",
    blocks: welcomeBlocks(),
  });
}

async function dmUser(client: WebClient, slackUserId: string, text: string) {
  const channelId = await openDmChannel(client, slackUserId);
  if (channelId) {
    await client.chat.postMessage({ channel: channelId, text });
  } else {
    await client.chat.postMessage({ channel: slackUserId, text });
  }
}

/** From an existing modal use push; otherwise open. */
async function openOrPushView(
  client: WebClient,
  triggerId: string,
  view: Record<string, unknown>,
  fromModal: boolean
) {
  if (fromModal) {
    await client.views.push({ trigger_id: triggerId, view: view as never });
  } else {
    await client.views.open({ trigger_id: triggerId, view: view as never });
  }
}

function infoModal(title: string, text: string) {
  const truncated = text.length > 2900 ? `${text.slice(0, 2900)}…` : text;
  return {
    type: "modal",
    title: { type: "plain_text", text: title.slice(0, 24) },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: truncated || "_No data_" },
      },
    ],
  };
}

export async function handleSlashLeave(payload: {
  user_id: string;
  trigger_id: string;
  channel_id: string;
}) {
  const client = getSlackClient();
  await client.views.open({
    trigger_id: payload.trigger_id,
    view: {
      type: "modal",
      callback_id: SLACK_CALLBACKS.LEAVE_HOME,
      title: { type: "plain_text", text: "Leave Tracker" },
      close: { type: "plain_text", text: "Close" },
      blocks: leaveHomeBlocks(),
    },
  });
}

async function buildApplyLeaveView() {
  const types = await prisma.leaveType.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  if (!types.length) {
    throw new Error("No active leave types configured. Ask HR to add leave types.");
  }

  return {
    type: "modal",
    callback_id: SLACK_CALLBACKS.APPLY_LEAVE_MODAL,
    title: { type: "plain_text", text: "Apply Leave" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "leave_type",
        label: { type: "plain_text", text: "Leave Type" },
        element: {
          type: "static_select",
          action_id: "leave_type_select",
          options: types.map((t) => ({
            text: { type: "plain_text", text: t.name.slice(0, 75) },
            value: t.id,
          })),
        },
      },
      {
        type: "input",
        block_id: "from_date",
        label: { type: "plain_text", text: "From Date" },
        element: { type: "datepicker", action_id: "from_date" },
      },
      {
        type: "input",
        block_id: "to_date",
        label: { type: "plain_text", text: "To Date" },
        element: { type: "datepicker", action_id: "to_date" },
      },
      {
        type: "input",
        block_id: "duration",
        label: { type: "plain_text", text: "Leave Duration" },
        element: {
          type: "static_select",
          action_id: "duration_select",
          initial_option: {
            text: { type: "plain_text", text: "Full Day" },
            value: "FULL_DAY",
          },
          options: [
            { text: { type: "plain_text", text: "Full Day" }, value: "FULL_DAY" },
            { text: { type: "plain_text", text: "Half Day" }, value: "HALF_DAY" },
          ],
        },
      },
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "Reason" },
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
        },
      },
    ],
  };
}

export async function notifyManagerOfLeave(requestId: string) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: { include: { manager: true } },
      leaveType: true,
    },
  });
  if (!request?.employee.manager?.slackUserId) {
    logger.warn({ requestId }, "Manager has no Slack user ID; skipping DM");
    return;
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

type BlockPayload = {
  user: { id: string };
  trigger_id: string;
  actions: Array<{ action_id: string; value?: string }>;
  response_url?: string;
  channel?: { id: string };
  message?: { ts: string };
  /** Present when the button was clicked inside a modal */
  view?: { id: string; type?: string; callback_id?: string };
};

/**
 * Handles menu buttons quickly (within Slack's 3s limit).
 * Buttons inside the Leave Tracker modal must use views.push, not views.open.
 */
export async function handleModalActionFast(payload: BlockPayload) {
  const action = payload.actions[0];
  if (!action) return;

  const client = getSlackClient();
  const fromModal = Boolean(payload.view);

  const employee = await resolveEmployeeBySlackUserId(payload.user.id);
  if (!employee || employee.status !== "ACTIVE") {
    await dmUser(
      client,
      payload.user.id,
      "Your Slack account is not mapped to an active employee. Contact HR."
    );
    if (fromModal) {
      await openOrPushView(
        client,
        payload.trigger_id,
        infoModal("Not mapped", "Your Slack account is not mapped to an active employee. Contact HR."),
        true
      );
    }
    return;
  }

  if (action.action_id === "apply_leave") {
    const view = await buildApplyLeaveView();
    await openOrPushView(client, payload.trigger_id, view, fromModal);
    return;
  }

  if (action.action_id === "my_balance") {
    const year = new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year },
      include: { leaveType: true },
      orderBy: { leaveType: { name: "asc" } },
    });
    const lines = balances.map((b) => {
      const rem = remainingBalance(b);
      return `*${b.leaveType.name}*\nAllocated: ${b.allocated} | Used: ${b.used} | Pending: ${b.pending} | Remaining: ${rem}`;
    });
    const text = `🏖️ *MY LEAVE BALANCE*\n\n${lines.join("\n\n") || "No balances found."}`;
    await openOrPushView(client, payload.trigger_id, infoModal("My Balance", text), fromModal);
    return;
  }

  if (action.action_id === "my_history") {
    const history = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      include: { leaveType: true, approvedBy: true, rejectedBy: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    const lines = history.map((r) => {
      const mgr = r.approvedBy?.name || r.rejectedBy?.name || "-";
      return `*${formatDateRange(r.startDate, r.endDate)}*\n${r.leaveType.name} · ${r.days} days · ${r.status} · ${mgr}`;
    });
    const text = `📋 *My Leave History*\n\n${lines.join("\n\n") || "No leave history."}`;
    await openOrPushView(client, payload.trigger_id, infoModal("Leave History", text), fromModal);
    return;
  }

  if (action.action_id === "upcoming_holidays") {
    const holidays = await prisma.holiday.findMany({
      where: { status: "ACTIVE", date: { gte: new Date() } },
      orderBy: { date: "asc" },
      take: 20,
    });
    const lines = holidays.map(
      (h) => `*${format(h.date, "dd MMM")}*  ${h.name}${h.isOptional ? " _(Optional)_" : ""}`
    );
    const text = `🎉 *UPCOMING HOLIDAYS*\n\n${lines.join("\n") || "No upcoming holidays."}`;
    await openOrPushView(client, payload.trigger_id, infoModal("Holidays", text), fromModal);
    return;
  }

  if (action.action_id === "reject_leave" && action.value) {
    await openOrPushView(
      client,
      payload.trigger_id,
      {
        type: "modal",
        callback_id: SLACK_CALLBACKS.REJECT_LEAVE_MODAL,
        private_metadata: action.value,
        title: { type: "plain_text", text: "Reject Leave" },
        submit: { type: "plain_text", text: "Reject Leave" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "rejection_reason",
            label: { type: "plain_text", text: "Reason for rejection" },
            element: {
              type: "plain_text_input",
              action_id: "rejection_reason_input",
              multiline: true,
            },
          },
        ],
      },
      fromModal
    );
  }
}

/** Approve and other non-modal actions after acknowledging Slack. */
export async function handleBlockActions(payload: BlockPayload) {
  const action = payload.actions[0];
  if (!action) return { ok: true };

  // Menu / modal actions handled on the fast path
  if (
    action.action_id === "apply_leave" ||
    action.action_id === "reject_leave" ||
    action.action_id === "my_balance" ||
    action.action_id === "my_history" ||
    action.action_id === "upcoming_holidays"
  ) {
    return { ok: true };
  }

  const key = hashPayload([
    "action",
    payload.trigger_id,
    action.action_id,
    action.value || "",
  ]);

  return withIdempotency(key, async () => {
    const client = getSlackClient();
    const employee = await resolveEmployeeBySlackUserId(payload.user.id);

    if (!employee || employee.status !== "ACTIVE") {
      await dmUser(
        client,
        payload.user.id,
        "Your Slack account is not mapped to an active employee. Contact HR."
      );
      return { ok: false };
    }

    if (action.action_id === "approve_leave" && action.value) {
      try {
        const { request } = await approveLeaveRequest({
          requestId: action.value,
          approverEmployeeId: employee.id,
          actorLabel: employee.name,
        });
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

        if (request.slackChannelId && request.slackMessageTs) {
          await client.chat.update({
            channel: request.slackChannelId,
            ts: request.slackMessageTs,
            text: `Approved — ${request.employee.name}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `✅ *APPROVED* by ${employee.name}\n${request.employee.name} — ${request.leaveType.name} (${formatDateRange(request.startDate, request.endDate)})`,
                },
              },
            ],
          });
        }

        if (request.employee.slackUserId) {
          await dmUser(
            client,
            request.employee.slackUserId,
            `✅ LEAVE APPROVED\n\nYour leave request has been approved.\n\nLeave: ${request.leaveType.name}\nDate: ${formatDateRange(request.startDate, request.endDate)}\nDays: ${request.days}\nApproved By: ${employee.name}\nRemaining Balance: ${bal ? remainingBalance(bal) : "n/a"} days`
          );
        }
      } catch (e) {
        const msg = e instanceof LeaveValidationError ? e.message : "Approval failed";
        await dmUser(client, payload.user.id, msg);
      }
      return { ok: true };
    }

    return { ok: true };
  });
}

type ViewPayload = {
  user: { id: string };
  view: {
    callback_id: string;
    private_metadata?: string;
    state: {
      values: Record<
        string,
        Record<
          string,
          { selected_option?: { value: string }; selected_date?: string; value?: string }
        >
      >;
    };
  };
};

export async function processViewSubmissionBackground(payload: ViewPayload) {
  const key = hashPayload([
    "view",
    payload.view.callback_id,
    payload.user.id,
    payload.view.private_metadata || "",
    JSON.stringify(payload.view.state.values),
  ]);

  await withIdempotency(key, async () => {
    const client = getSlackClient();
    const employee = await resolveEmployeeBySlackUserId(payload.user.id);

    const dm = async (text: string) => dmUser(client, payload.user.id, text);

    if (!employee || employee.status !== "ACTIVE") {
      await dm("Your Slack account is not mapped to an active employee. Contact HR.");
      return { ok: false };
    }

    if (payload.view.callback_id === SLACK_CALLBACKS.APPLY_LEAVE_MODAL) {
      const values = payload.view.state.values;
      const leaveTypeId = values.leave_type?.leave_type_select?.selected_option?.value;
      const fromDate = values.from_date?.from_date?.selected_date;
      const toDate = values.to_date?.to_date?.selected_date;
      const duration =
        (values.duration?.duration_select?.selected_option?.value as LeaveDuration) ||
        LeaveDuration.FULL_DAY;
      const reason = values.reason?.reason_input?.value || "";

      try {
        const request = await createLeaveRequest({
          employeeId: employee.id,
          leaveTypeId: leaveTypeId!,
          startDate: fromDate!,
          endDate: toDate!,
          duration,
          reason,
          actorLabel: employee.name,
        });
        await notifyManagerOfLeave(request.id);
        await dm(
          `✅ Leave request submitted (${request.days} day(s)). Your manager will review it.`
        );
      } catch (e) {
        const msg =
          e instanceof LeaveValidationError ? e.message : "Could not create leave request.";
        await dm(`❌ ${msg}`);
      }
      return { ok: true };
    }

    if (payload.view.callback_id === SLACK_CALLBACKS.REJECT_LEAVE_MODAL) {
      const requestId = payload.view.private_metadata!;
      const reason =
        payload.view.state.values.rejection_reason?.rejection_reason_input?.value || "";
      try {
        const { request } = await rejectLeaveRequest({
          requestId,
          rejectorEmployeeId: employee.id,
          reason,
          actorLabel: employee.name,
        });
        if (request.slackChannelId && request.slackMessageTs) {
          await client.chat.update({
            channel: request.slackChannelId,
            ts: request.slackMessageTs,
            text: `Rejected — ${request.employee.name}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `❌ *REJECTED* by ${employee.name}\n${request.employee.name} — ${request.leaveType.name}`,
                },
              },
            ],
          });
        }
        if (request.employee.slackUserId) {
          await dmUser(
            client,
            request.employee.slackUserId,
            `❌ LEAVE REJECTED\n\nYour leave request has been rejected.\n\nDate: ${formatDateRange(request.startDate, request.endDate)}\nReason: ${reason}\nRejected By: ${employee.name}`
          );
        }
      } catch (e) {
        const msg = e instanceof LeaveValidationError ? e.message : "Rejection failed.";
        await dm(`❌ ${msg}`);
      }
      return { ok: true };
    }

    return { ok: true };
  });
}
