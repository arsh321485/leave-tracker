import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { isAdmin } from "@/lib/rbac";
import { cancelLeaveRequest, LeaveValidationError } from "@/lib/leave/service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession();
  if (error) return error;
  const { id } = await ctx.params;

  try {
    const result = await cancelLeaveRequest({
      requestId: id,
      actorEmployeeId: user.employeeId,
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
