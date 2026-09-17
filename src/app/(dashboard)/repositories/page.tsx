import { AlertTriangle, CheckCircle2, GitPullRequest, Lock } from "lucide-react";
import { isGitHubConfigured } from "@/lib/env";
import { requireSession } from "@/server/auth/require-session";
import { getReviewRepository } from "@/server/container";
import { startGithubInstall } from "@/app/actions/github";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const GITHUB_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "GitHub integration is not configured on this deployment.",
  missing_params: "GitHub didn't send back the expected parameters. Please try connecting again.",
  invalid_state: "That connection link expired or is invalid. Please try connecting again.",
  session_mismatch: "You need to be signed in as the same user who started the connection.",
  install_failed: "ShipSafe couldn't finish linking that installation. Check the server logs for details.",
  no_workspace: "No workspace found for your account.",
};

export default async function RepositoriesPage({
  searchParams,
}: PageProps<"/repositories">) {
  const params = await searchParams;
  const session = await requireSession();
  const repositories = await getReviewRepository().listRepositoriesForUser(session.userId);

  const githubError = firstParam(params.github_error);
  const githubConnected = firstParam(params.github_connected);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
          <p className="mt-1 text-muted-foreground">
            Repositories ShipSafe reviews pull requests for.
          </p>
        </div>
        {isGitHubConfigured ? (
          <form action={startGithubInstall}>
            <Button type="submit" variant="secondary">
              <GitPullRequest className="h-4 w-4" aria-hidden />
              Connect GitHub
            </Button>
          </form>
        ) : (
          <Button
            variant="secondary"
            disabled
            title="Set GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET to enable this — see docs/GITHUB_INTEGRATION.md"
          >
            <GitPullRequest className="h-4 w-4" aria-hidden />
            Connect GitHub
          </Button>
        )}
      </div>

      {githubConnected && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-verdict-approve-bg px-4 py-3 text-sm text-verdict-approve">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          GitHub connected — repositories are syncing now.
        </div>
      )}

      {githubError && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-verdict-block-bg px-4 py-3 text-sm text-verdict-block">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {GITHUB_ERROR_MESSAGES[githubError] ?? "Something went wrong connecting GitHub."}
        </div>
      )}

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
                    <GitPullRequest className="h-3.5 w-3.5" aria-hidden />
                    {repository.githubInstallationId ? "GitHub" : "GitHub (disconnected)"}
                  </>
                )}
              </span>
            </CardHeader>
          </Card>
        ))}

        {repositories.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No repositories connected yet.
            </CardContent>
          </Card>
        )}
      </div>

      {!isGitHubConfigured && (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0" aria-hidden />
            GitHub integration is optional and self-hosted: register your own GitHub App and
            set its credentials as environment variables to enable it. See{" "}
            <code className="font-mono">docs/GITHUB_INTEGRATION.md</code>.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
