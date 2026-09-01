import crypto from "crypto";
import type { Block, KnownBlock } from "@slack/web-api";
import { WebClient } from "@slack/web-api";
import { safeEqual } from "@/lib/idempotency";
import { logger } from "@/lib/logger";

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

export function resolveSlackMessageTarget(recipient: string) {
  return recipient.trim();
}

function slackErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "data" in err) {
    return (err as { data?: { error?: string } }).data?.error;
  }
  return undefined;
}

/** Post to a user DM (U…) or channel (C…). */
export async function postSlackMessage(
  client: WebClient,
  recipient: string,
  input: { text: string; blocks?: (KnownBlock | Block)[] }
) {
  const target = resolveSlackMessageTarget(recipient);
  const message = {
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
  };

  async function send(channel: string) {
    const result = await client.chat.postMessage({ channel, ...message });
    return {
      channel: (result.channel as string) || channel,
      ts: result.ts as string,
    };
  }

  try {
    return await send(target);
  } catch (first) {
    const code = slackErrorCode(first);
    // Some workspaces need a DM channel opened first (not messages_tab_disabled)
    if (/^[UW]/.test(target) && code === "channel_not_found") {
      try {
        const opened = await client.conversations.open({ users: target });
        const dm = opened.channel?.id;
        if (dm) return await send(dm);
      } catch (openErr) {
        logger.warn({ err: openErr, target }, "conversations.open fallback failed");
      }
    }
    throw first;
  }
}

/** @deprecated Use postSlackMessage */
export async function openDmChannel(_client: WebClient, slackUserId: string) {
  return slackUserId.trim();
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
