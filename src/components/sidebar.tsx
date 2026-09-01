"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";

const links: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/leave/dashboard", label: "Dashboard" },
  { href: "/leave/requests", label: "Requests" },
  { href: "/leave/employees", label: "Employees", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { href: "/leave/balances", label: "Balances" },
  { href: "/leave/holidays", label: "Holidays", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { href: "/leave/types", label: "Leave Types", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { href: "/leave/policies", label: "Policies", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { href: "/leave/settings", label: "Slack Settings", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
  { href: "/leave/calendar", label: "Calendar" },
  { href: "/leave/reports", label: "Reports", roles: ["SUPER_ADMIN", "HR_ADMIN", "MANAGER"] },
  { href: "/leave/audit-logs", label: "Audit Logs", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
];

export function Sidebar({ role, name }: { role: Role; name: string }) {
  const pathname = usePathname();
  const visible = links.filter((l) => !l.roles || l.roles.includes(role));

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-200 bg-slate-950 text-white">
      <div className="border-b border-slate-800 p-5">
        <p className="text-xs uppercase tracking-widest text-slate-400">SecureITLab</p>
        <h1 className="mt-1 text-lg font-semibold">Leave Tracker</h1>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white",
              pathname === l.href && "bg-slate-800 text-white"
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-4">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-slate-400">{role.replace("_", " ")}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}
