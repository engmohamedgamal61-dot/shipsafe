import { NextResponse } from "next/server";
import { isGitHubConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getAuth } from "@/server/container";
import { completeInstallation } from "@/server/github/connect";
import { verifyInstallState } from "@/server/github/install-state";

/**
 * The GitHub App's "Setup URL" — configure it in the App's settings as
 * `https://<your-deployment>/api/github/setup`. GitHub redirects here
 * once a user finishes installing (or updating) the app, with
 * `installation_id` and the `state` value we originally sent when
 * redirecting them to GitHub (see `src/app/actions/github.ts`).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!isGitHubConfigured) {
    return redirectTo("/repositories?github_error=not_configured");
  }

  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");

  if (!installationId || !state) {
    return redirectTo("/repositories?github_error=missing_params");
  }

  const statePayload = verifyInstallState(state);
  if (!statePayload) {
    return redirectTo("/repositories?github_error=invalid_state");
  }

  // Defense in depth: the browser completing this redirect should still
  // be signed in as the same user who started it.
  const session = await getAuth().getSession();
  if (!session || session.userId !== statePayload.userId) {
    return redirectTo("/repositories?github_error=session_mismatch");
  }

  try {
    await completeInstallation(installationId, statePayload.workspaceId);
  } catch (error) {
    logger.error("failed to complete github app installation", {
      installationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return redirectTo("/repositories?github_error=install_failed");
  }

  return redirectTo("/repositories?github_connected=1");
}
