import { NextRequest, NextResponse } from "next/server";
import { LeaveDuration, LeaveRequestStatus, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { canViewAllLeaves, isAdmin } from "@/lib/rbac";
import {
  createCompOffCredit,
  approveCompOffCredit,
  rejectCompOffCredit,
  cancelCompOffCredit,
  ensureCompOffLeaveType,
} from "@/lib/leave/comp-off";
import { LeaveValidationError } from "@/lib/leave/service";
import {
  notifyManagerOfCompOff,
  notifyEmployeeCompOffApproved,
  notifyEmployeeCompOffRejected,
} from "@/lib/slack/notifications";
import { logger } from "@/lib/logger";

const createSchema = z.object({
  employeeId: z.string().optional(),
  workDate: z.string(),
  duration: z.enum(["FULL_DAY", "HALF_DAY"]).default("FULL_DAY"),
  reason: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  await ensureCompOffLeaveType();

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") as LeaveRequestStatus | null;
  const employeeId = sp.get("employeeId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  if (canViewAllLeaves(user.role)) {
    if (employeeId) where.employeeId = employeeId;
  } else if (user.role === Role.MANAGER && user.employeeId) {
    where.employee = { managerId: user.employeeId };
  } else if (user.employeeId) {
    where.employeeId = user.employeeId;
  } else {
    return jsonError("No employee profile linked", 403);
  }

  const credits = await prisma.compOffCredit.findMany({
    where,
    include: {
      employee: { include: { department: true, manager: true } },
      approvedBy: true,
      rejectedBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(credits);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = createSchema.parse(await req.json());
  let employeeId = body.employeeId;
  if (!isAdmin(user.role)) {
    if (!user.employeeId) return jsonError("No employee profile linked", 403);
    employeeId = user.employeeId;
  }
  if (!employeeId) return jsonError("employeeId is required");

  try {
    const credit = await createCompOffCredit({
      employeeId,
      workDate: body.workDate,
      duration: body.duration as LeaveDuration,
      reason: body.reason,
      actorId: user.id,
      actorLabel: user.name,
    });

    try {
      const notified = await notifyManagerOfCompOff(credit.id);
      if (!notified.ok) {
        logger.warn({ creditId: credit.id, reason: notified.reason }, "Comp Off manager notify failed");
      }
    } catch (e) {
      logger.warn({ err: e }, "Failed to notify manager of Comp Off");
    }

    return NextResponse.json(credit, { status: 201 });
  } catch (e) {
    if (e instanceof LeaveValidationError) return jsonError(e.message);
    throw e;
  }
}
