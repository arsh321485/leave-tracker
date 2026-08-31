import { describe, expect, it } from "vitest";
import { calculateWorkingDays } from "@/lib/leave/working-days";
import { LeaveDuration } from "@prisma/client";
import { verifySlackSignature } from "@/lib/slack/client";
import crypto from "crypto";
import { remainingBalance } from "@/lib/utils";
import { hashPayload } from "@/lib/idempotency";

describe("calculateWorkingDays", () => {
  it("counts Mon-Fri as 5 working days", () => {
    // 2026-08-24 is Monday, 2026-08-28 is Friday
    const days = calculateWorkingDays("2026-08-24", "2026-08-28", {
      weekendsNonWorking: true,
      holidayDates: new Set(),
    });
    expect(days).toBe(5);
  });

  it("excludes Saturday and Sunday", () => {
    const days = calculateWorkingDays("2026-08-22", "2026-08-23", {
      weekendsNonWorking: true,
      holidayDates: new Set(),
    });
    expect(days).toBe(0);
  });

  it("excludes holidays", () => {
    const days = calculateWorkingDays("2026-08-24", "2026-08-26", {
      weekendsNonWorking: true,
      holidayDates: new Set(["2026-08-25"]),
    });
    expect(days).toBe(2);
  });

  it("treats half day as 0.5", () => {
    const days = calculateWorkingDays("2026-08-24", "2026-08-24", {
      weekendsNonWorking: true,
      holidayDates: new Set(),
      duration: LeaveDuration.HALF_DAY,
    });
    expect(days).toBe(0.5);
  });

  it("returns 0 for half day on weekend", () => {
    const days = calculateWorkingDays("2026-08-22", "2026-08-22", {
      weekendsNonWorking: true,
      holidayDates: new Set(),
      duration: LeaveDuration.HALF_DAY,
    });
    expect(days).toBe(0);
  });
});

describe("remainingBalance", () => {
  it("uses allocated + carry - used - pending", () => {
    expect(
      remainingBalance({ allocated: 12, carryForward: 2, used: 4, pending: 2 })
    ).toBe(8);
  });
});

describe("Slack signature validation", () => {
  it("accepts valid signatures", () => {
    const secret = "test_secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"url_verification"}';
    const base = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", secret).update(base).digest("hex");
    const signature = `v0=${hmac}`;
    expect(verifySlackSignature(secret, signature, timestamp, body)).toBe(true);
  });

  it("rejects invalid signatures", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature("secret", "v0=bad", timestamp, "{}")
    ).toBe(false);
  });

  it("rejects stale timestamps", () => {
    const secret = "test_secret";
    const timestamp = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const body = "{}";
    const base = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", secret).update(base).digest("hex");
    expect(verifySlackSignature(secret, `v0=${hmac}`, timestamp, body)).toBe(false);
  });
});

describe("idempotency helpers", () => {
  it("hashes payloads stably", () => {
    expect(hashPayload(["a", "b"])).toBe(hashPayload(["a", "b"]));
    expect(hashPayload(["a", "b"])).not.toBe(hashPayload(["a", "c"]));
  });
});
