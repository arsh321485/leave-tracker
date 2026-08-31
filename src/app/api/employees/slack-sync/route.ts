import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { syncSlackUsers } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

export async function POST() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  try {
    const users = await syncSlackUsers();
    return NextResponse.json({ count: users.length, users });
  } catch (e) {
    logger.error({ err: e }, "Slack sync failed");
    return jsonError("Slack sync failed. Check SLACK_BOT_TOKEN and scopes.", 500);
  }
}

export async function GET() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  try {
    const users = await syncSlackUsers();
    return NextResponse.json(users);
  } catch (e) {
    logger.error({ err: e }, "Slack sync failed");
    return jsonError("Slack sync failed", 500);
  }
}
