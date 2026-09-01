import { NextRequest, NextResponse } from "next/server";
import { Role, AuditAction, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { ensureEmployeeBalances } from "@/lib/leave/balances";
import { logger } from "@/lib/logger";
import { normalizeSlackId } from "@/lib/slack/ids";

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  departmentId: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  slackUserId: z.string().optional().nullable(),
  joiningDate: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional().default("ACTIVE"),
});

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function GET(req: NextRequest) {
  const { error } = await requireSession();
  if (error) return error;

  const status = req.nextUrl.searchParams.get("status") as
    | "ACTIVE"
    | "INACTIVE"
    | null;
  const employees = await prisma.employee.findMany({
    where: status ? { status } : undefined,
    include: {
      department: true,
      manager: true,
      leaveEligibility: { include: { leaveType: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    employees.map((e) => ({
      ...e,
      menstruationLeaveEligible: e.leaveEligibility.some(
        (x) => x.leaveType.code === "MENSTRUATION"
      ),
    }))
  );
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return jsonError(msg || "Invalid form data");
  }

  const body = parsed.data;
  const email = body.email.trim().toLowerCase();
  const slackUserId = normalizeSlackId(body.slackUserId ?? null);
  const departmentId = emptyToNull(body.departmentId);
  const managerId = emptyToNull(body.managerId);
  const designation = emptyToNull(body.designation);
  const joiningRaw = emptyToNull(body.joiningDate);

  let joiningDate: Date | null = null;
  if (joiningRaw) {
    joiningDate = new Date(joiningRaw);
    if (Number.isNaN(joiningDate.getTime())) {
      return jsonError("Joining date is invalid. Use YYYY-MM-DD.");
    }
  }

  if (departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) return jsonError("Selected department does not exist. Pick Department again.");
  }

  if (managerId) {
    const manager = await prisma.employee.findUnique({ where: { id: managerId } });
    if (!manager) {
      return jsonError("Selected manager does not exist. Leave Manager as None or pick again.");
    }
  }

  const conflict = await prisma.employee.findFirst({
    where: {
      OR: [{ email }, ...(slackUserId ? [{ slackUserId }] : [])],
    },
  });
  if (conflict) {
    const reason =
      conflict.email === email
        ? `email "${email}" is already used by "${conflict.name}"`
        : `Slack User ID is already used by "${conflict.name}"`;
    return jsonError(
      `Could not create employee: ${reason}. Find them in the directory and click Edit.`
    );
  }

  try {
    const employee = await prisma.employee.create({
      data: {
        name: body.name.trim(),
        email,
        departmentId,
        designation,
        managerId,
        slackUserId,
        joiningDate,
        status: body.status ?? "ACTIVE",
      },
      include: { department: true, manager: true },
    });
    await ensureEmployeeBalances(employee.id);
    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.name,
      action: AuditAction.EMPLOYEE_UPDATED,
      objectType: "Employee",
      objectId: employee.id,
      newValue: { name: employee.name, email: employee.email },
    });
    return NextResponse.json(employee, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return jsonError(
          "Could not create employee: email or Slack User ID already exists. Use Edit on the existing person."
        );
      }
      if (e.code === "P2003") {
        return jsonError(
          "Could not create employee: invalid Department or Manager reference. Re-select them."
        );
      }
      return jsonError(`Could not create employee (database ${e.code})`);
    }
    logger.error({ err: e }, "Create employee failed");
    return jsonError(
      e instanceof Error ? `Could not create employee: ${e.message}` : "Could not create employee",
      500
    );
  }
}
