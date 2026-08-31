"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Employee = {
  id: string;
  name: string;
  email: string;
  designation?: string | null;
  status: string;
  slackUserId?: string | null;
  slackName?: string | null;
  department?: { id: string; name: string } | null;
  manager?: { id: string; name: string } | null;
  joiningDate?: string | null;
};

type Dept = { id: string; name: string };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [syncRows, setSyncRows] = useState<
    { slackUserId: string; slackName: string; email: string | null; mappingStatus: string; employeeName: string | null }[]
  >([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    departmentId: "",
    designation: "",
    managerId: "",
    slackUserId: "",
    joiningDate: "",
  });
  const [message, setMessage] = useState("");

  async function load() {
    const [e, d] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
    ]);
    setEmployees(e);
    setDepartments(d);
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        departmentId: form.departmentId || null,
        managerId: form.managerId || null,
        slackUserId: form.slackUserId || null,
        joiningDate: form.joiningDate || null,
      }),
    });
    const data = await res.json();
    setMessage(res.ok ? "Employee created" : data.error);
    if (res.ok) {
      setForm({
        name: "",
        email: "",
        departmentId: "",
        designation: "",
        managerId: "",
        slackUserId: "",
        joiningDate: "",
      });
      load();
    }
  }

  async function syncSlack() {
    const res = await fetch("/api/employees/slack-sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Sync failed");
      return;
    }
    setSyncRows(data.users || []);
    setMessage(`Synced ${data.count} Slack users`);
    load();
  }

  async function mapUser(employeeId: string, slackUserId: string, slackName: string) {
    const res = await fetch("/api/employees/slack-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, slackUserId, slackName }),
    });
    const data = await res.json();
    setMessage(res.ok ? "Mapped" : data.error);
    if (res.ok) {
      syncSlack();
      load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-slate-500">Manage employees, managers, and Slack mapping</p>
        </div>
        <Button onClick={syncSlack}>Sync Slack Users</Button>
      </div>
      {message && <p className="text-sm text-slate-600">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add Employee</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <Label>Department</Label>
              <select
                className="h-10 w-full rounded-md border px-3 text-sm"
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              >
                <option value="">Select</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Designation</Label>
              <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            </div>
            <div>
              <Label>Manager</Label>
              <select
                className="h-10 w-full rounded-md border px-3 text-sm"
                value={form.managerId}
                onChange={(e) => setForm({ ...form, managerId: e.target.value })}
              >
                <option value="">None</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Slack User ID</Label>
              <Input value={form.slackUserId} onChange={(e) => setForm({ ...form, slackUserId: e.target.value })} />
            </div>
            <div>
              <Label>Joining Date</Label>
              <Input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button type="submit">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee Directory</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2">Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Manager</th>
                <th>Slack</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{e.name}</td>
                  <td>{e.email}</td>
                  <td>{e.department?.name || "-"}</td>
                  <td>{e.designation || "-"}</td>
                  <td>{e.manager?.name || "-"}</td>
                  <td>
                    {e.slackUserId ? (
                      <span>
                        {e.slackName || "-"} <span className="text-xs text-slate-400">{e.slackUserId}</span> ✅
                      </span>
                    ) : (
                      "Unmapped"
                    )}
                  </td>
                  <td>
                    <Badge variant={e.status === "ACTIVE" ? "success" : "secondary"}>{e.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {!!syncRows.length && (
        <Card>
          <CardHeader>
            <CardTitle>Slack Mapping Status</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  <th className="py-2">Slack Name</th>
                  <th>Email</th>
                  <th>Slack User ID</th>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Map</th>
                </tr>
              </thead>
              <tbody>
                {syncRows.map((u) => (
                  <tr key={u.slackUserId} className="border-b border-slate-100">
                    <td className="py-2">{u.slackName}</td>
                    <td>{u.email || "-"}</td>
                    <td className="font-mono text-xs">{u.slackUserId}</td>
                    <td>{u.employeeName || "-"}</td>
                    <td>{u.mappingStatus}</td>
                    <td>
                      {u.mappingStatus !== "Mapped" && (
                        <select
                          className="h-8 rounded border px-2 text-xs"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) mapUser(e.target.value, u.slackUserId, u.slackName);
                          }}
                        >
                          <option value="">Map to...</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
