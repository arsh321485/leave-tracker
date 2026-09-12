import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackSignature, getSlackClient, SLACK_CALLBACKS } from "@/lib/slack/client";
import {
  handleBlockActions,
  handleModalActionFast,
  processViewSubmissionBackground,
} from "@/lib/slack/handlers";
import {
  sendLeaveSubmittedNotifications,
  sendCompOffSubmittedNotifications,
} from "@/lib/slack/notifications";
import {
  quickApplyLeaveFieldErrors,
  applyLeaveSubmittingView,
  applyLeaveResultView,
} from "@/lib/slack/apply-leave-errors";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

const FAST_ACTIONS = new Set([
  "apply_leave",
  "request_comp_off",
  "reject_leave",
  "reject_comp_off",
  "my_balance",
  "my_history",
  "upcoming_holidays",
]);

export async function POST(req: NextRequest) {
  const rl = rateLimit(`slack-interactions:${req.headers.get("x-forwarded-for") || "local"}`, 120);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const rawBody = await req.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const valid = verifySlackSignature(
    signingSecret,
    req.headers.get("x-slack-signature"),
    req.headers.get("x-slack-request-timestamp"),
    rawBody
  );
  if (!valid) {
    logger.warn("Invalid Slack signature on interactions");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") || "{}");

  try {
    if (payload.type === "block_actions") {
      const actionId = payload.actions?.[0]?.action_id as string | undefined;

      if (actionId && FAST_ACTIONS.has(actionId)) {
        try {
          const result = await handleModalActionFast(payload);
          if (result?.deferred) {
            const work = result.deferred();
            after(async () => {
              try {
                await work;
              } catch (e) {
                logger.error({ err: e, actionId }, "Deferred modal fill failed");
              }
            });
          }
        } catch (e) {
          logger.error({ err: e, actionId }, "Fast modal action failed");
          try {
            const client = getSlackClient();
            await client.chat.postMessage({
              channel: payload.user.id,
              text: `Leave Tracker error: ${e instanceof Error ? e.message : "Please try again."}`,
            });
          } catch {
            /* ignore */
          }
        }
        return new NextResponse("", { status: 200 });
      }

      after(async () => {
        try {
          await handleBlockActions(payload);
        } catch (e) {
          logger.error({ err: e }, "Background block action failed");
        }
      });
      return new NextResponse("", { status: 200 });
    }

    if (payload.type === "view_submission") {
      const callbackId = payload.view?.callback_id as string | undefined;

      // --- Apply Leave: instant rule check (no DB) so Slack never times out ---
      if (callbackId === SLACK_CALLBACKS.APPLY_LEAVE_MODAL) {
        const values = payload.view.state?.values || {};
        const leaveTypeId = values.leave_type?.leave_type_select?.selected_option?.value;
        const fromDate = values.from_date?.from_date?.selected_date;
        const toDate = values.to_date?.to_date?.selected_date;
        const reason = values.reason?.reason_input?.value || "";

        const early = quickApplyLeaveFieldErrors({
          leaveTypeId,
          fromDate,
          toDate,
          reason,
        });
        if (early) {
          return NextResponse.json({
            response_action: "errors",
            errors: early,
          });
        }

        // Dates OK — show loading modal immediately, finish save in background
        const viewId = payload.view?.id as string | undefined;
        after(async () => {
          try {
            const result = await processViewSubmissionBackground(payload);
            const client = getSlackClient();

            if (!result.ok) {
              const errText =
                result.message ||
                (result.fieldErrors
                  ? Object.values(result.fieldErrors).join(" ")
                  : "Could not submit leave.");
              if (viewId) {
                await client.views.update({
                  view_id: viewId,
                  view: applyLeaveResultView(false, errText) as never,
                });
              }
              return;
            }

            if (viewId) {
              await client.views.update({
                view_id: viewId,
                view: applyLeaveResultView(
                  true,
                  "Your leave request was submitted. Your manager will be notified."
                ) as never,
              });
            }

            if (result.requestId && result.applicantSlackUserId) {
              const notify = await sendLeaveSubmittedNotifications(
                result.requestId,
                result.applicantSlackUserId
              );
              logger.info({ requestId: result.requestId, notify }, "Leave submit Slack notify done");
            }
          } catch (e) {
            logger.error({ err: e }, "Apply leave background submit failed");
            try {
              if (viewId) {
                const client = getSlackClient();
                await client.views.update({
                  view_id: viewId,
                  view: applyLeaveResultView(
                    false,
                    e instanceof Error ? e.message : "Could not submit leave. Please try again."
                  ) as never,
                });
              }
            } catch {
              /* ignore */
            }
          }
        });

        return NextResponse.json({
          response_action: "update",
          view: applyLeaveSubmittingView(),
        });
      }

      // --- Other modals (Comp Off, reject, etc.) ---
      const work = processViewSubmissionBackground(payload);

      after(async () => {
        try {
          const result = await work;
          if (result.ok && result.applicantSlackUserId) {
            if (result.compOffCreditId) {
              const notify = await sendCompOffSubmittedNotifications(
                result.compOffCreditId,
                result.applicantSlackUserId
              );
              logger.info(
                { creditId: result.compOffCreditId, notify },
                "Comp Off submit Slack notify done"
              );
            }
          }
        } catch (e) {
          logger.error({ err: e }, "View submission / notify failed");
        }
      });

      try {
        const outcome = await Promise.race([
          work.then((r) => ({ type: "done" as const, r })),
          new Promise<{ type: "slow" }>((resolve) =>
            setTimeout(() => resolve({ type: "slow" }), 2500)
          ),
        ]);

        if (outcome.type === "done" && !outcome.r.ok) {
          if (outcome.r.fieldErrors) {
            return NextResponse.json({
              response_action: "errors",
              errors: outcome.r.fieldErrors,
            });
          }
          if (outcome.r.message) {
            return NextResponse.json({
              response_action: "errors",
              errors: { reason: outcome.r.message.slice(0, 100) },
            });
          }
        }
      } catch (e) {
        logger.error({ err: e }, "View submission failed early");
      }

      return NextResponse.json({ response_action: "clear" });
    }
  } catch (e) {
    logger.error({ err: e }, "Slack interaction error");
  }

  return new NextResponse("", { status: 200 });
}
