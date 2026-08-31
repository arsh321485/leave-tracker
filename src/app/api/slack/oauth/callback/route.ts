import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * OAuth callback for installing SecureITLab Leave Tracker into the EXISTING
 * Secureitlab workspace. Does not create a workspace.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/leave/dashboard?slack_error=${encodeURIComponent(error)}`, req.url)
    );
  }
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = `${process.env.BACKEND_URL}/api/slack/oauth/callback`;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "OAuth not configured" }, { status: 500 });
  }

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    logger.error({ error: data.error }, "Slack OAuth failed");
    return NextResponse.redirect(
      new URL(`/leave/dashboard?slack_error=${data.error}`, req.url)
    );
  }

  await prisma.slackInstallation.upsert({
    where: { teamId: data.team.id },
    update: {
      teamName: data.team.name,
      botUserId: data.bot_user_id,
    },
    create: {
      teamId: data.team.id,
      teamName: data.team.name,
      botUserId: data.bot_user_id,
    },
  });

  // Bot token must be stored in env by admin — never expose to frontend.
  logger.info(
    { team: data.team.name },
    "Slack app installed. Set SLACK_BOT_TOKEN from the install response in your server env."
  );

  return NextResponse.redirect(new URL("/leave/dashboard?slack=installed", req.url));
}
