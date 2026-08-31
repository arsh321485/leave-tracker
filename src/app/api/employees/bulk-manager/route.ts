import { NextRequest, NextResponse } from "next/server";
import { Role, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  employeeIds: z.array(z.string()).min(1),
  managerId: z.string().nullable(),
});

/**
 * Assign the same manager to many employees at once.
 * Example: Arsh (HR/manager) → select 7 team members → set manager = Arsh.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const body = schema.parse(await req.json());

  if (body.managerId) {
    const manager = await prisma.employee.findUnique({ where: { id: body.managerId } });
    if (!manager) return jsonError("Manager not found", 404);
    if (body.employeeIds.includes(body.managerId)) {
      return jsonError("An employee cannot be their own manager");
    }
  }

  const result = await prisma.employee.updateMany({
    where: { id: { in: body.employeeIds } },
    data: { managerId: body.managerId },
  });

  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.EMPLOYEE_UPDATED,
    objectType: "Employee",
    objectId: null,
    newValue: {
      managerId: body.managerId,
      employeeIds: body.employeeIds,
      updatedCount: result.count,
    },
    metadata: { bulkManagerAssign: true },
  });

  const employees = await prisma.employee.findMany({
    where: { id: { in: body.employeeIds } },
    include: { department: true, manager: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ count: result.count, employees });
}
