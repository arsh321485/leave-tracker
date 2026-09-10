import { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { remainingBalance } from "@/lib/utils";
import { activeLeaveTypeWhere } from "@/lib/leave/constants";

export type BalanceRow = {
  leaveType: { id: string; name: string; code: string };
  allocated: number;
  used: number;
  pending: number;
  remaining: number;
  monthly: boolean;
};

export async function ensureEmployeeBalances(employeeId: string, year = new Date().getFullYear()) {
  const types = await prisma.leaveType.findMany({
    where: activeLeaveTypeWhere(),
    include: { policy: true },
  });

  const existing = await prisma.leaveBalance.findMany({
    where: { employeeId, year },
    select: { leaveTypeId: true },
  });
  const existingIds = new Set(existing.map((b) => b.leaveTypeId));

  const toCreate = types
    .filter((t) => t.policy?.monthlyQuota == null && !existingIds.has(t.id))
    .map((t) => ({
      employeeId,
      leaveTypeId: t.id,
      year,
      allocated: t.policy?.annualAllocation ?? 0,
      used: 0,
      pending: 0,
      carryForward: 0,
    }));

  if (toCreate.length) {
    await prisma.leaveBalance.createMany({ data: toCreate, skipDuplicates: true });
  }
}

/**
 * Fast read-only balance for Slack (no balance auto-create — that caused 3s timeouts).
 * Missing rows show policy allocation with 0 used.
 */
export async function getEmployeeBalancesForDisplay(
  employeeId: string,
  year = new Date().getFullYear()
): Promise<BalanceRow[]> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  const [types, eligibilities, balances, monthRequests] = await Promise.all([
    prisma.leaveType.findMany({
      where: activeLeaveTypeWhere(),
      include: { policy: true },
      orderBy: { name: "asc" },
    }),
    prisma.employeeLeaveEligibility.findMany({
      where: { employeeId },
      select: { leaveTypeId: true },
    }),
    prisma.leaveBalance.findMany({
      where: { employeeId, year },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: { in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.PENDING] },
        startDate: { gte: monthStart, lte: monthEnd },
      },
      select: { leaveTypeId: true, status: true, days: true },
    }),
  ]);

  const eligibleIds = new Set(eligibilities.map((e) => e.leaveTypeId));
  const byTypeId = new Map(balances.map((b) => [b.leaveTypeId, b]));

  const rows: BalanceRow[] = [];
  for (const t of types) {
    const requiresEligibility = t.policy?.requiresEligibility ?? false;
    if (requiresEligibility && !eligibleIds.has(t.id)) continue;

    if (t.policy?.monthlyQuota != null) {
      const quota = t.policy.monthlyQuota;
      const forType = monthRequests.filter((r) => r.leaveTypeId === t.id);
      const used = forType
        .filter((r) => r.status === LeaveRequestStatus.APPROVED)
        .reduce((s, r) => s + r.days, 0);
      const pending = forType
        .filter((r) => r.status === LeaveRequestStatus.PENDING)
        .reduce((s, r) => s + r.days, 0);
      rows.push({
        leaveType: { id: t.id, name: t.name, code: t.code },
        allocated: quota,
        used,
        pending,
        remaining: Math.max(0, quota - used - pending),
        monthly: true,
      });
      continue;
    }

    const b = byTypeId.get(t.id);
    const allocated = b?.allocated ?? t.policy?.annualAllocation ?? 0;
    rows.push({
      leaveType: { id: t.id, name: t.name, code: t.code },
      allocated,
      used: b?.used ?? 0,
      pending: b?.pending ?? 0,
      remaining: b ? remainingBalance(b) : allocated,
      monthly: false,
    });
  }

  return rows;
}

export async function getEligibleLeaveTypesForEmployee(employeeId: string) {
  const [types, eligibilities] = await Promise.all([
    prisma.leaveType.findMany({
      where: activeLeaveTypeWhere(),
      include: { policy: true },
      orderBy: { name: "asc" },
    }),
    prisma.employeeLeaveEligibility.findMany({
      where: { employeeId },
      select: { leaveTypeId: true },
    }),
  ]);

  const eligibleIds = new Set(eligibilities.map((e) => e.leaveTypeId));
  return types.filter((t) => !t.policy?.requiresEligibility || eligibleIds.has(t.id));
}
