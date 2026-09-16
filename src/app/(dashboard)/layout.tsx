import { requireSession } from "@/server/auth/require-session";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return <DashboardShell session={session}>{children}</DashboardShell>;
}
