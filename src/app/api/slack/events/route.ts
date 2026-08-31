import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/client";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { withIdempotency } from "@/lib/idempotency";

export async function POST(req: NextRequest) {
  const rl = rateLimit(`slack-events:${req.headers.get("x-forwarded-for") || "local"}`, 120);
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
    logger.warn("Invalid Slack signature on events");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody);

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.type === "event_callback" && body.event_id) {
    await withIdempotency(`event:${body.event_id}`, async () => {
      logger.info({ type: body.event?.type }, "Slack event received");
      return { ok: true };
    });
  }

  return NextResponse.json({ ok: true });
}
