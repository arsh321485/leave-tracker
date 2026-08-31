import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { canViewAllLeaves } from "@/lib/rbac";
import { remainingBalance } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const year = Number(req.nextUrl.searchParams.get("year") || new Date().getFullYear());
  const employeeIdParam = req.nextUrl.searchParams.get("employeeId");

  let employeeId = employeeIdParam;
  if (!canViewAllLeaves(user.role)) {
    if (!user.employeeId) return jsonError("No employee profile", 403);
    employeeId = user.employeeId;
  }

  const balances = await prisma.leaveBalance.findMany({
    where: {
      year,
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      employee: { include: { department: true } },
      leaveType: true,
    },
    orderBy: [{ employee: { name: "asc" } }, { leaveType: { name: "asc" } }],
  });

  return NextResponse.json(
    balances.map((b) => ({
      ...b,
      remaining: remainingBalance(b),
    }))
  );
}
