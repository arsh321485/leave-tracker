import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs fn once per key. Concurrent callers wait briefly for the first result.
 * Never silently skips work forever (that caused Slack leave applies to vanish).
 */
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  const existing = await prisma.slackIdempotency.findUnique({ where: { key } });
  if (existing?.response != null) {
    return { result: existing.response as T, replayed: true };
  }

  let claimed = false;
  try {
    await prisma.slackIdempotency.create({ data: { key } });
    claimed = true;
  } catch {
    // Slack often retries when cold start is slow — wait briefly for the first attempt
    for (let i = 0; i < 8; i++) {
      await sleep(200);
      const again = await prisma.slackIdempotency.findUnique({ where: { key } });
      if (again?.response != null) {
        return { result: again.response as T, replayed: true };
      }
    }

    const stale = await prisma.slackIdempotency.findUnique({ where: { key } });
    const ageMs = stale ? Date.now() - new Date(stale.createdAt).getTime() : 0;
    // If the first attempt died mid-flight, reclaim after 15s
    if (stale && ageMs > 15_000) {
      await prisma.slackIdempotency.delete({ where: { key } }).catch(() => undefined);
      try {
        await prisma.slackIdempotency.create({ data: { key } });
        claimed = true;
      } catch {
        return { result: { ok: true, inFlight: true } as T, replayed: true };
      }
    } else {
      // First attempt still running — don't create a duplicate leave
      return { result: { ok: true, inFlight: true } as T, replayed: true };
    }
  }

  try {
    const result = await fn();
    if (claimed) {
      await prisma.slackIdempotency.update({
        where: { key },
        data: { response: result as object },
      });
    } else {
      await prisma.slackIdempotency.upsert({
        where: { key },
        create: { key, response: result as object },
        update: { response: result as object },
      });
    }
    return { result, replayed: false };
  } catch (e) {
    if (claimed) {
      await prisma.slackIdempotency.delete({ where: { key } }).catch(() => undefined);
    }
    throw e;
  }
}

export function hashPayload(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
