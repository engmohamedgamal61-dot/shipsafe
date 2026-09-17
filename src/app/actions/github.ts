"use server";

import { redirect } from "next/navigation";
import { env, isGitHubConfigured } from "@/lib/env";
import { getAuth } from "@/server/container";
import { getPrimaryWorkspaceId } from "@/server/workspaces";
import { signInstallState } from "@/server/github/install-state";

/**
 * Starts the "Connect GitHub" flow: redirects the browser to GitHub's own
 * App-installation UI. GitHub redirects back to this deployment's Setup
 * URL (`src/app/api/github/setup/route.ts`) once the user finishes
 * picking an account and repositories — GitHub, not ShipSafe, hosts that
 * whole flow, so there is nothing deployment-specific to configure here
 * beyond the App's own slug.
 */
export async function startGithubInstall() {
  if (!isGitHubConfigured) {
    redirect("/repositories?github_error=not_configured");
  }

  const session = await getAuth().getSession();
  if (!session) {
    redirect("/sign-in");
  }

  const workspaceId = await getPrimaryWorkspaceId(session.userId);
  if (!workspaceId) {
    redirect("/repositories?github_error=no_workspace");
  }

  const state = signInstallState(workspaceId, session.userId);
  redirect(
    `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`,
  );
}
