import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import {
  getAppSetting,
  setAppSetting,
  SETTING_MORNING_STATUS_SLACK_ID,
  SETTING_MORNING_STATUS_HOUR_IST,
  getMorningStatusHourIst,
  sendMorningStatusDigest,
} from "@/lib/slack/morning-status";
import { logger } from "@/lib/logger";

const schema = z.object({
  morningStatusSlackId: z.string().optional(),
  morningStatusHourIst: z.number().int().min(0).max(23).optional(),
});

function formatHourIst(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export async function GET() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const morningStatusSlackId = await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID);
  const morningStatusHourIst = await getMorningStatusHourIst();
  return NextResponse.json({
    morningStatusSlackId: morningStatusSlackId || "",
    morningStatusHourIst,
    morningStatusTimeLabel: formatHourIst(morningStatusHourIst),
  });
}

export async function PUT(req: NextRequest) {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  try {
    const body = schema.parse(await req.json());
    if (body.morningStatusSlackId !== undefined) {
      await setAppSetting(SETTING_MORNING_STATUS_SLACK_ID, body.morningStatusSlackId.trim());
    }
    if (body.morningStatusHourIst !== undefined) {
      await setAppSetting(SETTING_MORNING_STATUS_HOUR_IST, String(body.morningStatusHourIst));
    }

    const morningStatusSlackId = await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID);
    const morningStatusHourIst = await getMorningStatusHourIst();
    return NextResponse.json({
      morningStatusSlackId: morningStatusSlackId || "",
      morningStatusHourIst,
      morningStatusTimeLabel: formatHourIst(morningStatusHourIst),
    });
  } catch (e) {
    logger.error({ err: e }, "Save settings failed");
    return jsonError(e instanceof Error ? e.message : "Save failed", 500);
  }
}

export async function POST() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  try {
    const result = await sendMorningStatusDigest();
    if (!result.ok) return jsonError(result.reason || "Failed to send", 400);
    return NextResponse.json(result);
  } catch (e) {
    logger.error({ err: e }, "Morning status send failed");
    const msg =
      e instanceof Error
        ? e.message.includes("SLACK_BOT_TOKEN")
          ? "Slack bot token is not configured on the server"
          : e.message
        : "Failed to send morning status";
    return jsonError(msg, 500);
  }
}
