import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";
import { canApproveAsAdmin, canViewAllLeaves, isAdmin } from "@/lib/rbac";
import { Role } from "@prisma/client";

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    const first = rateLimit(key, 3, 60_000);
    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(2);
  });

  it("blocks after limit is exceeded", () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    const third = rateLimit(key, 2, 60_000);
    expect(third.ok).toBe(false);
    expect(third.remaining).toBe(0);
  });
});

describe("rbac", () => {
  it("treats SUPER_ADMIN and HR_ADMIN as admins", () => {
    expect(isAdmin(Role.SUPER_ADMIN)).toBe(true);
    expect(isAdmin(Role.HR_ADMIN)).toBe(true);
    expect(isAdmin(Role.MANAGER)).toBe(false);
    expect(isAdmin(Role.EMPLOYEE)).toBe(false);
  });

  it("allows admins to view all leaves and approve", () => {
    expect(canViewAllLeaves(Role.HR_ADMIN)).toBe(true);
    expect(canApproveAsAdmin(Role.SUPER_ADMIN)).toBe(true);
    expect(canViewAllLeaves(Role.MANAGER)).toBe(false);
  });
});
