import { NextRequest, NextResponse } from "next/server";
import { Role, LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, jsonError } from "@/lib/api";
import { canViewAllLeaves } from "@/lib/rbac";
import { remainingBalance } from "@/lib/utils";
import { stringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession([
    Role.SUPER_ADMIN,
    Role.HR_ADMIN,
    Role.MANAGER,
  ]);
  if (error) return error;

  const type = req.nextUrl.searchParams.get("type") || "employee";
  const format = req.nextUrl.searchParams.get("format") || "json";
  const year = Number(req.nextUrl.searchParams.get("year") || new Date().getFullYear());

  let rows: Record<string, unknown>[] = [];

  if (type === "employee" || type === "leave") {
    const where =
      user.role === Role.MANAGER && user.employeeId
        ? { employee: { managerId: user.employeeId }, year }
        : { year };
    const balances = await prisma.leaveBalance.findMany({
      where,
      include: { employee: { include: { department: true } }, leaveType: true },
    });
    rows = balances.map((b) => ({
      Employee: b.employee.name,
      Email: b.employee.email,
      Department: b.employee.department?.name || "",
      LeaveType: b.leaveType.name,
      Year: b.year,
      Allocated: b.allocated,
      Used: b.used,
      Pending: b.pending,
      CarryForward: b.carryForward,
      Remaining: remainingBalance(b),
    }));
  } else if (type === "department") {
    if (!canViewAllLeaves(user.role)) return jsonError("Forbidden", 403);
    const requests = await prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.APPROVED,
        startDate: {
          gte: new Date(`${year}-01-01`),
          lte: new Date(`${year}-12-31`),
        },
      },
      include: { employee: { include: { department: true } }, leaveType: true },
    });
    const map = new Map<string, number>();
    for (const r of requests) {
      const dept = r.employee.department?.name || "Unassigned";
      map.set(dept, (map.get(dept) || 0) + r.days);
    }
    rows = [...map.entries()].map(([Department, Days]) => ({ Department, Days }));
  } else if (type === "monthly") {
    const requests = await prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.APPROVED,
        startDate: {
          gte: new Date(`${year}-01-01`),
          lte: new Date(`${year}-12-31`),
        },
        ...(user.role === Role.MANAGER && user.employeeId
          ? { employee: { managerId: user.employeeId } }
          : {}),
      },
    });
    const months = Array.from({ length: 12 }, (_, i) => ({
      Month: i + 1,
      Days: 0,
    }));
    for (const r of requests) {
      months[r.startDate.getUTCMonth()].Days += r.days;
    }
    rows = months;
  } else if (type === "leave-type") {
    const requests = await prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.APPROVED,
        startDate: {
          gte: new Date(`${year}-01-01`),
          lte: new Date(`${year}-12-31`),
        },
      },
      include: { leaveType: true },
    });
    const map = new Map<string, number>();
    for (const r of requests) {
      map.set(r.leaveType.name, (map.get(r.leaveType.name) || 0) + r.days);
    }
    rows = [...map.entries()].map(([LeaveType, Days]) => ({ LeaveType, Days }));
  } else if (type === "holiday") {
    const holidays = await prisma.holiday.findMany({
      where: {
        date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
      },
      include: { _count: { select: { selections: true } } },
      orderBy: { date: "asc" },
    });
    rows = holidays.map((h) => ({
      Name: h.name,
      Date: h.date.toISOString().slice(0, 10),
      Type: h.type,
      Optional: h.isOptional,
      MaxRequests: h.maxRequests,
      Selections: h._count.selections,
      Status: h.status,
    }));
  } else if (type === "yearly") {
    const balances = await prisma.leaveBalance.findMany({
      where: { year },
      include: { leaveType: true },
    });
    const map = new Map<string, { allocated: number; used: number; pending: number }>();
    for (const b of balances) {
      const cur = map.get(b.leaveType.name) || { allocated: 0, used: 0, pending: 0 };
      cur.allocated += b.allocated;
      cur.used += b.used;
      cur.pending += b.pending;
      map.set(b.leaveType.name, cur);
    }
    rows = [...map.entries()].map(([LeaveType, v]) => ({
      LeaveType,
      Allocated: v.allocated,
      Used: v.used,
      Pending: v.pending,
      Year: year,
    }));
  }

  if (format === "csv") {
    const csv = stringify(rows, { header: true });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="leave-report-${type}.csv"`,
      },
    });
  }

  if (format === "xlsx" || format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Report");
    if (rows.length) {
      ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: 18 }));
      rows.forEach((r) => ws.addRow(r));
    }
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leave-report-${type}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ type, year, rows });
}
