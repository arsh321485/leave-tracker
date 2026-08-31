import { NextRequest, NextResponse } from "next/server";
import { Role, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  annualAllocation: z.number().optional(),
  carryForwardEnabled: z.boolean().optional(),
  carryForwardLimit: z.number().optional(),
  maxConsecutiveDays: z.number().int().nullable().optional(),
  requiresManagerApproval: z.boolean().optional(),
  allowHalfDay: z.boolean().optional(),
  allowDuringProbation: z.boolean().optional(),
});

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const body = schema.parse(await req.json());
  const existing = await prisma.leavePolicy.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  const policy = await prisma.leavePolicy.update({
    where: { id },
    data: body,
    include: { leaveType: true },
  });
  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.POLICY_UPDATED,
    objectType: "LeavePolicy",
    objectId: id,
    oldValue: existing as object,
    newValue: body,
  });
  return NextResponse.json(policy);
}
