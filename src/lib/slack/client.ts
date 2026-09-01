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
  return undefined;
}

/** Find an existing bot↔user DM channel (created when user ran /leave). */
async function findExistingDmChannel(client: WebClient, userId: string): Promise<string | null> {
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
  return null;
}

/** Post to a user DM (U…) or channel (C…). Retries via existing IM channel when direct post fails. */
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

  try {
    return await send(target);
  } catch (first) {
    const code = slackErrorCode(first);

    if (isSlackUserId(target)) {
      const dmChannel = await findExistingDmChannel(client, target);
      if (dmChannel) {
        logger.info({ userId: target, dmChannel }, "Retrying Slack message via existing DM channel");
        return await send(dmChannel);
      }

      if (code === "channel_not_found") {
        try {
          const opened = await client.conversations.open({ users: target });
          const ch = opened.channel?.id;
          if (ch) return await send(ch);
        } catch (openErr) {
          logger.warn({ err: openErr, target }, "conversations.open failed");
        }
      }
    }

    throw first;
  }
}

/** @deprecated Use postSlackMessage */
export async function openDmChannel(_client: WebClient, slackUserId: string) {
  return normalizeSlackId(slackUserId) || slackUserId.trim();
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
