import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { selectOptionalHoliday, LeaveValidationError } from "@/lib/leave/service";

const schema = z.object({
  holidayId: z.string(),
  employeeId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const body = schema.parse(await req.json());
  const employeeId = body.employeeId || user.employeeId;
  if (!employeeId) return jsonError("employeeId required", 400);
  try {
    const selection = await selectOptionalHoliday({
      employeeId,
      holidayId: body.holidayId,
      actorId: user.id,
      actorLabel: user.name,
    });
    return NextResponse.json(selection, { status: 201 });
  } catch (e) {
    if (e instanceof LeaveValidationError) return jsonError(e.message);
    throw e;
  }
}
