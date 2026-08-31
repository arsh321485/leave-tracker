import { NextRequest, NextResponse } from "next/server";
import { Role, EmployeeStatus, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

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
});

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { error } = await requireSession();
  if (error) return error;
  const { id } = await ctx.params;
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { department: true, manager: true },
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
    return NextResponse.json(employee);
  } catch {
    return jsonError("Update failed (email or Slack ID conflict)");
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  // Soft-delete: keep history (leave requests/balances) but mark inactive
  const employee = await prisma.employee.update({
    where: { id },
    data: { status: EmployeeStatus.INACTIVE, slackUserId: null, slackName: null },
    include: { department: true, manager: true },
  });

  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.EMPLOYEE_UPDATED,
    objectType: "Employee",
    objectId: id,
    oldValue: { status: existing.status, slackUserId: existing.slackUserId },
    newValue: { status: "INACTIVE", slackUserId: null },
    metadata: { softDeleted: true },
  });

  return NextResponse.json(employee);
}
