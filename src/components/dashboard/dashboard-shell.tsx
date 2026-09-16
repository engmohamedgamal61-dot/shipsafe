import Link from "next/link";
import { FolderGit2, LayoutDashboard, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import type { Session } from "@/server/auth/types";

const NAV = [
  { href: "/dashboard", label: "Reviews", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
];

export function DashboardShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
              ShipSafe
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {!isSupabaseConfigured && (
              <span className="rounded-full bg-verdict-minor-bg px-3 py-1 text-xs font-medium text-verdict-minor">
                Demo mode
              </span>
            )}
            <span className="text-sm text-muted-foreground">{session.email}</span>
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
