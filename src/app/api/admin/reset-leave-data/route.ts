import { NextResponse } from "next/server";
import { Role, AuditAction } from "@prisma/client";
import { requireSession, jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit";
import {
  REMAINING_YEAR_ALLOCATIONS,
  MENSTRUATION_LEAVE_CODE,
  activeLeaveTypeWhere,
} from "@/lib/leave/constants";

/**
 * Clear all leave requests and re-assign balances for the current year.
 * Does NOT delete employees.
 *
 * Allocations (remaining ~4 months):
 * - Annual: 4, Casual: 3, Sick: 3
 * - Menstruation: 1/month (policy; no yearly balance row)
 */
export async function POST() {
  const { user, error } = await requireSession([Role.SUPER_ADMIN, Role.HR_ADMIN]);
  if (error) return error;

  const year = new Date().getFullYear();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const deletedRequests = await tx.leaveRequest.deleteMany();
      await tx.optionalHolidaySelection.deleteMany();
      await tx.slackIdempotency.deleteMany();

      // Align policies with remaining-year quotas
      const leaveTypes = await tx.leaveType.findMany({
        where: activeLeaveTypeWhere(),
        include: { policy: true },
      });

      for (const lt of leaveTypes) {
        const remaining = REMAINING_YEAR_ALLOCATIONS[lt.code];
        if (remaining != null && lt.policy) {
          await tx.leavePolicy.update({
            where: { id: lt.policy.id },
            data: { annualAllocation: remaining },
          });
        }
        if (lt.code === MENSTRUATION_LEAVE_CODE && lt.policy) {
          await tx.leavePolicy.update({
            where: { id: lt.policy.id },
            data: {
              monthlyQuota: 1,
              expiresMonthly: true,
              requiresEligibility: true,
              annualAllocation: 0,
            },
          });
        }
      }

      // Reset yearly balances for all active employees
      await tx.leaveBalance.deleteMany({ where: { year } });

      const employees = await tx.employee.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });

      const yearlyTypes = leaveTypes.filter(
        (t) => t.code !== MENSTRUATION_LEAVE_CODE && REMAINING_YEAR_ALLOCATIONS[t.code] != null
      );

      const balanceRows = [];
      for (const emp of employees) {
        for (const t of yearlyTypes) {
          balanceRows.push({
            employeeId: emp.id,
            leaveTypeId: t.id,
            year,
            allocated: REMAINING_YEAR_ALLOCATIONS[t.code]!,
            used: 0,
            pending: 0,
            carryForward: 0,
          });
        }
      }

      if (balanceRows.length) {
        await tx.leaveBalance.createMany({ data: balanceRows });
      }

      return {
        deletedRequests: deletedRequests.count,
        employeesUpdated: employees.length,
        balancesCreated: balanceRows.length,
      };
    });

    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.name,
      action: AuditAction.BALANCE_UPDATED,
      objectType: "LeaveBalance",
      metadata: {
        action: "clear_requests_and_apply_remaining_year_balances",
        year,
        allocations: REMAINING_YEAR_ALLOCATIONS,
        ...result,
      },
    });

    logger.info({ actor: user.email, ...result }, "Leave requests cleared; balances reassigned");

    return NextResponse.json({
      ok: true,
      year,
      allocations: {
        ...REMAINING_YEAR_ALLOCATIONS,
        MENSTRUATION: "1 per month (eligible employees only)",
      },
      ...result,
      message: `Cleared ${result.deletedRequests} leave request(s). Assigned balances for ${result.employeesUpdated} employee(s): Annual 4, Casual 3, Sick 3. Menstruation remains 1/month for eligible staff.`,
    });
  } catch (e) {
    logger.error({ err: e }, "Clear requests / apply balances failed");
    return jsonError(e instanceof Error ? e.message : "Operation failed", 500);
  }
}
