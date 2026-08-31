"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Log = {
  id: string;
  action: string;
  objectType: string;
  objectId?: string | null;
  actorLabel?: string | null;
  actor?: { name: string; email: string } | null;
  createdAt: string;
  metadata?: unknown;
};

export default function AuditLogsPage() {
  const [rows, setRows] = useState<Log[]>([]);
  useEffect(() => {
    fetch("/api/audit-logs")
      .then((r) => r.json())
      .then(setRows);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-slate-500">Leave, balance, holiday, and policy changes</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2">Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{format(new Date(l.createdAt), "dd MMM yyyy HH:mm")}</td>
                  <td>{l.actorLabel || l.actor?.name || "-"}</td>
                  <td className="font-mono text-xs">{l.action}</td>
                  <td>
                    {l.objectType}
                    {l.objectId ? ` · ${l.objectId.slice(0, 8)}…` : ""}
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
