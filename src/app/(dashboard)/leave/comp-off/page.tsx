"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

type Credit = {
  id: string;
  days: number;
  reason: string;
  status: string;
  workDate: string;
  employee: { name: string; department?: { name: string } | null; manager?: { name: string } | null };
  approvedBy?: { name: string } | null;
  rejectedBy?: { name: string } | null;
  rejectionReason?: string | null;
};

type EmployeeOption = { id: string; name: string };

function statusVariant(s: string) {
  if (s === "APPROVED") return "success" as const;
  if (s === "REJECTED") return "danger" as const;
  if (s === "PENDING") return "warning" as const;
  return "secondary" as const;
}

export default function CompOffPage() {
  const [rows, setRows] = useState<Credit[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [status, setStatus] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createEmp, setCreateEmp] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [duration, setDuration] = useState("FULL_DAY");
  const [createReason, setCreateReason] = useState("");

  async function loadEmployees() {
    const data = await fetch("/api/employees?status=ACTIVE").then((r) => r.json());
    if (Array.isArray(data)) {
      setEmployees(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
    }
  }

  async function load() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (employeeId) params.set("employeeId", employeeId);
    const q = params.toString() ? `?${params}` : "";
    const data = await fetch(`/api/comp-off${q}`).then((r) => r.json());
    setRows(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    load();
  }, [status, employeeId]);

  async function act(id: string, action: "approve" | "reject" | "cancel", body?: object) {
    const res = await fetch(`/api/comp-off/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Action failed");
      return;
    }
    setMessage(
      action === "approve"
        ? "Approved — Comp Off balance increased"
        : `${action} successful`
    );
    setRejectId(null);
    setReason("");
    load();
  }

  async function createCredit() {
    if (!createEmp || !workDate || !createReason.trim()) {
      setMessage("Employee, work date, and reason are required");
      return;
    }
    const res = await fetch("/api/comp-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: createEmp,
        workDate,
        duration,
        reason: createReason,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Create failed");
      return;
    }
    setMessage("Comp Off credit requested — waiting for manager approval");
    setShowCreate(false);
    setCreateEmp("");
    setWorkDate("");
    setCreateReason("");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Comp Off Credits</h1>
          <p className="text-slate-500">
            Earn credit for extra work → manager approves → balance increases → apply Comp Off leave
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Close form" : "Request Comp Off"}
          </Button>
          <select
            className="h-10 min-w-[180px] rounded-md border border-slate-200 px-3 text-sm"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
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
      </div>

      {message && <p className="text-sm text-slate-600">{message}</p>}

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>New Comp Off credit request</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={createEmp}
              onChange={(e) => setCreateEmp(e.target.value)}
            >
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="FULL_DAY">Full day (1.0)</option>
              <option value="HALF_DAY">Half day (0.5)</option>
            </select>
            <Input
              placeholder="Reason / work done"
              value={createReason}
              onChange={(e) => setCreateReason(e.target.value)}
            />
            <Button onClick={createCredit}>Submit request</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Credit requests</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2 pr-3">Employee</th>
                <th className="py-2 pr-3">Work date</th>
                <th className="py-2 pr-3">Days</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{r.employee.name}</div>
                    <div className="text-xs text-slate-500">
                      Mgr: {r.employee.manager?.name || "-"}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    {format(new Date(r.workDate), "dd MMM yyyy")}
                  </td>
                  <td className="py-3 pr-3">{r.days}</td>
                  <td className="py-3 pr-3 max-w-[240px]">{r.reason}</td>
                  <td className="py-3 pr-3">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    {r.rejectionReason && (
                      <div className="mt-1 text-xs text-slate-500">{r.rejectionReason}</div>
                    )}
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
                        <Button size="sm" variant="outline" onClick={() => act(r.id, "cancel")}>
                          Cancel
                        </Button>
                      </div>
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
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No Comp Off credit requests yet.
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
