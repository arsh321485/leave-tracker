import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/client";
import { handleBlockActions, handleViewSubmission } from "@/lib/slack/handlers";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

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
      await handleBlockActions(payload);
      return new NextResponse("", { status: 200 });
    }
    if (payload.type === "view_submission") {
      const result = await handleViewSubmission(payload);
      const body = result.result as Record<string, unknown>;
      if (body?.response_action === "errors") {
        return NextResponse.json(body);
      }
      return NextResponse.json(body?.response_action ? body : { response_action: "clear" });
    }
  } catch (e) {
    logger.error({ err: e }, "Slack interaction error");
  }

  return new NextResponse("", { status: 200 });
}
