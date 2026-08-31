import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";

export async function GET(req: NextRequest) {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const limit = Number(req.nextUrl.searchParams.get("limit") || 100);
  const logs = await prisma.leaveAuditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
  });
  return NextResponse.json(logs);
}
