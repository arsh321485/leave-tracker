import { AuditAction, EmployeeStatus, LeaveDuration, LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { LeaveValidationError } from "@/lib/leave/service";
import { COMP_OFF_LEAVE_CODE } from "@/lib/leave/constants";

export async function ensureCompOffLeaveType() {
  const existing = await prisma.leaveType.findUnique({
    where: { code: COMP_OFF_LEAVE_CODE },
    include: { policy: true },
  });

  if (existing) {
    if (!existing.isActive) {
      await prisma.leaveType.update({
        where: { id: existing.id },
        data: { isActive: true, name: "Comp Off" },
      });
    }
    if (existing.policy) {
      await prisma.leavePolicy.update({
        where: { id: existing.policy.id },
        data: {
          annualAllocation: 0,
          requiresManagerApproval: true,
          allowHalfDay: true,
          carryForwardEnabled: false,
          monthlyQuota: null,
          expiresMonthly: false,
          requiresEligibility: false,
        },
      });
    } else {
      await prisma.leavePolicy.create({
        data: {
          leaveTypeId: existing.id,
          annualAllocation: 0,
          requiresManagerApproval: true,
          allowHalfDay: true,
          carryForwardEnabled: false,
        },
      });
    }
    return existing;
  }

  return prisma.leaveType.create({
    data: {
      code: COMP_OFF_LEAVE_CODE,
      name: "Comp Off",
      isActive: true,
      policy: {
        create: {
          annualAllocation: 0,
          requiresManagerApproval: true,
          allowHalfDay: true,
          carryForwardEnabled: false,
        },
      },
    },
  });
}

export async function ensureCompOffBalance(employeeId: string, year = new Date().getFullYear()) {
  const leaveType = await ensureCompOffLeaveType();
  const existing = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId,
        leaveTypeId: leaveType.id,
        year,
      },
    },
  });
  if (existing) return { leaveType, balance: existing };

  const balance = await prisma.leaveBalance.create({
    data: {
      employeeId,
      leaveTypeId: leaveType.id,
      year,
      allocated: 0,
      used: 0,
      pending: 0,
      carryForward: 0,
    },
  });
  return { leaveType, balance };
}

export async function createCompOffCredit(input: {
  employeeId: string;
  workDate: string | Date;
  duration: LeaveDuration;
  reason: string;
  actorId?: string | null;
  actorLabel?: string;
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
    throw new LeaveValidationError("Employee does not have a manager assigned.");
  }
  if (!input.reason?.trim()) {
    throw new LeaveValidationError("Reason is required.");
  }

  const workDate =
    typeof input.workDate === "string" ? new Date(`${input.workDate}T00:00:00.000Z`) : input.workDate;
  if (Number.isNaN(workDate.getTime())) {
    throw new LeaveValidationError("Invalid work date.");
  }

  const days = input.duration === LeaveDuration.HALF_DAY ? 0.5 : 1;

  const duplicate = await prisma.compOffCredit.findFirst({
    where: {
      employeeId: input.employeeId,
      workDate,
      status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
    },
  });
  if (duplicate) {
    throw new LeaveValidationError(
      "You already have a Comp Off credit for this work date (pending or approved)."
    );
  }

  await ensureCompOffLeaveType();

  const credit = await prisma.compOffCredit.create({
    data: {
      employeeId: input.employeeId,
      workDate,
      days,
      reason: input.reason.trim(),
      status: LeaveRequestStatus.PENDING,
    },
    include: {
      employee: { include: { manager: true, department: true } },
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    actorLabel: input.actorLabel || employee.name,
    action: AuditAction.COMP_OFF_CREATED,
    objectType: "CompOffCredit",
    objectId: credit.id,
    newValue: { workDate, days, reason: credit.reason },
  });

  return credit;
}

export async function approveCompOffCredit(input: {
  creditId: string;
  approverEmployeeId: string;
  actorId?: string | null;
  actorLabel?: string;
}) {
  const credit = await prisma.compOffCredit.findUnique({
    where: { id: input.creditId },
    include: { employee: true },
  });
  if (!credit) throw new LeaveValidationError("Comp Off request not found.");
  if (credit.status !== LeaveRequestStatus.PENDING) {
    throw new LeaveValidationError(`Comp Off request is already ${credit.status}.`);
  }

  const approver = await prisma.employee.findUnique({ where: { id: input.approverEmployeeId } });
  if (!approver) throw new LeaveValidationError("Approver not found.");

  const isManager = credit.employee.managerId === approver.id;
  // HR/admin may approve via panel without being the manager — checked at API layer.
  // Slack path always uses the manager employee record.

  const year = credit.workDate.getUTCFullYear();
  const { leaveType } = await ensureCompOffBalance(credit.employeeId, year);

  const updated = await prisma.$transaction(async (tx) => {
    const approved = await tx.compOffCredit.update({
      where: { id: credit.id },
      data: {
        status: LeaveRequestStatus.APPROVED,
        approvedById: approver.id,
        approvedAt: new Date(),
      },
      include: {
        employee: { include: { manager: true, department: true } },
        approvedBy: true,
      },
    });

    await tx.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: credit.employeeId,
          leaveTypeId: leaveType.id,
          year,
        },
      },
      create: {
        employeeId: credit.employeeId,
        leaveTypeId: leaveType.id,
        year,
        allocated: credit.days,
        used: 0,
        pending: 0,
        carryForward: 0,
      },
      update: {
        allocated: { increment: credit.days },
      },
    });

    return approved;
  });

  await writeAuditLog({
    actorId: input.actorId,
    actorLabel: input.actorLabel || approver.name,
    action: AuditAction.COMP_OFF_APPROVED,
    objectType: "CompOffCredit",
    objectId: credit.id,
    metadata: {
      days: credit.days,
      employeeId: credit.employeeId,
      isManager,
      balanceIncrement: credit.days,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    actorLabel: input.actorLabel || approver.name,
    action: AuditAction.BALANCE_UPDATED,
    objectType: "LeaveBalance",
    metadata: {
      employeeId: credit.employeeId,
      leaveType: COMP_OFF_LEAVE_CODE,
      year,
      allocatedIncrement: credit.days,
      source: "comp_off_credit_approved",
    },
  });

  return updated;
}

