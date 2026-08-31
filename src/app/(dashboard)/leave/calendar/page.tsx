"use client";

import { useEffect, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date());
  const [data, setData] = useState<{
    leaves: {
      id: string;
      employeeName: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      reason?: string;
    }[];
    holidays: { id: string; name: string; date: string; type: string }[];
  } | null>(null);

  useEffect(() => {
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to = format(endOfMonth(month), "yyyy-MM-dd");
    fetch(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData);
  }, [month]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leave Calendar</h1>
          <p className="text-slate-500">Employees on leave and company holidays</p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            Prev
          </button>
          <span className="px-2 py-1 text-sm font-medium">{format(month, "MMMM yyyy")}</span>
          <button
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>On Leave</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.leaves.map((l) => (
              <div key={l.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                <div className="font-medium">{l.employeeName}</div>
                <div className="text-slate-500">
                  {l.leaveType} · {format(new Date(l.startDate), "dd MMM")} –{" "}
                  {format(new Date(l.endDate), "dd MMM")}
                </div>
                {l.reason && <div className="mt-1 text-xs text-slate-400">{l.reason}</div>}
              </div>
            ))}
            {!data?.leaves.length && <p className="text-sm text-slate-500">No leave this month</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Company Holidays</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div>
                  <div className="font-medium">{h.name}</div>
                  <div className="text-slate-500">{format(new Date(h.date), "dd MMM yyyy")}</div>
                </div>
                <Badge variant="secondary">{h.type}</Badge>
              </div>
            ))}
            {!data?.holidays.length && <p className="text-sm text-slate-500">No holidays this month</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
