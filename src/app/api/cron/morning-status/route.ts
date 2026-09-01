import { NextRequest, NextResponse } from "next/server";
import { sendMorningStatusDigest } from "@/lib/slack/morning-status";
import { jsonError } from "@/lib/api";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError("Unauthorized", 401);
  }

  const result = await sendMorningStatusDigest();
  if (!result.ok) return jsonError(result.reason || "Failed", 400);
  return NextResponse.json(result);
}
