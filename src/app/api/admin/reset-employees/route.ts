import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * SUPER_ADMIN only — wipe leave/employee operational data so you can start fresh.
 * Keeps leave types/policies/departments/holidays and login users.
 * Does NOT delete admin login accounts.
 */
export async function POST() {
  const { user, error } = await requireSession([Role.SUPER_ADMIN]);
  if (error) return error;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.optionalHolidaySelection.deleteMany();
      await tx.leaveRequest.deleteMany();
      await tx.leaveBalance.deleteMany();
      await tx.slackIdempotency.deleteMany();
      await tx.leaveAuditLog.deleteMany();

      await tx.user.updateMany({ data: { employeeId: null } });
      await tx.employee.updateMany({ data: { managerId: null } });
      await tx.employee.deleteMany();
    });

    logger.info({ actor: user.email }, "Employee/leave data reset");
    return NextResponse.json({
      ok: true,
      message:
        "All employees and leave requests/balances cleared. Re-add employees, or run: npx prisma db seed",
    });
  } catch (e) {
    logger.error({ err: e }, "Reset failed");
    return jsonError("Reset failed", 500);
  }
}
