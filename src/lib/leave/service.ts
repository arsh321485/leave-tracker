import {
  AuditAction,
  EmployeeStatus,
  LeaveDuration,
  LeaveRequestStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { calculateLeaveDays } from "@/lib/leave/working-days";
import { remainingBalance } from "@/lib/utils";

export class LeaveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveValidationError";
  }
}

function datesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export async function validateLeaveRequest(input: {
  employeeId: string;
  leaveTypeId: string;
  startDate: string | Date;
  endDate: string | Date;
  duration: LeaveDuration;
  reason: string;
  excludeRequestId?: string;
}) {
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: { manager: true },
  });
  if (!employee) throw new LeaveValidationError("Employee does not exist.");
  if (employee.status !== EmployeeStatus.ACTIVE) {
    throw new LeaveValidationError("Employee is not active.");
  }
  if (!employee.managerId) {
    throw new LeaveValidationError("Employee does not have a valid manager assigned.");
  }

  const leaveType = await prisma.leaveType.findUnique({
    where: { id: input.leaveTypeId },
    include: { policy: true },
  });
  if (!leaveType || !leaveType.isActive) {
    throw new LeaveValidationError("Leave type does not exist or is inactive.");
  }

  if (!input.startDate || !input.endDate) {
    throw new LeaveValidationError("Start date and end date are required.");
  }

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new LeaveValidationError("Invalid start or end date.");
  }
  if (start > end) {
    throw new LeaveValidationError("Start date must be on or before end date.");
  }

  // Half / full day is a duration option on every leave type (not a separate type).
  if (input.duration === LeaveDuration.HALF_DAY) {
    if (start.toISOString().slice(0, 10) !== end.toISOString().slice(0, 10)) {
      throw new LeaveValidationError("Half-day leave must be for a single day.");
    }
  }

  if (!input.reason?.trim()) {
    throw new LeaveValidationError("Reason is required.");
  }

  const days = await calculateLeaveDays(start, end, input.duration);
  if (days <= 0) {
    throw new LeaveValidationError(
      "Requested period has no working days (weekends/holidays only)."
    );
  }

  if (
    leaveType.policy?.maxConsecutiveDays &&
    days > leaveType.policy.maxConsecutiveDays
  ) {
    throw new LeaveValidationError(
      `Maximum consecutive days for ${leaveType.name} is ${leaveType.policy.maxConsecutiveDays}.`
    );
  }

  const conflicting = await prisma.leaveRequest.findMany({
    where: {
      employeeId: input.employeeId,
      status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
      ...(input.excludeRequestId ? { id: { not: input.excludeRequestId } } : {}),
    },
  });

  for (const c of conflicting) {
    if (datesOverlap(start, end, c.startDate, c.endDate)) {
      throw new LeaveValidationError(
        `Leave overlaps with an existing ${c.status.toLowerCase()} request (${c.startDate.toISOString().slice(0, 10)} to ${c.endDate.toISOString().slice(0, 10)}).`
      );
    }
  }

  const year = start.getUTCFullYear();
  let balance = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year,
      },
    },
  });

  if (!balance) {
    const allocated = leaveType.policy?.annualAllocation ?? 0;
    balance = await prisma.leaveBalance.create({
      data: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        year,
        allocated,
        used: 0,
        pending: 0,
        carryForward: 0,
      },
    });
  }

  const remaining = remainingBalance(balance);
  if (days > remaining) {
    throw new LeaveValidationError(
      `You have only ${remaining} ${leaveType.name} days available, but you requested ${days} days.`
    );
  }

  return { employee, leaveType, days, balance, year };
}

export async function createLeaveRequest(input: {
  employeeId: string;
  leaveTypeId: string;
  startDate: string | Date;
  endDate: string | Date;
  duration: LeaveDuration;
  reason: string;
  actorId?: string | null;
  actorLabel?: string | null;
}) {
  const validated = await validateLeaveRequest(input);

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        duration: input.duration,
        days: validated.days,
        reason: input.reason.trim(),
        status: LeaveRequestStatus.PENDING,
      },
      include: {
        employee: { include: { manager: true } },
        leaveType: true,
      },
    });

    await tx.leaveBalance.update({
      where: { id: validated.balance.id },
      data: { pending: { increment: validated.days } },
    });

    await writeAuditLog(
      {
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: AuditAction.LEAVE_CREATED,
        objectType: "LeaveRequest",
        objectId: created.id,
        newValue: {
          status: created.status,
          days: created.days,
          leaveTypeId: created.leaveTypeId,
        },
      },
      tx
    );

    await writeAuditLog(
      {
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: AuditAction.BALANCE_UPDATED,
        objectType: "LeaveBalance",
        objectId: validated.balance.id,
        metadata: { pendingIncrement: validated.days },
      },
      tx
    );

    return created;
  });

  return request;
}

