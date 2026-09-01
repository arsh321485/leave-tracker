import { NextRequest, NextResponse } from "next/server";
import { Role, EmployeeStatus, AuditAction, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { MENSTRUATION_LEAVE_CODE } from "@/lib/leave/constants";

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  departmentId: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  slackUserId: z.string().nullable().optional(),
  slackName: z.string().nullable().optional(),
  joiningDate: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  menstruationLeaveEligible: z.boolean().optional(),
});

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { error } = await requireSession();
  if (error) return error;
  const { id } = await ctx.params;
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      department: true,
      manager: true,
      leaveEligibility: { include: { leaveType: true } },
    },
  });
  if (!employee) return jsonError("Not found", 404);
  return NextResponse.json(employee);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const body = updateSchema.parse(await req.json());
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...("name" in body ? { name: body.name } : {}),
        ...("email" in body ? { email: body.email?.toLowerCase() } : {}),
        ...("departmentId" in body ? { departmentId: body.departmentId } : {}),
        ...("designation" in body ? { designation: body.designation } : {}),
        ...("managerId" in body ? { managerId: body.managerId } : {}),
        ...("slackUserId" in body ? { slackUserId: body.slackUserId } : {}),
        ...("slackName" in body ? { slackName: body.slackName } : {}),
        ...("joiningDate" in body
          ? { joiningDate: body.joiningDate ? new Date(body.joiningDate) : null }
          : {}),
        ...("status" in body ? { status: body.status as EmployeeStatus } : {}),
      },
      include: { department: true, manager: true },
    });
    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.name,
      action: AuditAction.EMPLOYEE_UPDATED,
      objectType: "Employee",
      objectId: id,
      oldValue: { name: existing.name, managerId: existing.managerId },
      newValue: { name: employee.name, managerId: employee.managerId },
    });

    if (typeof body.menstruationLeaveEligible === "boolean") {
      const mType = await prisma.leaveType.findUnique({
        where: { code: MENSTRUATION_LEAVE_CODE },
      });
      if (mType) {
        if (body.menstruationLeaveEligible) {
          await prisma.employeeLeaveEligibility.upsert({
            where: {
              employeeId_leaveTypeId: { employeeId: id, leaveTypeId: mType.id },
            },
            update: {},
            create: { employeeId: id, leaveTypeId: mType.id },
          });
        } else {
          await prisma.employeeLeaveEligibility.deleteMany({
            where: { employeeId: id, leaveTypeId: mType.id },
          });
        }
      }
    }

    const refreshed = await prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        manager: true,
        leaveEligibility: { include: { leaveType: true } },
      },
    });
    return NextResponse.json(refreshed);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("Update failed: email or Slack User ID already used by another employee");
    }
    return jsonError("Update failed");
  }
}

/** Hard-delete employee and related leave data from the database. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { employeeId: id },
      data: { employeeId: null },
    });
    await tx.optionalHolidaySelection.deleteMany({ where: { employeeId: id } });
    await tx.employeeLeaveEligibility.deleteMany({ where: { employeeId: id } });
    await tx.leaveBalance.deleteMany({ where: { employeeId: id } });
    await tx.leaveRequest.updateMany({
      where: { approvedById: id },
      data: { approvedById: null },
    });
    await tx.leaveRequest.updateMany({
      where: { rejectedById: id },
      data: { rejectedById: null },
    });
    await tx.leaveRequest.deleteMany({ where: { employeeId: id } });
    await tx.holiday.updateMany({
      where: { createdById: id },
      data: { createdById: null },
    });
    await tx.employee.updateMany({
      where: { managerId: id },
      data: { managerId: null },
    });
    await tx.employee.delete({ where: { id } });
  });

  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.EMPLOYEE_UPDATED,
    objectType: "Employee",
    objectId: id,
    oldValue: { name: existing.name, email: existing.email },
    newValue: { deleted: true },
    metadata: { hardDeleted: true },
  });

  return NextResponse.json({ ok: true, deletedId: id });
}
