import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/client";
import { handleSlashLeave } from "@/lib/slack/handlers";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const rl = rateLimit(`slack-commands:${req.headers.get("x-forwarded-for") || "local"}`, 60);
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
    logger.warn("Invalid Slack signature on commands");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("command");
  const userId = params.get("user_id") || "";
  const triggerId = params.get("trigger_id") || "";
  const channelId = params.get("channel_id") || "";

  if (command === "/leave" || command === "/leaves") {
    try {
      await handleSlashLeave({
        user_id: userId,
        trigger_id: triggerId,
        channel_id: channelId,
      });
      return new NextResponse("", { status: 200 });
    } catch (e) {
      logger.error({ err: e, command }, "Slash command failed");
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Could not open Leave Tracker. Please try again.",
      });
    }
  }

  return NextResponse.json({
    response_type: "ephemeral",
    text: `Unknown command: ${command || "(empty)"}. Use /leave or /leaves.`,
  });
}
