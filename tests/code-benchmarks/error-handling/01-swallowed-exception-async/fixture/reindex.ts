import { fetchDocumentsForWorkspace } from "./documents";
import { searchIndex } from "./search-index";

/**
 * Rebuilds the search index for a workspace's documents.
 */
export async function reindexSearchDocuments(workspaceId: string): Promise<void> {
  try {
    const documents = await fetchDocumentsForWorkspace(workspaceId);
    await searchIndex.bulkUpsert(documents);
  } catch (err) {
    console.log("reindex failed");
  }
}
