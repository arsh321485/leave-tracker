import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackSignature } from "@/lib/slack/client";
import {
  handleBlockActions,
  handleModalActionFast,
  processViewSubmissionBackground,
} from "@/lib/slack/handlers";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

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

      // views.open must happen within 3s of trigger_id — do it before responding
      if (actionId === "apply_leave" || actionId === "reject_leave") {
        try {
          await handleModalActionFast(payload);
        } catch (e) {
          logger.error({ err: e, actionId }, "Fast modal action failed");
        }
        return new NextResponse("", { status: 200 });
      }

      // Ack immediately; finish balance/history/approve in background
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
      // Ack within 3s, then create leave / reject in background (DM on success/error)
      after(async () => {
        try {
          await processViewSubmissionBackground(payload);
        } catch (e) {
          logger.error({ err: e }, "Background view submission failed");
        }
      });
      return NextResponse.json({ response_action: "clear" });
    }
  } catch (e) {
    logger.error({ err: e }, "Slack interaction error");
  }

  return new NextResponse("", { status: 200 });
}
