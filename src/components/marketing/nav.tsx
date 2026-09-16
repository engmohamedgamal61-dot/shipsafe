import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { DemoCta } from "./demo-cta";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
          ShipSafe
        </Link>
        <nav className="flex items-center gap-3">
          <ButtonLink href="/sign-in" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
          <DemoCta size="sm" />
        </nav>
      </div>
    </header>
  );
}
