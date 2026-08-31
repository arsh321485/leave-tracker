import { NextRequest, NextResponse } from "next/server";
import { Role, HolidayType, HolidayStatus, AuditAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(1),
  date: z.string(),
  type: z.enum(["PUBLIC", "COMPANY", "FESTIVAL", "OPTIONAL"]),
  isOptional: z.boolean().optional(),
  description: z.string().optional().nullable(),
  maxRequests: z.number().int().positive().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function GET(req: NextRequest) {
  const { error } = await requireSession();
  if (error) return error;
  const upcoming = req.nextUrl.searchParams.get("upcoming") === "true";
  const holidays = await prisma.holiday.findMany({
    where: {
      ...(upcoming ? { date: { gte: new Date() }, status: "ACTIVE" } : {}),
    },
    include: { _count: { select: { selections: true } }, createdBy: true },
    orderBy: { date: "asc" },
  });
  return NextResponse.json(holidays);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const body = createSchema.parse(await req.json());
  const isOptional = body.isOptional ?? body.type === "OPTIONAL";
  const holiday = await prisma.holiday.create({
    data: {
      name: body.name,
      date: new Date(body.date),
      type: body.type as HolidayType,
      isOptional,
      description: body.description,
      maxRequests: isOptional ? body.maxRequests : null,
      status: body.status as HolidayStatus,
      createdById: user.employeeId || null,
    },
  });
  await writeAuditLog({
    actorId: user.id,
    actorLabel: user.name,
    action: AuditAction.HOLIDAY_CREATED,
    objectType: "Holiday",
    objectId: holiday.id,
    newValue: { name: holiday.name, date: body.date },
  });
  return NextResponse.json(holiday, { status: 201 });
}
