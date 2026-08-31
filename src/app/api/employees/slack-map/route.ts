import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { mapSlackUser } from "@/lib/slack/sync";

const schema = z.object({
  employeeId: z.string(),
  slackUserId: z.string(),
  slackName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const { error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;
  const body = schema.parse(await req.json());
  try {
    const employee = await mapSlackUser(body.employeeId, body.slackUserId, body.slackName);
    return NextResponse.json(employee);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Mapping failed");
  }
}
