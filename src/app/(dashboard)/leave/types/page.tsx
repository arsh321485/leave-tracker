"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type LeaveType = { id: string; code: string; name: string; isActive: boolean };

export default function LeaveTypesPage() {
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  async function load() {
    setRows(await fetch("/api/leave-types").then((r) => r.json()));
  }
  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await fetch("/api/leave-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    setCode("");
    setName("");
    load();
  }

  async function toggle(id: string, isActive: boolean) {
    await fetch(`/api/leave-types/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leave Types</h1>
        <p className="text-slate-500">Create, edit, and deactivate leave types</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Add Leave Type</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="flex flex-wrap gap-3">
            <div>
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex items-end">
              <Button type="submit">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2">Code</th>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2 font-mono">{t.code}</td>
                  <td>{t.name}</td>
                  <td>
                    <Badge variant={t.isActive ? "success" : "secondary"}>
                      {t.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td>
                    <Button size="sm" variant="outline" onClick={() => toggle(t.id, t.isActive)}>
                      {t.isActive ? "Deactivate" : "Activate"}
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
