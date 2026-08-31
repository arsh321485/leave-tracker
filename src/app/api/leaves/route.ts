import { NextRequest, NextResponse } from "next/server";
import { Role, LeaveDuration, LeaveRequestStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { canViewAllLeaves, isAdmin } from "@/lib/rbac";
import {
  createLeaveRequest,
  LeaveValidationError,
} from "@/lib/leave/service";
import { notifyManagerOfLeave } from "@/lib/slack/handlers";
import { logger } from "@/lib/logger";

const createSchema = z.object({
  employeeId: z.string().optional(),
  leaveTypeId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  duration: z.enum(["FULL_DAY", "HALF_DAY"]).default("FULL_DAY"),
  reason: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") as LeaveRequestStatus | null;
  const employeeId = sp.get("employeeId");
  const departmentId = sp.get("departmentId");
  const leaveTypeId = sp.get("leaveTypeId");
  const from = sp.get("from");
  const to = sp.get("to");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (leaveTypeId) where.leaveTypeId = leaveTypeId;
  if (from || to) {
    where.startDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  if (canViewAllLeaves(user.role)) {
    if (employeeId) where.employeeId = employeeId;
    if (departmentId) where.employee = { departmentId };
  } else if (user.role === Role.MANAGER && user.employeeId) {
    where.employee = { managerId: user.employeeId };
  } else if (user.employeeId) {
    where.employeeId = user.employeeId;
  } else {
    return jsonError("No employee profile linked", 403);
  }

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      employee: { include: { department: true, manager: true } },
      leaveType: true,
      approvedBy: true,
      rejectedBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
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
    const request = await createLeaveRequest({
      employeeId,
      leaveTypeId: body.leaveTypeId,
      startDate: body.startDate,
      endDate: body.endDate,
      duration: body.duration as LeaveDuration,
      reason: body.reason,
      actorId: user.id,
      actorLabel: user.name,
    });
    try {
      await notifyManagerOfLeave(request.id);
    } catch (e) {
      logger.warn({ err: e }, "Failed to notify manager via Slack");
    }
    return NextResponse.json(request, { status: 201 });
  } catch (e) {
    if (e instanceof LeaveValidationError) return jsonError(e.message);
    throw e;
  }
}
