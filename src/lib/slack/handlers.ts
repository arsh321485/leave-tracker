import { WebClient } from "@slack/web-api";
import { format } from "date-fns";
import { LeaveDuration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateRange } from "@/lib/utils";
import {
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  LeaveValidationError,
} from "@/lib/leave/service";
import {
  createCompOffCredit,
  approveCompOffCredit,
  rejectCompOffCredit,
} from "@/lib/leave/comp-off";
import { leaveHomeBlocks, welcomeBlocks } from "@/lib/slack/blocks";
import { getSlackClient, postSlackMessage, SLACK_CALLBACKS } from "@/lib/slack/client";
import {
  notifyEmployeeLeaveApproved,
  notifyEmployeeLeaveRejected,
  notifyEmployeeCompOffApproved,
  notifyEmployeeCompOffRejected,
  finalizeManagerLeaveRequest,
  finalizeManagerCompOffRequest,
} from "@/lib/slack/notifications";
import { getEmployeeBalancesForDisplay } from "@/lib/leave/balances";
import { MENSTRUATION_LEAVE_CODE } from "@/lib/leave/constants";
import {
  quickApplyLeaveFieldErrors,
  mapLeaveValidationToFieldErrors,
} from "@/lib/slack/apply-leave-errors";
import { hashPayload, withIdempotency } from "@/lib/idempotency";

export async function resolveEmployeeBySlackUserId(slackUserId: string) {
  const id = slackUserId?.trim();
  if (!id) return null;
  // Slack IDs are case-sensitive; also try uppercase in case of paste/normalization drift
  const employee = await prisma.employee.findFirst({
    where: {
      OR: [{ slackUserId: id }, { slackUserId: id.toUpperCase() }, { slackUserId: id.toLowerCase() }],
    },
    include: { manager: true },
  });
  return employee;
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
  await postSlackMessage(client, slackUserId, { text });
}

/** From an existing modal use push; otherwise open. Returns Slack API result (includes view.id). */
async function openOrPushView(
  client: WebClient,
  triggerId: string,
  view: Record<string, unknown>,
  fromModal: boolean
) {
  if (fromModal) {
    return client.views.push({ trigger_id: triggerId, view: view as never });
  }
  return client.views.open({ trigger_id: triggerId, view: view as never });
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

function applyLeaveLoadingView() {
  return {
    type: "modal",
    callback_id: "apply_leave_loading",
    title: { type: "plain_text", text: "Apply Leave" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_Loading leave form…_" },
      },
    ],
  };
}

function buildCompOffCreditView() {
  return {
    type: "modal",
    callback_id: SLACK_CALLBACKS.COMP_OFF_CREDIT_MODAL,
    title: { type: "plain_text", text: "Request Comp Off" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Request credit for *extra work* (e.g. Saturday). After your manager approves, days are added to your Comp Off balance — then apply Comp Off leave like any other leave.",
        },
      },
      {
        type: "input",
        block_id: "work_date",
        label: { type: "plain_text", text: "Work Date (day you worked)" },
        element: { type: "datepicker", action_id: "work_date" },
      },
      {
        type: "input",
        block_id: "duration",
        label: { type: "plain_text", text: "Credit Duration" },
        element: {
          type: "static_select",
          action_id: "duration_select",
          initial_option: {
            text: { type: "plain_text", text: "Full Day (1.0)" },
            value: "FULL_DAY",
          },
          options: [
            { text: { type: "plain_text", text: "Full Day (1.0)" }, value: "FULL_DAY" },
            { text: { type: "plain_text", text: "Half Day (0.5)" }, value: "HALF_DAY" },
          ],
        },
      },
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "Reason / work done" },
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
        },
      },
    ],
  };
}

/**
 * Slack static_select cannot disable options — exhausted types are listed as
 * unavailable (strikethrough) and omitted from the select.
 * Casual + Annual + Comp Off are shown as one Paid Leave pool.
 */
