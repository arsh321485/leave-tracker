"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Balance = {
  id: string;
  year: number;
  allocated: number;
  used: number;
  pending: number;
  carryForward: number;
  remaining: number;
  employee: { id?: string; name: string };
  employeeId?: string;
  leaveType: { name: string };
};

type EmployeeOption = { id: string; name: string };

export default function BalancesPage() {
  const [rows, setRows] = useState<Balance[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadEmployees() {
    const data = await fetch("/api/employees?status=ACTIVE").then((r) => r.json());
    if (Array.isArray(data)) {
      setEmployees(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
    }
  }

  async function load() {
    const q = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
    const data = await fetch(`/api/leave-balances${q}`).then((r) => r.json());
    setRows(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    load();
  }, [employeeId]);

  const employeeOptions = useMemo(() => {
    if (employees.length) return employees;
    const seen = new Map<string, string>();
    for (const b of rows) {
      const id = b.employeeId || b.employee.id;
      if (id && !seen.has(id)) seen.set(id, b.employee.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [employees, rows]);

  async function applyRemainingYearBalances() {
    if (
      !confirm(
        "Clear ALL leave requests and reset balances for every employee?\n\n" +
          "New balances (this year):\n" +
          "• Annual Leave: 4\n" +
          "• Casual Leave: 3\n" +
          "• Sick Leave: 3\n" +
          "• Menstruation: 1 per month (eligible only)\n\n" +
          "Employees are NOT deleted."
      )
    ) {
      return;
    }
    if (!confirm("Are you sure? All current leave requests will be permanently deleted.")) {
      return;
    }

    setBusy(true);
    setMessage("");
    const res = await fetch("/api/admin/reset-leave-data", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    setMessage(res.ok ? data.message : data.error || "Failed");
    if (res.ok) load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leave Balances</h1>
          <p className="text-slate-500">
            Remaining = Allocated + Carry Forward − Used − Pending
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-10 min-w-[200px] rounded-md border border-slate-200 px-3 text-sm"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">All employees</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <Button variant="destructive" disabled={busy} onClick={applyRemainingYearBalances}>
            {busy ? "Working…" : "Clear requests & set remaining-year balances"}
          </Button>
        </div>
      </div>

      {message && <p className="text-sm text-slate-600">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Balances</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2">Employee</th>
                <th>Leave Type</th>
                <th>Year</th>
                <th>Allocated</th>
                <th>Carry Forward</th>
                <th>Used</th>
                <th>Pending</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="py-2">{b.employee.name}</td>
                  <td>{b.leaveType.name}</td>
                  <td>{b.year}</td>
                  <td>{b.allocated}</td>
                  <td>{b.carryForward}</td>
                  <td>{b.used}</td>
                  <td>{b.pending}</td>
                  <td className="font-semibold">{b.remaining}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No balances found
                    {employeeId ? " for this employee" : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
