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
  departmentId?: string | null;
  managerId?: string | null;
  department?: { id: string; name: string } | null;
  manager?: { id: string; name: string } | null;
  joiningDate?: string | null;
};

type Dept = { id: string; name: string };

type SlackRow = {
  slackUserId: string;
  slackName: string;
  email: string | null;
  mappingStatus: string;
  employeeName: string | null;
};

const emptyForm = {
  name: "",
  email: "",
  departmentId: "",
  designation: "",
  managerId: "",
  slackUserId: "",
  joiningDate: "",
  status: "ACTIVE",
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [syncRows, setSyncRows] = useState<SlackRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkManagerId, setBulkManagerId] = useState("");
  const [message, setMessage] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  async function load() {
    const [e, d] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
    ]);
    setEmployees(Array.isArray(e) ? e : []);
    setDepartments(Array.isArray(d) ? d : []);
  }

  useEffect(() => {
    load();
  }, []);

  const visibleEmployees = employees.filter((e) =>
    showInactive ? true : e.status === "ACTIVE"
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    const ids = visibleEmployees.map((e) => e.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : ids);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      email: form.email,
      departmentId: form.departmentId || null,
      designation: form.designation || null,
      managerId: form.managerId || null,
      slackUserId: form.slackUserId || null,
      joiningDate: form.joiningDate || null,
      status: form.status as "ACTIVE" | "INACTIVE",
    };

    const res = await fetch(editingId ? `/api/employees/${editingId}` : "/api/employees", {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setMessage(res.ok ? (editingId ? "Employee updated" : "Employee created") : data.error);
    if (res.ok) {
      setForm(emptyForm);
      setEditingId(null);
      load();
    }
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      name: emp.name,
      email: emp.email,
      departmentId: emp.department?.id || emp.departmentId || "",
      designation: emp.designation || "",
      managerId: emp.manager?.id || emp.managerId || "",
      slackUserId: emp.slackUserId || "",
      joiningDate: emp.joiningDate ? emp.joiningDate.slice(0, 10) : "",
      status: emp.status || "ACTIVE",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function removeEmployee(emp: Employee) {
    if (
      !confirm(
        `Deactivate ${emp.name}? Leave history is kept. They will be marked INACTIVE and unmapped from Slack.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/employees/${emp.id}`, { method: "DELETE" });
    const data = await res.json();
    setMessage(res.ok ? `${emp.name} deactivated` : data.error || "Delete failed");
    if (res.ok) {
      setSelectedIds((prev) => prev.filter((id) => id !== emp.id));
      if (editingId === emp.id) cancelEdit();
      load();
    }
  }

  async function applyBulkManager() {
    if (!selectedIds.length) {
      setMessage("Select at least one employee first");
      return;
    }
    if (!bulkManagerId) {
      setMessage("Choose a manager for the selected employees");
      return;
    }
    const manager = employees.find((e) => e.id === bulkManagerId);
    if (
      !confirm(
        `Set ${manager?.name || "selected manager"} as manager for ${selectedIds.length} employee(s)?`
      )
    ) {
      return;
    }
    const res = await fetch("/api/employees/bulk-manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeIds: selectedIds, managerId: bulkManagerId }),
    });
    const data = await res.json();
    setMessage(res.ok ? `Manager assigned to ${data.count} employee(s)` : data.error);
    if (res.ok) {
      setSelectedIds([]);
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
    setMessage(res.ok ? "Slack account linked to employee" : data.error);
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
          <p className="text-slate-500">
            Manage employees, assign managers in bulk, and link Slack accounts
          </p>
        </div>
        <Button onClick={syncSlack}>Sync Slack Users</Button>
      </div>
      {message && <p className="text-sm text-slate-600">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit Employee" : "Add Employee"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
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
              <Input
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </div>
            <div>
              <Label>Manager (who approves this person&apos;s leave)</Label>
              <select
                className="h-10 w-full rounded-md border px-3 text-sm"
                value={form.managerId}
                onChange={(e) => setForm({ ...form, managerId: e.target.value })}
              >
                <option value="">None</option>
                {employees
                  .filter((emp) => emp.id !== editingId && emp.status === "ACTIVE")
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label>Slack User ID (same person&apos;s Slack ID)</Label>
              <Input
                value={form.slackUserId}
                onChange={(e) => setForm({ ...form, slackUserId: e.target.value })}
                placeholder="U08XXXXXX"
              />
            </div>
            <div>
              <Label>Joining Date</Label>
              <Input
                type="date"
                value={form.joiningDate}
                onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
              />
            </div>
            {editingId && (
              <div>
                <Label>Status</Label>
                <select
                  className="h-10 w-full rounded-md border px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>
            )}
            <div className="flex items-end gap-2">
              <Button type="submit">{editingId ? "Save changes" : "Create"}</Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign manager to many employees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            Example: you are Arsh (HR/manager). Select your 7 team members below, choose{" "}
            <strong>Arsh</strong> as manager, then click Apply. This sets who approves their
            leave — it is different from Slack account linking.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Manager</Label>
              <select
                className="mt-1 h-10 min-w-[220px] rounded-md border px-3 text-sm"
                value={bulkManagerId}
                onChange={(e) => setBulkManagerId(e.target.value)}
              >
                <option value="">Select manager...</option>
                {employees
                  .filter((e) => e.status === "ACTIVE")
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
              </select>
            </div>
            <Button type="button" onClick={applyBulkManager} disabled={!selectedIds.length}>
              Apply to {selectedIds.length || 0} selected
            </Button>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee Directory</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={
                      visibleEmployees.length > 0 &&
                      visibleEmployees.every((e) => selectedIds.includes(e.id))
                    }
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Manager</th>
                <th>Slack</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(e.id)}
                      onChange={() => toggleSelect(e.id)}
                      aria-label={`Select ${e.name}`}
                    />
                  </td>
                  <td className="py-2 font-medium">{e.name}</td>
                  <td>{e.email}</td>
                  <td>{e.department?.name || "-"}</td>
                  <td>{e.designation || "-"}</td>
                  <td>{e.manager?.name || "-"}</td>
                  <td>
                    {e.slackUserId ? (
                      <span>
                        {e.slackName || "-"}{" "}
                        <span className="text-xs text-slate-400">{e.slackUserId}</span> ✅
                      </span>
                    ) : (
                      "Unmapped"
                    )}
                  </td>
                  <td>
                    <Badge variant={e.status === "ACTIVE" ? "success" : "secondary"}>
                      {e.status}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(e)}>
                        Edit
                      </Button>
                      {e.status === "ACTIVE" && (
                        <Button size="sm" variant="destructive" onClick={() => removeEmployee(e)}>
                          Delete
                        </Button>
                      )}
                    </div>
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
            <CardTitle>Slack account linking (same person)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 overflow-x-auto">
            <p className="text-sm text-slate-500">
              Link each Slack user to <strong>that same person&apos;s</strong> employee record
              (e.g. Slack &quot;dikshika&quot; → employee Dikshika). Do <strong>not</strong> map
              everyone to Arsh here — Arsh as their manager is set in the directory / bulk manager
              section above.
            </p>
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  <th className="py-2">Slack Name</th>
                  <th>Email</th>
                  <th>Slack User ID</th>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Link to employee</th>
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
                          onChange={(ev) => {
                            if (ev.target.value) {
                              mapUser(ev.target.value, u.slackUserId, u.slackName);
                            }
                          }}
                        >
                          <option value="">Same person...</option>
                          {employees
                            .filter((emp) => emp.status === "ACTIVE")
                            .map((emp) => (
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