export async function rejectCompOffCredit(input: {
  creditId: string;
  rejectorEmployeeId: string;
  reason: string;
  actorId?: string | null;
  actorLabel?: string;
}) {
  const credit = await prisma.compOffCredit.findUnique({
    where: { id: input.creditId },
    include: { employee: true },
  });
  if (!credit) throw new LeaveValidationError("Comp Off request not found.");
  if (credit.status !== LeaveRequestStatus.PENDING) {
    throw new LeaveValidationError(`Comp Off request is already ${credit.status}.`);
  }
  if (!input.reason?.trim()) {
    throw new LeaveValidationError("Rejection reason is required.");
  }

  const rejector = await prisma.employee.findUnique({ where: { id: input.rejectorEmployeeId } });
  if (!rejector) throw new LeaveValidationError("Rejector not found.");

  const updated = await prisma.compOffCredit.update({
    where: { id: credit.id },
    data: {
      status: LeaveRequestStatus.REJECTED,
      rejectedById: rejector.id,
      rejectedAt: new Date(),
      rejectionReason: input.reason.trim(),
    },
    include: {
      employee: { include: { manager: true, department: true } },
      rejectedBy: true,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    actorLabel: input.actorLabel || rejector.name,
    action: AuditAction.COMP_OFF_REJECTED,
    objectType: "CompOffCredit",
    objectId: credit.id,
    metadata: { reason: input.reason.trim() },
  });

  return updated;
}

export async function cancelCompOffCredit(input: {
  creditId: string;
  actorEmployeeId?: string;
  actorId?: string | null;
  actorLabel?: string;
  asAdmin?: boolean;
}) {
  const credit = await prisma.compOffCredit.findUnique({
    where: { id: input.creditId },
    include: { employee: true },
  });
  if (!credit) throw new LeaveValidationError("Comp Off request not found.");
  if (credit.status === LeaveRequestStatus.CANCELLED) {
    throw new LeaveValidationError("Comp Off request is already cancelled.");
  }
  if (credit.status === LeaveRequestStatus.APPROVED) {
    throw new LeaveValidationError(
      "Approved Comp Off credits cannot be cancelled here. Adjust balance manually if needed."
    );
  }
  if (
    !input.asAdmin &&
    input.actorEmployeeId &&
    credit.employeeId !== input.actorEmployeeId
  ) {
    throw new LeaveValidationError("You can only cancel your own Comp Off requests.");
  }

  const updated = await prisma.compOffCredit.update({
    where: { id: credit.id },
    data: { status: LeaveRequestStatus.CANCELLED },
    include: { employee: { include: { department: true, manager: true } } },
  });

  await writeAuditLog({
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    action: AuditAction.COMP_OFF_CANCELLED,
    objectType: "CompOffCredit",
    objectId: credit.id,
  });

  return updated;
}
