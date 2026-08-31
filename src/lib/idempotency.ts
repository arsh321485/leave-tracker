import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  const existing = await prisma.slackIdempotency.findUnique({ where: { key } });
  if (existing?.response != null) {
    return { result: existing.response as T, replayed: true };
  }

  try {
    await prisma.slackIdempotency.create({ data: { key } });
  } catch {
    const again = await prisma.slackIdempotency.findUnique({ where: { key } });
    if (again?.response != null) {
      return { result: again.response as T, replayed: true };
    }
    // Another in-flight request claimed the key; wait briefly not needed for MVP — return no-op marker
    return { result: { ok: true, duplicate: true } as T, replayed: true };
  }

  const result = await fn();
  await prisma.slackIdempotency.update({
    where: { key },
    data: { response: result as object },
  });
  return { result, replayed: false };
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
