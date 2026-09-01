"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export default function SettingsPage() {
  const [morningStatusSlackId, setMorningStatusSlackId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const data = await fetch("/api/settings").then((r) => r.json());
    setMorningStatusSlackId(data.morningStatusSlackId || "");
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ morningStatusSlackId }),
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
          <CardTitle>Morning team status DM</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="max-w-xl space-y-4">
            <div>
              <Label>Slack User or Channel ID</Label>
              <Input
                value={morningStatusSlackId}
                onChange={(e) => setMorningStatusSlackId(e.target.value)}
                placeholder="U01234567 or C01234567"
              />
              <p className="mt-1 text-xs text-slate-500">
                Daily at 10:00 AM IST, a DM lists who is working and who is on leave today.
                Use a user ID for DM, or a channel ID to post in a channel.
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
