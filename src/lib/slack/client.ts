import crypto from "crypto";
import type { Block, KnownBlock } from "@slack/web-api";
import { WebClient } from "@slack/web-api";
import { safeEqual } from "@/lib/idempotency";
import { logger } from "@/lib/logger";
import { isSlackUserId, normalizeSlackId } from "@/lib/slack/ids";

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
  return normalizeSlackId(recipient) || recipient.trim();
}

export function slackErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "data" in err) {
    return (err as { data?: { error?: string } }).data?.error;
  }
  if (err instanceof Error) {
    const m = err.message.match(/(\w+_disabled|channel_not_found|not_in_channel|invalid_auth|missing_scope)/);
    return m?.[1];
  }
  return undefined;
}

async function findExistingDmChannel(client: WebClient, userId: string): Promise<string | null> {
  try {
    let cursor: string | undefined;
    do {
      const res = await client.conversations.list({
        types: "im",
        limit: 200,
        cursor,
        exclude_archived: true,
      });
      for (const ch of res.channels || []) {
        if (ch.user === userId && ch.id) return ch.id;
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (e) {
    logger.warn({ err: e, userId }, "conversations.list(im) failed — need im:read scope?");
  }
  return null;
}

/**
 * Reliable DM / channel post for bots:
 * 1) Channel ID (C/G) → post directly
 * 2) User ID (U) → conversations.open → post to DM channel (D…)
 * Fallbacks if App Home Messages tab / open fails.
 */
export async function postSlackMessage(
  client: WebClient,
  recipient: string,
  input: { text: string; blocks?: (KnownBlock | Block)[] }
) {
  const target = resolveSlackMessageTarget(recipient);
  if (!target) throw new Error("Invalid Slack recipient");

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

  // Public / private channels — post directly
  if (/^[CG]/i.test(target)) {
    return send(target);
  }

  // Already a DM channel id
  if (/^D/i.test(target)) {
    return send(target);
  }

  // User ID — open (or reuse) a DM conversation, then post
  if (isSlackUserId(target)) {
    const errors: string[] = [];

    try {
      const opened = await client.conversations.open({ users: target });
      const dmId = opened.channel?.id;
      if (dmId) {
        return await send(dmId);
      }
      errors.push("conversations.open returned no channel");
    } catch (openErr) {
      const code = slackErrorCode(openErr) || "open_failed";
      errors.push(`conversations.open: ${code}`);
      logger.warn({ err: openErr, target, code }, "conversations.open failed");
    }

    try {
      const existing = await findExistingDmChannel(client, target);
      if (existing) {
        return await send(existing);
      }
    } catch (listErr) {
      errors.push(`im_list: ${slackErrorCode(listErr) || "failed"}`);
    }

    try {
      return await send(target);
    } catch (postErr) {
      const code = slackErrorCode(postErr) || "post_failed";
      errors.push(`chat.postMessage: ${code}`);
      const hint =
        code === "messages_tab_disabled" || errors.some((e) => e.includes("messages_tab_disabled"))
          ? " Enable App Home → Messages Tab in your Slack app settings, reinstall the app, then have the user open the Leave Tracker app once."
          : code === "missing_scope"
            ? " Add bot scopes chat:write, im:write, im:read and reinstall the app."
            : "";
      throw new Error(`Cannot DM ${target} (${errors.join("; ")}).${hint}`);
    }
  }

  return send(target);
}

/** @deprecated Use postSlackMessage */
export async function openDmChannel(_client: WebClient, slackUserId: string) {
  return normalizeSlackId(slackUserId) || slackUserId.trim();
}

export const SLACK_ACTIONS = {
  APPLY_LEAVE: "apply_leave",
  REQUEST_COMP_OFF: "request_comp_off",
  MY_BALANCE: "my_balance",
  MY_HISTORY: "my_history",
  UPCOMING_HOLIDAYS: "upcoming_holidays",
  APPROVE_LEAVE: "approve_leave",
  REJECT_LEAVE: "reject_leave",
  REJECT_LEAVE_SUBMIT: "reject_leave_submit",
  APPROVE_COMP_OFF: "approve_comp_off",
  REJECT_COMP_OFF: "reject_comp_off",
} as const;

export const SLACK_CALLBACKS = {
  APPLY_LEAVE_MODAL: "apply_leave_modal",
  COMP_OFF_CREDIT_MODAL: "comp_off_credit_modal",
  REJECT_LEAVE_MODAL: "reject_leave_modal",
  REJECT_COMP_OFF_MODAL: "reject_comp_off_modal",
  LEAVE_HOME: "leave_home",
} as const;
