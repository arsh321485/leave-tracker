import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { isAdmin } from "@/lib/rbac";
import { approveCompOffCredit, rejectCompOffCredit, cancelCompOffCredit } from "@/lib/leave/comp-off";
import { LeaveValidationError } from "@/lib/leave/service";
import {
  notifyEmployeeCompOffApproved,
  notifyEmployeeCompOffRejected,
  finalizeManagerCompOffRequest,
} from "@/lib/slack/notifications";
import { format } from "date-fns";

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  reason: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireSession();
  if (error) return error;

  const { id } = await params;
  const body = actionSchema.parse(await req.json());

  const credit = await prisma.compOffCredit.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!credit) return jsonError("Comp Off request not found", 404);

  const actorEmployeeId = user.employeeId;
  const admin = isAdmin(user.role);
  const isManager =
    !!actorEmployeeId && credit.employee.managerId === actorEmployeeId;
  const isOwner = !!actorEmployeeId && credit.employeeId === actorEmployeeId;

  try {
    if (body.action === "approve") {
      if (!admin && !isManager) {
        return jsonError("Only the employee's manager or HR can approve", 403);
      }
      if (!actorEmployeeId && admin) {
        // HR without employee profile — find any admin employee or use first HR
        return jsonError(
          "Your admin login must be linked to an employee profile to approve Comp Off.",
          400
        );
      }
      if (!actorEmployeeId) return jsonError("No employee profile linked", 403);

      const updated = await approveCompOffCredit({
        creditId: id,
        approverEmployeeId: actorEmployeeId,
        actorId: user.id,
        actorLabel: user.name,
      });

      await finalizeManagerCompOffRequest(
        updated.id,
        `✅ *COMP OFF APPROVED* by ${user.name}\n${updated.employee.name} — +${updated.days} day(s) for ${format(updated.workDate, "dd MMM yyyy")}`
      );
      await notifyEmployeeCompOffApproved(updated.id, user.name);

      return NextResponse.json(updated);
    }

    if (body.action === "reject") {
      if (!admin && !isManager) {
        return jsonError("Only the employee's manager or HR can reject", 403);
      }
      if (!actorEmployeeId) {
        return jsonError(
          "Your login must be linked to an employee profile to reject Comp Off.",
          400
        );
      }
      const reason = body.reason?.trim();
      if (!reason) return jsonError("Rejection reason is required");

      const updated = await rejectCompOffCredit({
        creditId: id,
        rejectorEmployeeId: actorEmployeeId,
        reason,
        actorId: user.id,
        actorLabel: user.name,
      });

      await finalizeManagerCompOffRequest(
        updated.id,
        `❌ *COMP OFF REJECTED* by ${user.name}\n${updated.employee.name}`
      );
      await notifyEmployeeCompOffRejected(updated.id, user.name, reason);

      return NextResponse.json(updated);
    }

    if (body.action === "cancel") {
      if (!admin && !isOwner) {
        return jsonError("You can only cancel your own Comp Off request", 403);
      }
      const updated = await cancelCompOffCredit({
        creditId: id,
        actorEmployeeId: actorEmployeeId || undefined,
        actorId: user.id,
        actorLabel: user.name,
        asAdmin: admin,
      });
      return NextResponse.json(updated);
    }

    return jsonError("Unknown action");
  } catch (e) {
    if (e instanceof LeaveValidationError) return jsonError(e.message);
    throw e;
  }
}
