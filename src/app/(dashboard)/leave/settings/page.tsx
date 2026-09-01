"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label:
    h === 0
      ? "12:00 AM"
      : h < 12
        ? `${h}:00 AM`
        : h === 12
          ? "12:00 PM"
          : `${h - 12}:00 PM`,
}));

export default function SettingsPage() {
  const [morningStatusSlackId, setMorningStatusSlackId] = useState("");
  const [morningStatusHourIst, setMorningStatusHourIst] = useState(6);
  const [message, setMessage] = useState("");

  async function load() {
    const data = await fetch("/api/settings").then((r) => r.json());
    setMorningStatusSlackId(data.morningStatusSlackId || "");
    setMorningStatusHourIst(
      typeof data.morningStatusHourIst === "number" ? data.morningStatusHourIst : 6
    );
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ morningStatusSlackId, morningStatusHourIst }),
    });
    const data = await res.json();
    setMessage(res.ok ? "Settings saved" : data.error || "Save failed");
  }

  async function sendTest() {
    const res = await fetch("/api/settings", { method: "POST" });
    const data = await res.json();
    setMessage(
      res.ok
        ? `Test sent — ${data.working} working, ${data.onLeave} on leave`
        : data.error || "Send failed"
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Slack Settings</h1>
        <p className="text-slate-500">Configure automated Slack notifications</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Morning team status</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="max-w-xl space-y-4">
            <div>
              <Label>Send daily at (India time)</Label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                value={morningStatusHourIst}
                onChange={(e) => setMorningStatusHourIst(Number(e.target.value))}
              >
                {HOUR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} IST
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Default is <strong>6:00 AM IST</strong>. Change here anytime — no code deploy needed.
              </p>
            </div>
            <div>
              <Label>Slack User or Channel ID</Label>
              <Input
                value={morningStatusSlackId}
                onChange={(e) => setMorningStatusSlackId(e.target.value)}
                placeholder="C01234567 (channel recommended)"
              />
              <p className="mt-1 text-xs text-slate-500">
                Paste your <strong>channel ID</strong> (starts with C) — e.g. your #team-status channel.
                Invite the bot: <code>/invite @Leave Tracker</code>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="outline" onClick={sendTest}>
                Send test now
              </Button>
            </div>
          </form>
          {message && <p className="mt-4 text-sm text-slate-600">{message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
