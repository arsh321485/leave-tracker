"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Policy = {
  id: string;
  annualAllocation: number;
  carryForwardEnabled: boolean;
  carryForwardLimit: number;
  maxConsecutiveDays: number | null;
  requiresManagerApproval: boolean;
  allowHalfDay: boolean;
  allowDuringProbation: boolean;
  leaveType: { name: string; code: string };
};

export default function PoliciesPage() {
  const [rows, setRows] = useState<Policy[]>([]);

  async function load() {
    setRows(await fetch("/api/leave-policies").then((r) => r.json()));
  }
  useEffect(() => {
    load();
  }, []);

  async function save(p: Policy) {
    await fetch(`/api/leave-policies/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annualAllocation: p.annualAllocation,
        carryForwardEnabled: p.carryForwardEnabled,
        carryForwardLimit: p.carryForwardLimit,
        maxConsecutiveDays: p.maxConsecutiveDays,
        requiresManagerApproval: p.requiresManagerApproval,
        allowHalfDay: p.allowHalfDay,
        allowDuringProbation: p.allowDuringProbation,
      }),
    });
    load();
  }

  function update(id: string, patch: Partial<Policy>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leave Policies</h1>
        <p className="text-slate-500">Configurable allocations and rules (not hard-coded)</p>
      </div>
      <div className="grid gap-4">
        {rows.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>
                {p.leaveType.name}{" "}
                <span className="text-sm font-normal text-slate-400">({p.leaveType.code})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                Annual allocation
                <Input
                  type="number"
                  value={p.annualAllocation}
                  onChange={(e) => update(p.id, { annualAllocation: Number(e.target.value) })}
                />
              </label>
              <label className="text-sm">
                Carry forward limit
                <Input
                  type="number"
                  value={p.carryForwardLimit}
                  onChange={(e) => update(p.id, { carryForwardLimit: Number(e.target.value) })}
                />
              </label>
              <label className="text-sm">
                Max consecutive days
                <Input
                  type="number"
                  value={p.maxConsecutiveDays ?? ""}
                  onChange={(e) =>
                    update(p.id, {
                      maxConsecutiveDays: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.carryForwardEnabled}
                  onChange={(e) => update(p.id, { carryForwardEnabled: e.target.checked })}
                />
                Carry forward enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.requiresManagerApproval}
                  onChange={(e) => update(p.id, { requiresManagerApproval: e.target.checked })}
                />
                Requires manager approval
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.allowHalfDay}
                  onChange={(e) => update(p.id, { allowHalfDay: e.target.checked })}
                />
                Allow half day
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.allowDuringProbation}
                  onChange={(e) => update(p.id, { allowDuringProbation: e.target.checked })}
                />
                Allow during probation
              </label>
              <div>
                <Button onClick={() => save(p)}>Save Policy</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
