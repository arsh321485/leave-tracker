import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackSignature } from "@/lib/slack/client";
import {
  handleBlockActions,
  handleModalActionFast,
  processViewSubmissionBackground,
} from "@/lib/slack/handlers";
import { sendLeaveSubmittedNotifications, sendCompOffSubmittedNotifications } from "@/lib/slack/notifications";
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
            const { getSlackClient } = await import("@/lib/slack/client");
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
      // Save leave quickly; DMs must run inside after() or Vercel kills them.
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
            } else if (result.requestId) {
              const notify = await sendLeaveSubmittedNotifications(
                result.requestId,
                result.applicantSlackUserId
              );
              logger.info({ requestId: result.requestId, notify }, "Leave submit Slack notify done");
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
            setTimeout(() => resolve({ type: "slow" }), 1800)
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
