import { NextRequest, NextResponse } from "next/server";
import { Role, EmployeeStatus, AuditAction, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { MENSTRUATION_LEAVE_CODE } from "@/lib/leave/constants";
import { normalizeSlackId } from "@/lib/slack/ids";

type Ctx = { params: Promise<{ id: string }> };

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

const updateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  email: z.string().email("Enter a valid email").optional(),
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return jsonError(msg || "Invalid form data");
  }

  const body = parsed.data;
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  const departmentId = body.departmentId !== undefined ? emptyToNull(body.departmentId) : undefined;
  const managerId = body.managerId !== undefined ? emptyToNull(body.managerId) : undefined;
  const slackUserId = body.slackUserId !== undefined ? normalizeSlackId(body.slackUserId) : undefined;
  const designation = body.designation !== undefined ? emptyToNull(body.designation) : undefined;

  if (departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) return jsonError("Selected department does not exist");
  }
  if (managerId) {
    const manager = await prisma.employee.findUnique({ where: { id: managerId } });
    if (!manager) return jsonError("Selected manager does not exist");
  }
  if (managerId === id) {
    return jsonError("Employee cannot be their own manager");
  }

  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.email !== undefined ? { email: body.email.toLowerCase() } : {}),
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(designation !== undefined ? { designation } : {}),
        ...(managerId !== undefined ? { managerId } : {}),
        ...(slackUserId !== undefined ? { slackUserId } : {}),
        ...(body.slackName !== undefined ? { slackName: emptyToNull(body.slackName) } : {}),
        ...(body.joiningDate !== undefined
          ? {
              joiningDate: body.joiningDate ? new Date(body.joiningDate) : null,
            }
          : {}),
        ...(body.status !== undefined ? { status: body.status as EmployeeStatus } : {}),
      },
      include: { department: true, manager: true },
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

    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.name,
      action: AuditAction.EMPLOYEE_UPDATED,
      objectType: "Employee",
      objectId: id,
      oldValue: { name: existing.name, managerId: existing.managerId },
      newValue: { name: employee.name, managerId: employee.managerId },
    });

    const refreshed = await prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        manager: true,
        leaveEligibility: { include: { leaveType: true } },
      },
    });

    return NextResponse.json({
      ...refreshed,
      menstruationLeaveEligible: refreshed?.leaveEligibility.some(
        (x) => x.leaveType.code === MENSTRUATION_LEAVE_CODE
      ),
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("Update failed: email or Slack User ID already used by another employee");
    }
    console.error("Update employee failed", e);
    return jsonError(
      e instanceof Error ? `Update failed: ${e.message}` : "Update failed",
      500
    );
  }
}

/** Hard-delete employee and related leave data from the database. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  try {
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
  } catch (e) {
    console.error("Delete employee failed", e);
    return jsonError(
      e instanceof Error ? `Delete failed: ${e.message}` : "Delete failed",
      500
    );
  }
}
