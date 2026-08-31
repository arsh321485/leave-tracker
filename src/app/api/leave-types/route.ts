import { NextRequest, NextResponse } from "next/server";
import { Role, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean().default(true),
});

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;
  const types = await prisma.leaveType.findMany({
    include: { policy: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const body = schema.parse(await req.json());
  try {
    const type = await prisma.leaveType.create({
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        isActive: body.isActive,
        policy: {
          create: {
            annualAllocation: 12,
            requiresManagerApproval: true,
            allowHalfDay: true,
          },
        },
      },
      include: { policy: true },
    });
    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.name,
      action: AuditAction.LEAVE_TYPE_UPDATED,
      objectType: "LeaveType",
      objectId: type.id,
      newValue: { code: type.code, name: type.name },
    });
    return NextResponse.json(type, { status: 201 });
  } catch {
    return jsonError("Leave type code already exists");
  }
}
