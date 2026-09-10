"use client";

import { useEffect, useState } from "react";
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
  employee: { name: string };
  leaveType: { name: string };
};

export default function BalancesPage() {
  const [rows, setRows] = useState<Balance[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await fetch("/api/leave-balances").then((r) => r.json());
    setRows(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    load();
  }, []);

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
        <Button variant="destructive" disabled={busy} onClick={applyRemainingYearBalances}>
          {busy ? "Working…" : "Clear requests & set remaining-year balances"}
        </Button>
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
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
