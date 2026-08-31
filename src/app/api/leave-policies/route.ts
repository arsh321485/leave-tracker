import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;
  const policies = await prisma.leavePolicy.findMany({
    where: {
      leaveType: {
        isActive: true,
        code: { notIn: ["COMP_OFF", "HALF_DAY"] },
      },
    },
    include: { leaveType: true },
    orderBy: { leaveType: { name: "asc" } },
  });
  return NextResponse.json(policies);
}
