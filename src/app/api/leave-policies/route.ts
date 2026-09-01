import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { activeLeaveTypeWhere } from "@/lib/leave/constants";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;
  const policies = await prisma.leavePolicy.findMany({
    where: { leaveType: activeLeaveTypeWhere() },
    include: { leaveType: true },
    orderBy: { leaveType: { name: "asc" } },
  });
  return NextResponse.json(policies);
}
