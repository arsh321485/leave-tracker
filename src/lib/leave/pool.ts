import { prisma } from "@/lib/prisma";
import { remainingBalance } from "@/lib/utils";
import {
  POOLED_LEAVE_CODES,
  isPooledLeaveCode,
  PAID_POOL_SELECT_VALUE,
} from "@/lib/leave/constants";

export type BalanceSplitPart = { leaveTypeId: string; code: string; name: string; days: number };

/**
 * Allocate `days` across Comp Off → Casual → Annual (skip zero remaining).
 * Prefer `preferredCode` first when provided.
 */
export async function allocatePooledLeaveDays(input: {
  employeeId: string;
  days: number;
  year: number;
  preferredCode?: string | null;
}): Promise<{ split: BalanceSplitPart[]; poolRemaining: number; types: { id: string; code: string; name: string }[] }> {
  const types = await prisma.leaveType.findMany({
    where: { code: { in: [...POOLED_LEAVE_CODES] }, isActive: true },
  });
  const byCode = new Map(types.map((t) => [t.code, t]));

  const order = [...POOLED_LEAVE_CODES];
  if (input.preferredCode && isPooledLeaveCode(input.preferredCode)) {
    order.splice(order.indexOf(input.preferredCode as (typeof POOLED_LEAVE_CODES)[number]), 1);
    order.unshift(input.preferredCode as (typeof POOLED_LEAVE_CODES)[number]);
  }

  const balances = await prisma.leaveBalance.findMany({
    where: {
      employeeId: input.employeeId,
      year: input.year,
      leaveTypeId: { in: types.map((t) => t.id) },
    },
  });
  const balByType = new Map(balances.map((b) => [b.leaveTypeId, b]));

  let poolRemaining = 0;
  const remainingByType = new Map<string, number>();
  for (const code of POOLED_LEAVE_CODES) {
    const t = byCode.get(code);
    if (!t) continue;
    const bal = balByType.get(t.id);
    const rem = bal ? remainingBalance(bal) : 0;
    remainingByType.set(t.id, Math.max(0, rem));
    poolRemaining += Math.max(0, rem);
  }

  let left = input.days;
  const split: BalanceSplitPart[] = [];
  for (const code of order) {
    if (left <= 0) break;
    const t = byCode.get(code);
    if (!t) continue;
    const rem = remainingByType.get(t.id) ?? 0;
    if (rem <= 0) continue;
    const take = Math.min(rem, left);
    split.push({ leaveTypeId: t.id, code: t.code, name: t.name, days: take });
    left = Math.round((left - take) * 100) / 100;
  }

  return { split, poolRemaining, types };
}

export function formatPaidLeaveLabel(split: BalanceSplitPart[]) {
  if (!split.length) return "Paid Leave";
  const parts = split.map((s) => `${s.days} ${s.name}`);
  return `Paid Leave (${parts.join(" + ")})`;
}

export function parseBalanceSplit(raw: unknown): BalanceSplitPart[] | null {
  if (!raw || !Array.isArray(raw)) return null;
  const out: BalanceSplitPart[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.leaveTypeId !== "string" || typeof row.days !== "number") continue;
    out.push({
      leaveTypeId: row.leaveTypeId,
      code: typeof row.code === "string" ? row.code : "",
      name: typeof row.name === "string" ? row.name : "",
      days: row.days,
    });
  }
  return out.length ? out : null;
}

export function resolveLeaveTypeSelection(leaveTypeIdOrPool: string) {
  return {
    isPaidPool: leaveTypeIdOrPool === PAID_POOL_SELECT_VALUE,
    leaveTypeId: leaveTypeIdOrPool === PAID_POOL_SELECT_VALUE ? null : leaveTypeIdOrPool,
  };
}
