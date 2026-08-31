import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { SessionProvider } from "@/components/session-provider";

export default async function LeaveLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <SessionProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar role={session.user.role} name={session.user.name} />
        <main className="flex-1 overflow-auto p-6 md:p-8">{children}</main>
      </div>
    </SessionProvider>
  );
}
