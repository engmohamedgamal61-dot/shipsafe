const LEVELS = [
  {
    label: "P0",
    name: "Critical",
    classes: "bg-severity-p0-bg text-severity-p0",
    description: "Will break production, a security hole, or data loss. Blocks merge.",
  },
  {
    label: "P1",
    name: "High priority",
    classes: "bg-severity-p1-bg text-severity-p1",
    description: "Serious risk — should be fixed before shipping in most cases.",
  },
  {
    label: "P2",
    name: "Improvement",
    classes: "bg-severity-p2-bg text-severity-p2",
    description: "Worth doing, not release-blocking.",
  },
  {
    label: "Nit",
    name: "Minor",
    classes: "bg-severity-nit-bg text-severity-nit",
    description: "Stylistic or optional polish.",
  },
];

export function SeverityExplainer() {
  return (
    <section className="border-y border-border bg-surface-muted/50 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Every finding is triaged, not just listed.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Findings roll up into one release verdict: Approve, Approve
            with minor fixes, or Do not approve.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((level) => (
            <div key={level.label} className="rounded-xl border border-border bg-surface p-5">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${level.classes}`}
              >
                {level.label}
              </span>
              <h3 className="mt-3 font-semibold">{level.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{level.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
