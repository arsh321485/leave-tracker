import { NextRequest, NextResponse } from "next/server";
import {
  sendMorningStatusDigest,
  sendMorningStatusDigestIfScheduled,
} from "@/lib/slack/morning-status";
import { jsonError } from "@/lib/api";

/**
 * Called by Vercel Cron (Hobby: once daily) or an external free cron (cron-job.org).
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Query ?force=1 skips the IST hour check (for manual/external triggers).
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError("Unauthorized", 401);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = force
    ? await sendMorningStatusDigest()
    : await sendMorningStatusDigestIfScheduled();

  if ("skipped" in result && result.skipped) {
    return NextResponse.json(result);
  }
  if (!result.ok) return jsonError(result.reason || "Failed", 400);
  return NextResponse.json(result);
}
