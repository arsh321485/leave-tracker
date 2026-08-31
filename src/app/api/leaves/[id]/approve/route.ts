import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { isAdmin } from "@/lib/rbac";
import { approveLeaveRequest, LeaveValidationError } from "@/lib/leave/service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([
    Role.SUPER_ADMIN,
    Role.HR_ADMIN,
    Role.MANAGER,
  ]);
  if (error) return error;
  const { id } = await ctx.params;

  if (!user.employeeId && !isAdmin(user.role)) {
    return jsonError("No employee profile linked", 403);
  }

  try {
    const result = await approveLeaveRequest({
      requestId: id,
      approverEmployeeId: user.employeeId,
      actorId: user.id,
      actorLabel: user.name,
      asAdmin: isAdmin(user.role),
    });
    return NextResponse.json(result.request);
  } catch (e) {
    if (e instanceof LeaveValidationError) return jsonError(e.message);
    throw e;
  }
}
