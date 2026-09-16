import {
  Boxes,
  Code2,
  Database,
  Gavel,
  ShieldAlert,
  TestTube2,
} from "lucide-react";

const REVIEWERS = [
  {
    icon: Code2,
    name: "Code Reviewer",
    description: "Correctness bugs, logic errors, and edge cases.",
  },
  {
    icon: ShieldAlert,
    name: "Security Reviewer",
    description: "Auth, permissions, secrets, injection, tenant isolation.",
  },
  {
    icon: Boxes,
    name: "Architecture Reviewer",
    description: "Coupling, layering, scalability, maintainability.",
  },
  {
    icon: Database,
    name: "Database Reviewer",
    description: "Migration risk, locking, data integrity.",
  },
  {
    icon: TestTube2,
    name: "Test Reviewer",
    description: "Missing coverage and weak assertions.",
  },
  {
    icon: Gavel,
    name: "Release Judge",
    description: "Consolidates every finding into one verdict.",
  },
];

export function ReviewerLineup() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Six reviewers. One verdict.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Every reviewer runs independently against the diff, then the
          Release Judge consolidates their findings — no single agent
          decides the outcome alone.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REVIEWERS.map(({ icon: Icon, name, description }) => (
          <div key={name} className="rounded-xl border border-border bg-surface p-5">
            <Icon className="h-6 w-6 text-brand" aria-hidden />
            <h3 className="mt-3 font-semibold">{name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
