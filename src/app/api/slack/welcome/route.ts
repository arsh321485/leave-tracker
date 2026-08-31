import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { postWelcomeToLeaveChannel } from "@/lib/slack/handlers";
import { logger } from "@/lib/logger";

export async function POST() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  try {
    await postWelcomeToLeaveChannel();
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "Failed to post welcome");
    return jsonError(e instanceof Error ? e.message : "Failed to post welcome", 500);
  }
}