export async function approveLeaveRequest(input: {
  requestId: string;
  approverEmployeeId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  asAdmin?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.leaveRequest.findUnique({
      where: { id: input.requestId },
      include: {
        employee: { include: { manager: true } },
        leaveType: true,
      },
    });
    if (!request) throw new LeaveValidationError("Leave request not found.");
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new LeaveValidationError("Leave request is no longer pending.");
    }
    if (
      !input.asAdmin &&
      (!input.approverEmployeeId ||
        request.employee.managerId !== input.approverEmployeeId)
    ) {
      throw new LeaveValidationError("You are not authorized to approve this request.");
    }

    const year = request.startDate.getUTCFullYear();
    const balance = await tx.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          year,
        },
      },
    });
    if (!balance) throw new LeaveValidationError("Leave balance not found.");

    const updated = await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: LeaveRequestStatus.APPROVED,
        approvedById: input.approverEmployeeId || null,
        approvedAt: new Date(),
      },
      include: {
        employee: true,
        leaveType: true,
        approvedBy: true,
      },
    });

    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: {
        pending: { decrement: request.days },
        used: { increment: request.days },
      },
    });

    await writeAuditLog(
      {
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: AuditAction.LEAVE_APPROVED,
        objectType: "LeaveRequest",
        objectId: request.id,
        oldValue: { status: "PENDING" },
        newValue: { status: "APPROVED" },
      },
      tx
    );

    return { request: updated, balanceId: balance.id };
  });
}

export async function rejectLeaveRequest(input: {
  requestId: string;
  rejectorEmployeeId?: string | null;
  reason: string;
  actorId?: string | null;
  actorLabel?: string | null;
  asAdmin?: boolean;
}) {
  if (!input.reason?.trim()) {
    throw new LeaveValidationError("Rejection reason is required.");
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.leaveRequest.findUnique({
      where: { id: input.requestId },
      include: { employee: true, leaveType: true },
    });
    if (!request) throw new LeaveValidationError("Leave request not found.");
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new LeaveValidationError("Leave request is no longer pending.");
    }
    if (
      !input.asAdmin &&
      (!input.rejectorEmployeeId ||
        request.employee.managerId !== input.rejectorEmployeeId)
    ) {
      throw new LeaveValidationError("You are not authorized to reject this request.");
    }

    const year = request.startDate.getUTCFullYear();
    const balance = await tx.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          year,
        },
      },
    });

    const updated = await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: LeaveRequestStatus.REJECTED,
        rejectedById: input.rejectorEmployeeId || null,
        rejectedAt: new Date(),
        rejectionReason: input.reason.trim(),
      },
      include: {
        employee: true,
        leaveType: true,
        rejectedBy: true,
      },
    });

    if (balance) {
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { decrement: request.days } },
      });
    }

    await writeAuditLog(
      {
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: AuditAction.LEAVE_REJECTED,
        objectType: "LeaveRequest",
        objectId: request.id,
        oldValue: { status: "PENDING" },
        newValue: { status: "REJECTED", rejectionReason: input.reason.trim() },
      },
      tx
    );

    return { request: updated };
  });
}

export async function cancelLeaveRequest(input: {
  requestId: string;
  actorEmployeeId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  asAdmin?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.leaveRequest.findUnique({
      where: { id: input.requestId },
      include: { employee: true, leaveType: true },
    });
    if (!request) throw new LeaveValidationError("Leave request not found.");
    if (
      request.status !== LeaveRequestStatus.PENDING &&
      request.status !== LeaveRequestStatus.APPROVED
    ) {
      throw new LeaveValidationError("Only pending or approved leave can be cancelled.");
    }

    if (
      !input.asAdmin &&
      input.actorEmployeeId &&
      request.employeeId !== input.actorEmployeeId &&
      request.employee.managerId !== input.actorEmployeeId
    ) {
      throw new LeaveValidationError("You are not authorized to cancel this request.");
    }

    const year = request.startDate.getUTCFullYear();
    const balance = await tx.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          year,
        },
      },
    });

    const updated = await tx.leaveRequest.update({
      where: { id: request.id },
      data: { status: LeaveRequestStatus.CANCELLED },
      include: { employee: true, leaveType: true },
    });

    if (balance) {
      if (request.status === LeaveRequestStatus.PENDING) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { pending: { decrement: request.days } },
        });
      } else if (request.status === LeaveRequestStatus.APPROVED) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { used: { decrement: request.days } },
        });
      }
    }

    await writeAuditLog(
      {
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: AuditAction.LEAVE_CANCELLED,
        objectType: "LeaveRequest",
        objectId: request.id,
        oldValue: { status: request.status },
        newValue: { status: "CANCELLED" },
      },
      tx
    );

    return { request: updated };
  });
}

export async function selectOptionalHoliday(input: {
  employeeId: string;
  holidayId: string;
  actorId?: string | null;
  actorLabel?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const holiday = await tx.holiday.findUnique({
      where: { id: input.holidayId },
      include: { _count: { select: { selections: true } } },
    });
    if (!holiday || holiday.status !== "ACTIVE") {
      throw new LeaveValidationError("Holiday not found or inactive.");
    }
    if (!holiday.isOptional) {
      throw new LeaveValidationError("This holiday is not optional.");
    }
    if (
      holiday.maxRequests != null &&
      holiday._count.selections >= holiday.maxRequests
    ) {
      throw new LeaveValidationError("No slots remaining for this optional holiday.");
    }

    try {
      const selection = await tx.optionalHolidaySelection.create({
        data: {
          employeeId: input.employeeId,
          holidayId: input.holidayId,
        },
      });
      await writeAuditLog(
        {
          actorId: input.actorId,
          actorLabel: input.actorLabel,
          action: AuditAction.OPTIONAL_HOLIDAY_SELECTED,
          objectType: "Holiday",
          objectId: holiday.id,
          metadata: { employeeId: input.employeeId },
        },
        tx
      );
      return selection;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new LeaveValidationError("You have already selected this optional holiday.");
      }
      throw e;
    }
  });
}
