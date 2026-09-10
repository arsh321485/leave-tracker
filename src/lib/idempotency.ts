import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs fn once per key. Concurrent callers wait for the first result.
 * Never silently skips work (that caused Slack leave applies to vanish).
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
    // Another request holds the key — wait for its response
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const again = await prisma.slackIdempotency.findUnique({ where: { key } });
      if (again?.response != null) {
        return { result: again.response as T, replayed: true };
      }
    }
    // Timed out waiting — run ourselves to avoid losing the leave request
    claimed = false;
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
    // Allow retry on failure — remove empty claim so next attempt can run
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
