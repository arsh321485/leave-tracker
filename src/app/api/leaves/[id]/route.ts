import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { canViewAllLeaves } from "@/lib/rbac";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession();
  if (error) return error;
  const { id } = await ctx.params;

  const request = await prisma.leaveRequest.findUnique({
    where: { id },
    include: {
      employee: { include: { department: true, manager: true } },
      leaveType: true,
      approvedBy: true,
      rejectedBy: true,
    },
  });
  if (!request) return jsonError("Not found", 404);

  if (!canViewAllLeaves(user.role)) {
    if (user.role === Role.MANAGER && user.employeeId) {
      if (request.employee.managerId !== user.employeeId) {
        return jsonError("Forbidden", 403);
      }
    } else if (request.employeeId !== user.employeeId) {
      return jsonError("Forbidden", 403);
    }
  }

  return NextResponse.json(request);
}
