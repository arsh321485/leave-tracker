import { leaveDateWindowError, toDateKey, addMonthsDateKey } from "@/lib/leave/date-rules";
import { getISTHourAndDate } from "@/lib/ist";

/** Slack modal field errors must be ≤100 chars and keyed by block_id. */
export function mapLeaveValidationToFieldErrors(message: string): Record<string, string> {
  const msg = message.trim().slice(0, 100);
  const lower = message.toLowerCase();

  if (lower.includes("past")) {
    return { from_date: msg || "Cannot apply leave for past dates." };
  }
  if (lower.includes("10:00") || lower.includes("same-day") || lower.includes("same day")) {
    return { from_date: msg || "Same-day leave only before 10:00 AM IST." };
  }
  if (lower.includes("3 months") || lower.includes("3 month") || lower.includes("too far")) {
    if (lower.includes("to date")) {
      return { to_date: msg || "Leave cannot be more than 3 months ahead." };
    }
    return { from_date: msg || "Leave cannot be more than 3 months ahead." };
  }
  if (
    lower.includes("only") &&
    (lower.includes("available") || lower.includes("remaining") || lower.includes("paid leave"))
  ) {
    return { leave_type: msg || "Not enough leave balance remaining." };
  }
  if (lower.includes("no paid leave") || lower.includes("no remaining")) {
    return { leave_type: msg || "No leave balance remaining for this type." };
  }
  if (lower.includes("overlap")) {
    return { from_date: msg || "Dates overlap an existing leave request." };
  }
  if (lower.includes("weekend") || lower.includes("holiday") || lower.includes("working day")) {
    return { from_date: msg || "Selected dates have no working days." };
  }
  if (lower.includes("menstruation") || (lower.includes("1 day") && lower.includes("same"))) {
    return { to_date: msg || "Menstruation leave allows only 1 day." };
  }
  if (lower.includes("half-day") || lower.includes("half day")) {
    return { duration: msg || "Half-day leave must be a single day." };
  }
  if (lower.includes("start date must be on or before")) {
    return { to_date: msg };
  }
  if (lower.includes("reason")) {
    return { reason: msg };
  }
  if (lower.includes("leave type") || lower.includes("not eligible")) {
    return { leave_type: msg };
  }

  return { reason: msg || "Could not submit leave. Check your dates and balance." };
}

/** Instant pre-check — no DB. Use in the Slack route before any slow work. */
export function quickApplyLeaveFieldErrors(input: {
  fromDate?: string;
  toDate?: string;
  reason?: string;
  leaveTypeId?: string;
}): Record<string, string> | null {
  if (!input.leaveTypeId) {
    return { leave_type: "Select a leave type" };
  }
  if (!input.fromDate || !input.toDate) {
    return {
      ...(!input.fromDate ? { from_date: "From date is required" } : {}),
      ...(!input.toDate ? { to_date: "To date is required" } : {}),
    };
  }
  if (!input.reason?.trim()) {
    return { reason: "Reason is required" };
  }

  const dateErr = leaveDateWindowError(input.fromDate, input.toDate);
  if (dateErr) {
    return mapLeaveValidationToFieldErrors(dateErr);
  }

  const { dateKey: today } = getISTHourAndDate();
  const maxKey = addMonthsDateKey(today, 3);
  const endKey = toDateKey(input.toDate);
  if (endKey > maxKey) {
    return {
      to_date: `To date cannot be after ${maxKey} (max 3 months ahead).`.slice(0, 100),
    };
  }

  return null;
}

export function applyLeaveSubmittingView() {
  return {
    type: "modal" as const,
    callback_id: "apply_leave_submitting",
    title: { type: "plain_text" as const, text: "Apply Leave" },
    close: { type: "plain_text" as const, text: "Close" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: ":hourglass_flowing_sand: *Submitting your leave request…*\nPlease wait a moment.",
        },
      },
    ],
  };
}

export function applyLeaveResultView(ok: boolean, text: string) {
  return {
    type: "modal" as const,
    callback_id: "apply_leave_result",
    title: { type: "plain_text" as const, text: ok ? "Leave submitted" : "Could not submit" },
    close: { type: "plain_text" as const, text: "Close" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: (ok ? `:white_check_mark: ${text}` : `:x: ${text}`).slice(0, 2900),
        },
      },
    ],
  };
}
