import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import {
  getAppSetting,
  setAppSetting,
  SETTING_MORNING_STATUS_SLACK_ID,
} from "@/lib/slack/morning-status";
import { sendMorningStatusDigest } from "@/lib/slack/morning-status";

const schema = z.object({
  morningStatusSlackId: z.string().optional(),
});

export async function GET() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const morningStatusSlackId = await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID);
  return NextResponse.json({ morningStatusSlackId: morningStatusSlackId || "" });
}

export async function PUT(req: NextRequest) {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const body = schema.parse(await req.json());
  if (body.morningStatusSlackId !== undefined) {
    await setAppSetting(SETTING_MORNING_STATUS_SLACK_ID, body.morningStatusSlackId.trim());
  }

  const morningStatusSlackId = await getAppSetting(SETTING_MORNING_STATUS_SLACK_ID);
  return NextResponse.json({ morningStatusSlackId: morningStatusSlackId || "" });
}

export async function POST() {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const result = await sendMorningStatusDigest();
  if (!result.ok) return jsonError(result.reason || "Failed to send", 400);
  return NextResponse.json(result);
}
