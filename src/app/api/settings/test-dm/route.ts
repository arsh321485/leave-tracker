import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { dmEmployee } from "@/lib/slack/notifications";
import { normalizeSlackId } from "@/lib/slack/ids";
import { logger } from "@/lib/logger";

const schema = z.object({
  slackUserId: z.string().min(1),
});

/** Admin tool: send a test DM to verify bot can message a user. */
export async function POST(req: NextRequest) {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  try {
    const body = schema.parse(await req.json());
    const slackUserId = normalizeSlackId(body.slackUserId);
    if (!slackUserId) {
      return jsonError("Invalid Slack User ID. Paste a U… id from Slack.");
    }

    const result = await dmEmployee(
      slackUserId,
      "✅ *Leave Tracker test DM*\n\nIf you see this, personal DMs from the Leave Tracker bot are working."
    );

    if (!result.ok) {
      return jsonError(result.reason || "DM failed", 400);
    }

    return NextResponse.json({ ok: true, slackUserId });
  } catch (e) {
    logger.error({ err: e }, "Test DM failed");
    return jsonError(e instanceof Error ? e.message : "Test DM failed", 500);
  }
}
