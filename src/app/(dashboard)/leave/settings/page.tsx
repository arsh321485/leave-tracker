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
  const [testDmUserId, setTestDmUserId] = useState("");
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
        ? `Channel test sent — ${data.working} working, ${data.onLeave} on leave`
        : data.error || "Send failed"
    );
  }

  async function sendHolidayTest() {
    const res = await fetch("/api/settings/test-holidays", { method: "POST" });
    const data = await res.json();
    setMessage(
      res.ok
        ? data.skipped
          ? `No message sent — no public/festival holidays for ${data.range || "next week"}`
          : `Holiday preview sent (${data.count} holiday(s) for ${data.range})`
        : data.error || "Holiday test failed"
    );
  }

  async function sendTestDm() {
    const res = await fetch("/api/settings/test-dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackUserId: testDmUserId }),
    });
    const data = await res.json();
    setMessage(res.ok ? `Test DM sent to ${data.slackUserId}` : data.error || "DM failed");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Slack Settings</h1>
        <p className="text-slate-500">Configure automated Slack notifications</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test personal DM</CardTitle>
        </CardHeader>
        <CardContent className="max-w-xl space-y-3">
          <p className="text-sm text-slate-500">
            Paste a user&apos;s Slack ID (U…) — e.g. Arsh or Rohit from Employees page — and send a
            test DM. If this fails, leave approve/apply DMs will also fail until Slack app settings
            are fixed.
          </p>
          <div>
            <Label>Slack User ID</Label>
            <Input
              value={testDmUserId}
              onChange={(e) => setTestDmUserId(e.target.value)}
              placeholder="U0XXXXXXXX"
            />
          </div>
          <Button type="button" onClick={sendTestDm} disabled={!testDmUserId.trim()}>
            Send test DM
          </Button>
          <p className="text-xs text-amber-700">
            If you see <code>messages_tab_disabled</code>: Slack App → App Home → turn on{" "}
            <strong>Messages Tab</strong> → Reinstall app to workspace. Then open the Leave Tracker
            app in Slack once (or run <code>/leave</code>).
          </p>
        </CardContent>
      </Card>

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
                Default is <strong>6:00 AM IST</strong>. Vercel Hobby runs one daily cron at{" "}
                <code>00:30 UTC</code> (= 6:00 AM IST). Set <code>CRON_SECRET</code> in Vercel
                env vars (Production) or the job will fail with 401.
              </p>
            </div>
            <div>
              <Label>Slack Channel ID</Label>
              <Input
                value={morningStatusSlackId}
                onChange={(e) => setMorningStatusSlackId(e.target.value)}
                placeholder="C01234567"
              />
              <p className="mt-1 text-xs text-slate-500">
                Channel ID (C…) only — invite bot with <code>/invite @Leave Tracker</code>
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Also on Fridays</p>
              <p className="mt-1">
                At the same morning run on Fridays, the bot posts{" "}
                <strong>next week&apos;s public &amp; festival holidays</strong> to this channel.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="outline" onClick={sendTest}>
                Send channel test
              </Button>
              <Button type="button" variant="outline" onClick={sendHolidayTest}>
                Test Friday holiday msg
              </Button>
            </div>
          </form>
          {message && <p className="mt-4 text-sm text-slate-600">{message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
