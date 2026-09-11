import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { sendFridayUpcomingHolidaysDigest } from "@/lib/slack/morning-status";
import { logger } from "@/lib/logger";

export async function POST() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  try {
    const result = await sendFridayUpcomingHolidaysDigest();
    if (!result.ok) return jsonError(result.reason || "Failed to send", 400);
    return NextResponse.json(result);
  } catch (e) {
    logger.error({ err: e }, "Friday holiday test failed");
    return jsonError(e instanceof Error ? e.message : "Failed", 500);
  }
}
