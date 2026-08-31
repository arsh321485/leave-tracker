import { NextRequest, NextResponse } from "next/server";
import { LeaveRequestStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";
import { canViewAllLeaves, isAdmin } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const start = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = to ? new Date(to) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

  const teamFilter =
    canViewAllLeaves(user.role)
      ? {}
      : user.role === Role.MANAGER && user.employeeId
        ? { employee: { managerId: user.employeeId } }
        : user.employeeId
          ? { employeeId: user.employeeId }
          : { employeeId: "__none__" };

  const [leaves, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.APPROVED,
        startDate: { lte: end },
        endDate: { gte: start },
        ...teamFilter,
      },
      include: {
        employee: { select: { id: true, name: true, department: true } },
        leaveType: true,
      },
    }),
    prisma.holiday.findMany({
      where: { status: "ACTIVE", date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    }),
  ]);

  const showReason = isAdmin(user.role) || user.role === Role.MANAGER;

  return NextResponse.json({
    leaves: leaves.map((l) => ({
      id: l.id,
      employeeName: l.employee.name,
      leaveType: l.leaveType.name,
      startDate: l.startDate,
      endDate: l.endDate,
      days: l.days,
      reason: showReason ? l.reason : undefined,
    })),
    holidays,
  });
}
