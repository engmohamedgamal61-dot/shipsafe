import { DemoCta } from "./demo-cta";

export function Hero() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 pb-20 pt-24 text-center">
      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
        AI Release Gate for Engineering Teams
      </span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
        Know if your code is{" "}
        <span className="text-brand">safe to ship</span>.
      </h1>
      <p className="max-w-2xl text-lg text-muted-foreground">
        ShipSafe reviews every pull request with six specialized AI
        reviewers — correctness, security, architecture, database,
        tests, and a release judge — and gives you one clear verdict
        before you merge.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <DemoCta size="lg" label="View live demo — no signup" />
      </div>
      <p className="text-xs text-muted-foreground">
        The demo runs the real review engine against a seeded pull request.
      </p>
    </section>
  );
}
