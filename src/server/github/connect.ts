import { getInstallationDetails, getInstallationToken, listInstallationRepositories } from "./client";
import { upsertInstallation, upsertRepository } from "./writes";

/**
 * Runs when a user finishes the "Install GitHub App" flow and lands back
 * on our Setup URL (see `src/app/api/github/setup/route.ts`). Links the
 * installation to their workspace and does an immediate full repository
 * sync, so they see their repos right away instead of waiting on
 * whichever webhook happens to arrive first.
 */
export async function completeInstallation(installationId: string, workspaceId: string): Promise<void> {
  const details = await getInstallationDetails(installationId);
  const { id: installationRowId } = await upsertInstallation(installationId, details.account, workspaceId);

  const token = await getInstallationToken(installationId);
  const repositories = await listInstallationRepositories(token);

  for (const repo of repositories) {
    await upsertRepository(repo, workspaceId, installationRowId);
  }
}
