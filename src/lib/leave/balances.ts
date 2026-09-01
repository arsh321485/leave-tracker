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

async function monthlyBalanceRow(
  employeeId: string,
  leaveType: { id: string; name: string; code: string },
  quota: number,
  refDate = new Date()
): Promise<BalanceRow> {
  const monthStart = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + 1, 0));

  const requests = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId: leaveType.id,
      status: { in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.PENDING] },
      startDate: { gte: monthStart, lte: monthEnd },
    },
  });

  const used = requests
    .filter((r) => r.status === LeaveRequestStatus.APPROVED)
    .reduce((s, r) => s + r.days, 0);
  const pending = requests
    .filter((r) => r.status === LeaveRequestStatus.PENDING)
    .reduce((s, r) => s + r.days, 0);

  return {
    leaveType,
    allocated: quota,
    used,
    pending,
    remaining: Math.max(0, quota - used - pending),
    monthly: true,
  };
}

/** All active leave types with balances (zeros where unused). */
export async function getEmployeeBalancesForDisplay(
  employeeId: string,
  year = new Date().getFullYear()
): Promise<BalanceRow[]> {
  await ensureEmployeeBalances(employeeId, year);

  const types = await prisma.leaveType.findMany({
    where: activeLeaveTypeWhere(),
    include: { policy: true },
    orderBy: { name: "asc" },
  });

  const eligibilities = await prisma.employeeLeaveEligibility.findMany({
    where: { employeeId },
    select: { leaveTypeId: true },
  });
  const eligibleIds = new Set(eligibilities.map((e) => e.leaveTypeId));

  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId, year },
    include: { leaveType: true },
  });
  const byTypeId = new Map(balances.map((b) => [b.leaveTypeId, b]));

  const rows: BalanceRow[] = [];
  for (const t of types) {
    const requiresEligibility = t.policy?.requiresEligibility ?? false;
    if (requiresEligibility && !eligibleIds.has(t.id)) continue;

    if (t.policy?.monthlyQuota != null) {
      rows.push(await monthlyBalanceRow(employeeId, t, t.policy.monthlyQuota));
      continue;
    }

    const b = byTypeId.get(t.id);
    rows.push({
      leaveType: { id: t.id, name: t.name, code: t.code },
      allocated: b?.allocated ?? t.policy?.annualAllocation ?? 0,
      used: b?.used ?? 0,
      pending: b?.pending ?? 0,
      remaining: b ? remainingBalance(b) : (t.policy?.annualAllocation ?? 0),
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
  return types.filter(
    (t) => !t.policy?.requiresEligibility || eligibleIds.has(t.id)
  );
}
