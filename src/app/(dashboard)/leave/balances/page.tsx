"use client";

import { useEffect, useState } from "react";
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
  useEffect(() => {
    fetch("/api/leave-balances")
      .then((r) => r.json())
      .then(setRows);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leave Balances</h1>
        <p className="text-slate-500">Remaining = Allocated + Carry Forward − Used − Pending</p>
      </div>
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
