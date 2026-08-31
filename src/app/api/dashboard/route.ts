import { NextResponse } from "next/server";
import { LeaveRequestStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";
import { canViewAllLeaves } from "@/lib/rbac";

export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const teamFilter =
    user.role === Role.MANAGER && user.employeeId
      ? { employee: { managerId: user.employeeId } }
      : user.role === Role.EMPLOYEE && user.employeeId
        ? { employeeId: user.employeeId }
        : {};

  const [
    totalEmployees,
    pendingRequests,
    approvedThisMonth,
    rejectedThisMonth,
    approvedAll,
    balances,
    byMonth,
    byDept,
    byType,
    upcomingHolidays,
  ] = await Promise.all([
    canViewAllLeaves(user.role)
      ? prisma.employee.count({ where: { status: "ACTIVE" } })
      : user.role === Role.MANAGER && user.employeeId
        ? prisma.employee.count({ where: { managerId: user.employeeId, status: "ACTIVE" } })
        : Promise.resolve(1),
    prisma.leaveRequest.count({
      where: { status: LeaveRequestStatus.PENDING, ...teamFilter },
    }),
    prisma.leaveRequest.count({
      where: {
        status: LeaveRequestStatus.APPROVED,
        approvedAt: { gte: monthStart, lte: monthEnd },
        ...teamFilter,
      },
    }),
    prisma.leaveRequest.count({
      where: {
        status: LeaveRequestStatus.REJECTED,
        rejectedAt: { gte: monthStart, lte: monthEnd },
        ...teamFilter,
      },
    }),
    prisma.leaveRequest.aggregate({
      where: { status: LeaveRequestStatus.APPROVED, ...teamFilter },
      _sum: { days: true },
    }),
    prisma.leaveBalance.findMany({
      where: {
        year: now.getFullYear(),
        ...(user.role === Role.EMPLOYEE && user.employeeId
          ? { employeeId: user.employeeId }
          : user.role === Role.MANAGER && user.employeeId
            ? { employee: { managerId: user.employeeId } }
            : {}),
      },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.APPROVED,
        startDate: {
          gte: new Date(now.getFullYear(), 0, 1),
          lte: new Date(now.getFullYear(), 11, 31),
        },
        ...teamFilter,
      },
      select: { startDate: true, days: true },
    }),
    prisma.leaveRequest.findMany({
      where: { status: LeaveRequestStatus.APPROVED, ...teamFilter },
      include: { employee: { include: { department: true } } },
    }),
    prisma.leaveRequest.groupBy({
      by: ["leaveTypeId", "status"],
      where: teamFilter,
      _sum: { days: true },
      _count: true,
    }),
    prisma.holiday.findMany({
      where: { status: "ACTIVE", date: { gte: now } },
      orderBy: { date: "asc" },
      take: 8,
    }),
  ]);

  const totalRemaining = balances.reduce(
    (sum, b) => sum + (b.allocated + b.carryForward - b.used - b.pending),
    0
  );

  const leaveByMonth = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    days: 0,
  }));
  for (const r of byMonth) {
    leaveByMonth[r.startDate.getUTCMonth()].days += r.days;
  }

  const deptMap = new Map<string, number>();
  for (const r of byDept) {
    const name = r.employee.department?.name || "Unassigned";
    deptMap.set(name, (deptMap.get(name) || 0) + r.days);
  }

  const types = await prisma.leaveType.findMany();
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const leaveByTypeMap = new Map<string, number>();
  let approvedDays = 0;
  let rejectedDays = 0;
  for (const g of byType) {
    const name = typeName.get(g.leaveTypeId) || "Unknown";
    if (g.status === LeaveRequestStatus.APPROVED) {
      leaveByTypeMap.set(name, (leaveByTypeMap.get(name) || 0) + (g._sum.days || 0));
      approvedDays += g._count;
    }
    if (g.status === LeaveRequestStatus.REJECTED) {
      rejectedDays += g._count;
    }
  }

  return NextResponse.json({
    cards: {
      totalEmployees,
      pendingRequests,
      approvedThisMonth,
      rejectedThisMonth,
      totalLeaveTaken: approvedAll._sum.days || 0,
      totalRemainingLeave: totalRemaining,
    },
    charts: {
      leaveByMonth,
      leaveByDepartment: [...deptMap.entries()].map(([name, days]) => ({ name, days })),
      leaveByType: [...leaveByTypeMap.entries()].map(([name, days]) => ({ name, days })),
      approvedVsRejected: [
        { name: "Approved", value: approvedDays },
        { name: "Rejected", value: rejectedDays },
      ],
      upcomingHolidays,
    },
  });
}
