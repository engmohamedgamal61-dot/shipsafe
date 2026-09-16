import { GitPullRequest, Lock } from "lucide-react";
import { requireSession } from "@/server/auth/require-session";
import { getReviewRepository } from "@/server/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function RepositoriesPage() {
  const session = await requireSession();
  const repositories = await getReviewRepository().listRepositoriesForUser(session.userId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
          <p className="mt-1 text-muted-foreground">
            Repositories ShipSafe reviews pull requests for.
          </p>
        </div>
        <Button variant="secondary" disabled title="GitHub App integration lands in Phase 2">
          <GitPullRequest className="h-4 w-4" aria-hidden />
          Connect GitHub
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {repositories.map((repository) => (
          <Card key={repository.id}>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>{repository.fullName}</CardTitle>
                <CardDescription>
                  Default branch: {repository.defaultBranch}
                </CardDescription>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {repository.provider === "demo" ? (
                  <>Demo repository</>
                ) : (
                  <>
                    <GitPullRequest className="h-3.5 w-3.5" aria-hidden /> GitHub
                  </>
                )}
              </span>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          Live GitHub App installation is coming in Phase 2 — see docs/MVP-PLAN.md.
          The connection architecture (repository records, ownership, and
          RLS policies) is already in place.
        </CardContent>
      </Card>
    </div>
  );
}
