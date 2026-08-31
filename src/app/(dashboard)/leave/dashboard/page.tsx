"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

type DashboardData = {
  cards: {
    totalEmployees: number;
    pendingRequests: number;
    approvedThisMonth: number;
    rejectedThisMonth: number;
    totalLeaveTaken: number;
    totalRemainingLeave: number;
  };
  charts: {
    leaveByMonth: { month: number; days: number }[];
    leaveByDepartment: { name: string; days: number }[];
    leaveByType: { name: string; days: number }[];
    approvedVsRejected: { name: string; value: number }[];
    upcomingHolidays: { name: string; date: string }[];
  };
};

const COLORS = ["#0f172a", "#334155", "#64748b", "#94a3b8", "#cbd5e1", "#10b981", "#f59e0b"];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return <p className="text-slate-500">Loading dashboard...</p>;
  }

  const cards = [
    { label: "Total Employees", value: data.cards.totalEmployees },
    { label: "Pending Requests", value: data.cards.pendingRequests },
    { label: "Approved This Month", value: data.cards.approvedThisMonth },
    { label: "Rejected This Month", value: data.cards.rejectedThisMonth },
    { label: "Total Leave Taken", value: data.cards.totalLeaveTaken },
    { label: "Total Remaining Leave", value: Math.round(data.cards.totalRemainingLeave * 10) / 10 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Leave Dashboard</h1>
        <p className="text-slate-500">SecureITLab employee leave overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leave by Month</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.leaveByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="days" fill="#0f172a" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leave by Department</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.leaveByDepartment}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="days" fill="#334155" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leave by Type</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.leaveByType}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="days" fill="#64748b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approved vs Rejected</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.charts.approvedVsRejected}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {data.charts.approvedVsRejected.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Holidays</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-slate-100">
            {data.charts.upcomingHolidays.map((h) => (
              <li key={h.name + h.date} className="flex justify-between py-2 text-sm">
                <span>{h.name}</span>
                <span className="text-slate-500">
                  {format(new Date(h.date), "dd MMM yyyy")}
                </span>
              </li>
            ))}
            {!data.charts.upcomingHolidays.length && (
              <li className="py-2 text-sm text-slate-500">No upcoming holidays</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
