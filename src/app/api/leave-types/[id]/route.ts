import { NextRequest, NextResponse } from "next/server";
import { Role, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const body = schema.parse(await req.json());
  const type = await prisma.leaveType.update({
    where: { id },
    data: body,
    include: { policy: true },
  });
  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.LEAVE_TYPE_UPDATED,
    objectType: "LeaveType",
    objectId: id,
    newValue: body,
  });
  return NextResponse.json(type);
}
