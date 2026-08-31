import { NextRequest, NextResponse } from "next/server";
import { Role, HolidayType, HolidayStatus, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  date: z.string().optional(),
  type: z.enum(["PUBLIC", "COMPANY", "FESTIVAL", "OPTIONAL"]).optional(),
  isOptional: z.boolean().optional(),
  description: z.string().nullable().optional(),
  maxRequests: z.number().int().positive().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  const body = updateSchema.parse(await req.json());
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) return jsonError("Not found", 404);

  const holiday = await prisma.holiday.update({
    where: { id },
    data: {
      ...("name" in body ? { name: body.name } : {}),
      ...("date" in body ? { date: body.date ? new Date(body.date) : undefined } : {}),
      ...("type" in body ? { type: body.type as HolidayType } : {}),
      ...("isOptional" in body ? { isOptional: body.isOptional } : {}),
      ...("description" in body ? { description: body.description } : {}),
      ...("maxRequests" in body ? { maxRequests: body.maxRequests } : {}),
      ...("status" in body ? { status: body.status as HolidayStatus } : {}),
    },
  });
  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.HOLIDAY_UPDATED,
    objectType: "Holiday",
    objectId: id,
    oldValue: { name: existing.name },
    newValue: { name: holiday.name },
  });
  return NextResponse.json(holiday);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const { id } = await ctx.params;
  await prisma.optionalHolidaySelection.deleteMany({ where: { holidayId: id } });
  await prisma.holiday.delete({ where: { id } });
  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.HOLIDAY_DELETED,
    objectType: "Holiday",
    objectId: id,
  });
  return NextResponse.json({ ok: true });
}
