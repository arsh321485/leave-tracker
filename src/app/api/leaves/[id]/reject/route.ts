import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { isAdmin } from "@/lib/rbac";
import { rejectLeaveRequest, LeaveValidationError } from "@/lib/leave/service";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ reason: z.string().min(1) });

export async function POST(req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([
    Role.SUPER_ADMIN,
    Role.HR_ADMIN,
    Role.MANAGER,
  ]);
  if (error) return error;
  const { id } = await ctx.params;
  const body = schema.parse(await req.json());

  if (!user.employeeId && !isAdmin(user.role)) {
    return jsonError("No employee profile linked", 403);
  }

  try {
    const result = await rejectLeaveRequest({
      requestId: id,
      rejectorEmployeeId: user.employeeId,
      reason: body.reason,
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
