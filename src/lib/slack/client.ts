import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { safeEqual } from "@/lib/idempotency";

export function getSlackClient() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }
  return new WebClient(token);
}

export function verifySlackSignature(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string
): boolean {
  if (!signature || !timestamp || !signingSecret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const fiveMinutes = 60 * 5;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > fiveMinutes) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const computed = `v0=${hmac}`;
  return safeEqual(computed, signature);
}

export async function resolveSlackMessageTarget(client: WebClient, recipient: string) {
  const trimmed = recipient.trim();
  // Channel / group IDs — post directly (conversations.open is for user DMs only)
  if (/^[CGD]/.test(trimmed)) {
    return trimmed;
  }
  const dm = await openDmChannel(client, trimmed);
  return dm || trimmed;
}

export async function openDmChannel(client: WebClient, slackUserId: string) {
  const res = await client.conversations.open({ users: slackUserId });
  return res.channel?.id;
}

export const SLACK_ACTIONS = {
  APPLY_LEAVE: "apply_leave",
  MY_BALANCE: "my_balance",
  MY_HISTORY: "my_history",
  UPCOMING_HOLIDAYS: "upcoming_holidays",
  APPROVE_LEAVE: "approve_leave",
  REJECT_LEAVE: "reject_leave",
  REJECT_LEAVE_SUBMIT: "reject_leave_submit",
} as const;

export const SLACK_CALLBACKS = {
  APPLY_LEAVE_MODAL: "apply_leave_modal",
  REJECT_LEAVE_MODAL: "reject_leave_modal",
  LEAVE_HOME: "leave_home",
} as const;
