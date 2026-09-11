import { NextRequest, NextResponse } from "next/server";
import { runDailySlackCronJobs } from "@/lib/slack/morning-status";
import { jsonError } from "@/lib/api";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron (Hobby: once daily at 00:30 UTC = 6:00 AM IST).
 * Auth: Authorization: Bearer <CRON_SECRET> (Vercel sets this automatically when CRON_SECRET env exists).
 *
 * Also posts Friday next-week public/festival holidays on the same daily run.
 * Query ?force=1 skips schedule checks (manual test).
 */
function authorizeCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    logger.error("CRON_SECRET is not set — Vercel Cron cannot authenticate");
    return false;
  }

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  return bearer === secret;
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    logger.warn("Cron morning-status unauthorized — set CRON_SECRET in Vercel Production env");
    return jsonError("Unauthorized", 401);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await runDailySlackCronJobs({ force });
    logger.info({ result }, "Daily Slack cron finished");

    const morningFailed =
      result.morning &&
      "ok" in result.morning &&
      result.morning.ok === false &&
      !("skipped" in result.morning && result.morning.skipped);
    const fridayFailed =
      result.friday &&
      "ok" in result.friday &&
      result.friday.ok === false &&
      !("skipped" in result.friday && result.friday.skipped);

    if (morningFailed || fridayFailed) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logger.error({ err: e }, "Daily Slack cron failed");
    return jsonError(e instanceof Error ? e.message : "Cron failed", 500);
  }
}

/** Allow POST too (some external cron services prefer POST). */
export async function POST(req: NextRequest) {
  return GET(req);
}