async function buildApplyLeaveView(employeeId: string) {
  const balances = await getEmployeeBalancesForDisplay(employeeId);
  const pooledCodes = new Set(["COMP_OFF", "CASUAL", "ANNUAL"]);
  const pooled = balances.filter((b) => pooledCodes.has(b.leaveType.code));
  const other = balances.filter((b) => !pooledCodes.has(b.leaveType.code));

  const poolRemaining = pooled.reduce((s, b) => s + Math.max(0, b.remaining), 0);
  const poolParts = pooled
    .filter((b) => b.remaining > 0)
    .map((b) => `${b.leaveType.name} ${b.remaining}`)
    .join(" · ");

  const options: { text: { type: "plain_text"; text: string }; value: string }[] = [];

  if (poolRemaining > 0) {
    const label =
      `Paid Leave (Casual+Annual+Comp Off) · ${poolRemaining} left`.slice(0, 75);
    options.push({
      text: { type: "plain_text", text: label },
      value: "__PAID_POOL__",
    });
  }

  for (const b of other) {
    if (b.remaining <= 0) continue;
    const suffix =
      b.leaveType.code === "MENSTRUATION"
        ? ` · ${b.remaining} left · 1 day max`
        : ` · ${b.remaining} left`;
    options.push({
      text: {
        type: "plain_text",
        text: `${b.leaveType.name}${suffix}`.slice(0, 75),
      },
      value: b.leaveType.id,
    });
  }

  const exhaustedNames = [
    ...(poolRemaining <= 0 && pooled.length
      ? ["Paid Leave (Casual+Annual+Comp Off)"]
      : []),
    ...other.filter((b) => b.remaining <= 0).map((b) => b.leaveType.name),
  ];

  if (!options.length) {
    return infoModal(
      "Apply Leave",
      `You have *no remaining leave balance*.\n\n${exhaustedNames
        .map((n) => `~${n}~`)
        .join("\n")}`
    );
  }

  const unavailableBlock =
    exhaustedNames.length > 0
      ? {
          type: "section" as const,
          text: {
            type: "mrkdwn" as const,
            text: `*Unavailable:*\n${exhaustedNames.map((n) => `~${n}~`).join("  ·  ")}`,
          },
        }
      : null;

  const hasMenstruation = options.some((o) =>
    o.text.text.toLowerCase().includes("menstruation")
  );

  return {
    type: "modal",
    callback_id: SLACK_CALLBACKS.APPLY_LEAVE_MODAL,
    title: { type: "plain_text", text: "Apply Leave" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            (poolRemaining > 0
              ? `*Paid Leave pool:* ${poolRemaining} day(s) left` +
                (poolParts ? ` _(${poolParts})_` : "") +
                "\n"
              : "") +
            "_Dates: no past days · same-day only before 10:00 AM IST · max 3 months ahead._",
        },
      },
      ...(unavailableBlock ? [unavailableBlock] : []),
      {
        type: "input",
        block_id: "leave_type",
        label: { type: "plain_text", text: "Leave Type" },
        hint: {
          type: "plain_text",
          text: hasMenstruation
            ? "Menstruation: 1 day only. Paid Leave uses Casual+Annual+Comp Off together."
            : "Paid Leave combines Casual, Annual & Comp Off so you can take longer leave.",
        },
        element: {
          type: "static_select",
          action_id: "leave_type_select",
          placeholder: { type: "plain_text", text: "Select leave type" },
          options,
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
 * Slow actions push a loading modal first, then fill via views.update.
 * Returns optional deferred work so the HTTP 200 can return immediately.
 */
export async function handleModalActionFast(payload: BlockPayload): Promise<{
  deferred?: () => Promise<void>;
} | void> {
  const action = payload.actions[0];
  if (!action) return;

  const client = getSlackClient();
  const fromModal = Boolean(payload.view);
  const slackUserId = payload.user.id;

  if (action.action_id === "apply_leave") {
    // Open loading modal immediately so Slack's 3s limit is met; fill form in deferred work.
    const pushed = await openOrPushView(
      client,
      payload.trigger_id,
      applyLeaveLoadingView(),
      fromModal
    );
    const viewId = (pushed as { view?: { id?: string } })?.view?.id;

    return {
      deferred: async () => {
        try {
          const employee = await resolveEmployeeBySlackUserId(slackUserId);
          if (!employee || employee.status !== "ACTIVE") {
            const msg =
              "Your Slack account is not mapped to an active employee. Contact HR.";
            await dmUser(client, slackUserId, msg);
            if (viewId) {
              await client.views.update({
                view_id: viewId,
                view: infoModal("Not mapped", msg) as never,
              });
            }
            return;
          }

          const view = await buildApplyLeaveView(employee.id);
          if (viewId) {
            await client.views.update({
              view_id: viewId,
              view: view as never,
            });
          }
        } catch (e) {
          if (viewId) {
            await client.views.update({
              view_id: viewId,
              view: infoModal(
                "Apply Leave",
                `Could not open leave form. Please try again.\n_${e instanceof Error ? e.message : "Error"}_`
              ) as never,
            });
          }
        }
      },
    };
  }

  if (action.action_id === "request_comp_off") {
    await openOrPushView(client, payload.trigger_id, buildCompOffCreditView(), fromModal);
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
    return;
  }

  if (action.action_id === "reject_comp_off" && action.value) {
    await openOrPushView(
      client,
      payload.trigger_id,
      {
        type: "modal",
        callback_id: SLACK_CALLBACKS.REJECT_COMP_OFF_MODAL,
        private_metadata: action.value,
        title: { type: "plain_text", text: "Reject Comp Off" },
        submit: { type: "plain_text", text: "Reject" },
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
    return;
  }

  if (
    action.action_id === "my_balance" ||
    action.action_id === "my_history" ||
    action.action_id === "upcoming_holidays"
  ) {
    const titles: Record<string, string> = {
      my_balance: "My Balance",
      my_history: "Leave History",
      upcoming_holidays: "Holidays",
    };
    const title = titles[action.action_id] || "Leave Tracker";
    const pushed = await openOrPushView(
      client,
      payload.trigger_id,
      infoModal(title, "_Loading…_"),
      fromModal
    );
    const viewId = (pushed as { view?: { id?: string } })?.view?.id;

    return {
      deferred: async () => {
        try {
          const employee = await resolveEmployeeBySlackUserId(slackUserId);
          if (!employee || employee.status !== "ACTIVE") {
            if (viewId) {
              await client.views.update({
                view_id: viewId,
                view: infoModal(
                  "Not mapped",
                  "Your Slack account is not mapped to an active employee. Contact HR."
                ) as never,
              });
            }
            return;
          }

          let text = "";
          if (action.action_id === "my_balance") {
            const balances = await getEmployeeBalancesForDisplay(employee.id);
            const pooled = balances.filter((b) =>
              ["COMP_OFF", "CASUAL", "ANNUAL"].includes(b.leaveType.code)
            );
            const other = balances.filter(
              (b) => !["COMP_OFF", "CASUAL", "ANNUAL"].includes(b.leaveType.code)
            );
            const poolRem = pooled.reduce((s, b) => s + Math.max(0, b.remaining), 0);
            const poolDetail = pooled
              .map((b) => `${b.leaveType.name}: ${b.remaining}`)
              .join(" · ");
            const lines = [
              `*Paid Leave pool (Casual + Annual + Comp Off)*\nCombined remaining: *${poolRem}* day(s)\n_${poolDetail || "No balances"}_`,
              ...other.map((b) => {
                const suffix = b.monthly ? " (this month)" : "";
                return `*${b.leaveType.name}*${suffix}\nAllocated: ${b.allocated} | Used: ${b.used} | Pending: ${b.pending} | Remaining: ${b.remaining}`;
              }),
            ];
            text = `🏖️ *MY LEAVE BALANCE*\n\n${lines.join("\n\n") || "No balances found."}`;
          } else if (action.action_id === "my_history") {
            const history = await prisma.leaveRequest.findMany({
              where: { employeeId: employee.id },
              include: { leaveType: true, approvedBy: true, rejectedBy: true },
              orderBy: { createdAt: "desc" },
              take: 20,
            });
            const lines = history.map((r) => {
              const mgr = r.approvedBy?.name || r.rejectedBy?.name || "-";
              return `*${formatDateRange(r.startDate, r.endDate)}*\n${r.leaveType.name} · ${r.days} day(s) · ${r.status} · ${mgr}`;
            });
            text = `📋 *My Leave History*\n\n${lines.join("\n\n") || "No leave requests yet."}`;
          } else {
            const holidays = await prisma.holiday.findMany({
              where: { status: "ACTIVE", date: { gte: new Date() } },
              orderBy: { date: "asc" },
              take: 20,
            });
            const lines = holidays.map(
              (h) => `*${format(h.date, "dd MMM")}*  ${h.name}${h.isOptional ? " _(Optional)_" : ""}`
            );
            text = `🎉 *UPCOMING HOLIDAYS*\n\n${lines.join("\n") || "No upcoming holidays."}`;
          }

          if (viewId) {
            await client.views.update({
              view_id: viewId,
              view: infoModal(title, text) as never,
            });
          }
        } catch (e) {
          if (viewId) {
            await client.views.update({
              view_id: viewId,
              view: infoModal(
                title,
                `Could not load data. Please try again.\n_${e instanceof Error ? e.message : "Error"}_`
              ) as never,
            });
          }
        }
      },
    };
  }
}

/** Approve and other non-modal actions after acknowledging Slack. */
export async function handleBlockActions(payload: BlockPayload) {
  const action = payload.actions[0];
  if (!action) return { ok: true };

  // Menu / modal actions handled on the fast path
  if (
    action.action_id === "apply_leave" ||
    action.action_id === "request_comp_off" ||
    action.action_id === "reject_leave" ||
    action.action_id === "reject_comp_off" ||
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

        await finalizeManagerLeaveRequest(
          request.id,
          `✅ *APPROVED* by ${employee.name}\n${request.employee.name} — ${request.leaveType.name} (${formatDateRange(request.startDate, request.endDate)})`
        );
        await notifyEmployeeLeaveApproved(request.id, employee.name);
      } catch (e) {
        const msg = e instanceof LeaveValidationError ? e.message : "Approval failed";
        await dmUser(client, payload.user.id, msg);
      }
      return { ok: true };
    }

    if (action.action_id === "approve_comp_off" && action.value) {
      try {
        const credit = await approveCompOffCredit({
          creditId: action.value,
          approverEmployeeId: employee.id,
          actorLabel: employee.name,
        });
        await finalizeManagerCompOffRequest(
          credit.id,
          `✅ *COMP OFF APPROVED* by ${employee.name}\n${credit.employee.name} — +${credit.days} day(s) for ${format(credit.workDate, "dd MMM yyyy")}`
        );
        await notifyEmployeeCompOffApproved(credit.id, employee.name);
      } catch (e) {
        const msg = e instanceof LeaveValidationError ? e.message : "Comp Off approval failed";
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

export type ViewSubmissionResult =
  | {
      ok: true;
      requestId?: string;
      compOffCreditId?: string;
      applicantSlackUserId?: string;
    }
  | { ok: false; fieldErrors?: Record<string, string>; message?: string };

/**
 * Creates the leave request synchronously so it always appears in the admin panel.
 * Manager / employee Slack DMs can continue after the modal closes.
 */
export async function processViewSubmissionBackground(
  payload: ViewPayload
): Promise<ViewSubmissionResult> {
  const key = hashPayload([
    "view",
    payload.view.callback_id,
    payload.user.id,
    payload.view.private_metadata || "",
    JSON.stringify(payload.view.state.values),
  ]);

  const { result } = await withIdempotency(key, async (): Promise<ViewSubmissionResult> => {
    const client = getSlackClient();
    const employee = await resolveEmployeeBySlackUserId(payload.user.id);

    const dm = async (text: string) => {
      try {
        await dmUser(client, payload.user.id, text);
      } catch {
        /* DM may fail if app messages disabled — leave is still saved */
      }
    };

    if (!employee || employee.status !== "ACTIVE") {
      await dm("Your Slack account is not mapped to an active employee. Contact HR.");
      return {
        ok: false,
        message: "Your Slack account is not mapped to an active employee. Contact HR.",
      };
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

      const early = quickApplyLeaveFieldErrors({
        leaveTypeId,
        fromDate,
        toDate,
        reason,
      });
      if (early) {
        return { ok: false, fieldErrors: early };
      }

      // Menstruation: only 1 calendar day
      if (leaveTypeId && leaveTypeId !== "__PAID_POOL__") {
        const leaveType = await prisma.leaveType.findUnique({
          where: { id: leaveTypeId },
          select: { code: true },
        });
        if (leaveType?.code === MENSTRUATION_LEAVE_CODE && fromDate !== toDate) {
          return {
            ok: false,
            fieldErrors: {
              to_date:
                "Menstruation leave allows only 1 day. Set From and To to the same date.",
            },
          };
        }
      }

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

        return {
          ok: true,
          requestId: request.id,
          applicantSlackUserId: payload.user.id,
        };
      } catch (e) {
        const msg =
          e instanceof LeaveValidationError
            ? e.message
            : "Could not create leave request. Please try again.";
        // Always show rule errors on the form (past / 10AM / 3 months / balance / overlap)
        return {
          ok: false,
          fieldErrors: mapLeaveValidationToFieldErrors(msg),
          message: msg,
        };
      }
    }

    if (payload.view.callback_id === SLACK_CALLBACKS.COMP_OFF_CREDIT_MODAL) {
      const values = payload.view.state.values;
      const workDate = values.work_date?.work_date?.selected_date;
      const duration =
        (values.duration?.duration_select?.selected_option?.value as LeaveDuration) ||
        LeaveDuration.FULL_DAY;
      const reason = values.reason?.reason_input?.value || "";

      if (!workDate) {
        return { ok: false, fieldErrors: { work_date: "Select the date you worked" } };
      }
      if (!reason.trim()) {
        return { ok: false, fieldErrors: { reason: "Reason is required" } };
      }

      try {
        const credit = await createCompOffCredit({
          employeeId: employee.id,
          workDate,
          duration,
          reason,
          actorLabel: employee.name,
        });
        return {
          ok: true,
          compOffCreditId: credit.id,
          applicantSlackUserId: payload.user.id,
        };
      } catch (e) {
        const msg =
          e instanceof LeaveValidationError ? e.message : "Could not create Comp Off request.";
        await dm(`❌ ${msg}`);
        return { ok: false, message: msg };
      }
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
        await finalizeManagerLeaveRequest(
          request.id,
          `❌ *REJECTED* by ${employee.name}\n${request.employee.name} — ${request.leaveType.name}`
        );
        await notifyEmployeeLeaveRejected(request.id, employee.name, reason);
      } catch (e) {
        const msg = e instanceof LeaveValidationError ? e.message : "Rejection failed.";
        await dm(`❌ ${msg}`);
        return { ok: false, message: msg };
      }
      return { ok: true };
    }

    if (payload.view.callback_id === SLACK_CALLBACKS.REJECT_COMP_OFF_MODAL) {
      const creditId = payload.view.private_metadata!;
      const reason =
        payload.view.state.values.rejection_reason?.rejection_reason_input?.value || "";
      try {
        const credit = await rejectCompOffCredit({
          creditId,
          rejectorEmployeeId: employee.id,
          reason,
          actorLabel: employee.name,
        });
        await finalizeManagerCompOffRequest(
          credit.id,
          `❌ *COMP OFF REJECTED* by ${employee.name}\n${credit.employee.name} — ${format(credit.workDate, "dd MMM yyyy")}`
        );
        await notifyEmployeeCompOffRejected(credit.id, employee.name, reason);
      } catch (e) {
        const msg = e instanceof LeaveValidationError ? e.message : "Rejection failed.";
        await dm(`❌ ${msg}`);
        return { ok: false, message: msg };
      }
      return { ok: true };
    }

    return { ok: true };
  });

  return result;
}
