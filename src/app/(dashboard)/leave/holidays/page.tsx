"use client";

import { FormEvent, useEffect, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Holiday = {
  id: string;
  name: string;
  date: string;
  type: string;
  isOptional: boolean;
  maxRequests?: number | null;
  status: string;
  description?: string | null;
  _count?: { selections: number };
};

export default function HolidaysPage() {
  const [rows, setRows] = useState<Holiday[]>([]);
  const [form, setForm] = useState({
    name: "",
    date: "",
    type: "PUBLIC",
    isOptional: false,
    maxRequests: "",
    description: "",
  });
  const [message, setMessage] = useState("");

  async function load() {
    setRows(await fetch("/api/holidays").then((r) => r.json()));
  }
  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        isOptional: form.type === "OPTIONAL" || form.isOptional,
        maxRequests: form.maxRequests ? Number(form.maxRequests) : null,
      }),
    });
    const data = await res.json();
    setMessage(res.ok ? "Holiday created" : data.error);
    if (res.ok) {
      setForm({ name: "", date: "", type: "PUBLIC", isOptional: false, maxRequests: "", description: "" });
      load();
    }
  }

  async function remove(id: string) {
    await fetch(`/api/holidays/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Holiday Management</h1>
        <p className="text-slate-500">Public, company, festival, and optional holidays</p>
      </div>
      {message && <p className="text-sm">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add Holiday</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div>
              <Label>Type</Label>
              <select
                className="h-10 w-full rounded-md border px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="PUBLIC">PUBLIC</option>
                <option value="COMPANY">COMPANY</option>
                <option value="FESTIVAL">FESTIVAL</option>
                <option value="OPTIONAL">OPTIONAL</option>
              </select>
            </div>
            <div>
              <Label>Max Requests (optional holidays)</Label>
              <Input
                type="number"
                value={form.maxRequests}
                onChange={(e) => setForm({ ...form, maxRequests: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <Button type="submit">Create Holiday</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Holidays</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2">Date</th>
                <th>Name</th>
                <th>Type</th>
                <th>Optional</th>
                <th>Slots</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="py-2">{format(new Date(h.date), "dd MMM yyyy")}</td>
                  <td>{h.name}</td>
                  <td>{h.type}</td>
                  <td>{h.isOptional ? "Yes" : "No"}</td>
                  <td>
                    {h.isOptional
                      ? `${h._count?.selections ?? 0}${h.maxRequests != null ? ` / ${h.maxRequests}` : ""}`
                      : "-"}
                  </td>
                  <td>
                    <Badge variant={h.status === "ACTIVE" ? "success" : "secondary"}>{h.status}</Badge>
                  </td>
                  <td>
                    <Button size="sm" variant="destructive" onClick={() => remove(h.id)}>
                      Delete
                    </Button>
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
