"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TYPES = [
  { id: "employee", label: "Employee Leave Report" },
  { id: "department", label: "Department Leave Report" },
  { id: "monthly", label: "Monthly Leave Report" },
  { id: "yearly", label: "Yearly Leave Report" },
  { id: "leave-type", label: "Leave Type Report" },
  { id: "holiday", label: "Holiday Report" },
];

export default function ReportsPage() {
  const [type, setType] = useState("employee");
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  async function load() {
    const res = await fetch(`/api/reports/leave?type=${type}&year=${year}`);
    const data = await res.json();
    setRows(data.rows || []);
  }

  function exportFile(format: "csv" | "xlsx") {
    window.open(`/api/reports/leave/export?type=${type}&year=${year}&format=${format}`, "_blank");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-slate-500">Generate and export leave reports</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Report type
            <select
              className="mt-1 block h-10 rounded-md border px-3"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Year
            <input
              type="number"
              className="mt-1 block h-10 rounded-md border px-3"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>
          <Button onClick={load}>Run Report</Button>
          <Button variant="outline" onClick={() => exportFile("csv")}>
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => exportFile("xlsx")}>
            Export Excel
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {rows.length ? (
            <table className="w-full text-left text-sm">
              <thead className="border-b text-slate-500">
                <tr>
                  {Object.keys(rows[0]).map((k) => (
                    <th key={k} className="py-2 pr-3">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {Object.values(r).map((v, j) => (
                      <td key={j} className="py-2 pr-3">
                        {String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Run a report to see results</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
