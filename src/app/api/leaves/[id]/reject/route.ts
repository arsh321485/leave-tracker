import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { isAdmin } from "@/lib/rbac";
import { rejectLeaveRequest, LeaveValidationError } from "@/lib/leave/service";
import {
  notifyEmployeeLeaveRejected,
  finalizeManagerLeaveRequest,
} from "@/lib/slack/notifications";
import { logger } from "@/lib/logger";

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

    try {
      await finalizeManagerLeaveRequest(
        result.request.id,
        `❌ *REJECTED* by ${user.name}\n${result.request.employee.name} — ${result.request.leaveType.name}`
      );
    } catch (e) {
      logger.warn({ err: e }, "Could not update manager Slack message after reject");
    }

    try {
      const empNotify = await notifyEmployeeLeaveRejected(
        result.request.id,
        user.name,
        body.reason
      );
      if (!empNotify.ok) {
        logger.warn(
          { requestId: id, reason: empNotify.reason },
          "Could not DM employee about rejection"
        );
      }
    } catch (e) {
      logger.warn({ err: e }, "Slack notification after reject failed");
    }

    return NextResponse.json(result.request);
  } catch (e) {
    if (e instanceof LeaveValidationError) return jsonError(e.message);
    logger.error({ err: e, requestId: id }, "Reject leave failed");
    return jsonError(e instanceof Error ? e.message : "Rejection failed", 500);
  }
}
