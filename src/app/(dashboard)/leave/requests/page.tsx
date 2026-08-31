"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateRange } from "@/lib/utils";

type LeaveRequest = {
  id: string;
  days: number;
  reason: string;
  status: string;
  startDate: string;
  endDate: string;
  employee: { name: string; department?: { name: string } | null; manager?: { name: string } | null };
  leaveType: { name: string };
  approvedBy?: { name: string } | null;
};

function statusVariant(s: string) {
  if (s === "APPROVED") return "success" as const;
  if (s === "REJECTED") return "danger" as const;
  if (s === "PENDING") return "warning" as const;
  return "secondary" as const;
}

export default function RequestsPage() {
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [status, setStatus] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const q = status ? `?status=${status}` : "";
    const res = await fetch(`/api/leaves${q}`);
    setRows(await res.json());
  }

  useEffect(() => {
    load();
  }, [status]);

  async function act(id: string, action: "approve" | "reject" | "cancel", body?: object) {
    const res = await fetch(`/api/leaves/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Action failed");
      return;
    }
    setMessage(`${action} successful`);
    setRejectId(null);
    setReason("");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leave Requests</h1>
          <p className="text-slate-500">Approve, reject, or cancel leave</p>
        </div>
        <select
          className="h-10 rounded-md border border-slate-200 px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {message && <p className="text-sm text-slate-600">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2 pr-3">Employee</th>
                <th className="py-2 pr-3">Dept</th>
                <th className="py-2 pr-3">Manager</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Dates</th>
                <th className="py-2 pr-3">Days</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{r.employee.name}</div>
                    <div className="text-xs text-slate-500">{r.reason}</div>
                  </td>
                  <td className="py-3 pr-3">{r.employee.department?.name || "-"}</td>
                  <td className="py-3 pr-3">{r.employee.manager?.name || "-"}</td>
                  <td className="py-3 pr-3">{r.leaveType.name}</td>
                  <td className="py-3 pr-3">{formatDateRange(r.startDate, r.endDate)}</td>
                  <td className="py-3 pr-3">{r.days}</td>
                  <td className="py-3 pr-3">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="space-y-2 py-3 pr-3">
                    {r.status === "PENDING" && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => act(r.id, "approve")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setRejectId(r.id)}>
                          Reject
                        </Button>
                      </div>
                    )}
                    {(r.status === "PENDING" || r.status === "APPROVED") && (
                      <Button size="sm" variant="outline" onClick={() => act(r.id, "cancel")}>
                        Cancel
                      </Button>
                    )}
                    {rejectId === r.id && (
                      <div className="mt-2 space-y-2">
                        <Input
                          placeholder="Rejection reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => act(r.id, "reject", { reason })}
                        >
                          Confirm Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
