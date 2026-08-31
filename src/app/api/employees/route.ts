import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { AuditAction } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  departmentId: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  slackUserId: z.string().optional().nullable(),
  joiningDate: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function GET(req: NextRequest) {
  const { error } = await requireSession();
  if (error) return error;

  const status = req.nextUrl.searchParams.get("status") as
    | "ACTIVE"
    | "INACTIVE"
    | null;
  const employees = await prisma.employee.findMany({
    where: status ? { status } : undefined,
    include: { department: true, manager: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(employees);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const body = createSchema.parse(await req.json());
  const email = body.email.toLowerCase();
  const slackUserId = body.slackUserId || null;

  const conflict = await prisma.employee.findFirst({
    where: {
      OR: [
        { email },
        ...(slackUserId ? [{ slackUserId }] : []),
      ],
    },
  });
  if (conflict) {
    const reason =
      conflict.email === email
        ? `email ${email} already used by "${conflict.name}"`
        : `Slack User ID already used by "${conflict.name}"`;
    return jsonError(
      `Could not create employee: ${reason}. Open that employee and click Edit instead of Create.`
    );
  }

  try {
    const employee = await prisma.employee.create({
      data: {
        name: body.name,
        email,
        departmentId: body.departmentId || null,
        designation: body.designation || null,
        managerId: body.managerId || null,
        slackUserId,
        joiningDate: body.joiningDate ? new Date(body.joiningDate) : null,
        status: body.status,
      },
      include: { department: true, manager: true },
    });
    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.name,
      action: AuditAction.EMPLOYEE_UPDATED,
      objectType: "Employee",
      objectId: employee.id,
      newValue: { name: employee.name, email: employee.email },
    });
    return NextResponse.json(employee, { status: 201 });
  } catch {
    return jsonError("Could not create employee");
  }
}
