interface Comment {
  id: string;
  authorId: string;
}

/**
 * Removes comments authored by any workspace-blocked user.
 */
export function filterBlockedComments(comments: Comment[], blockedUserIds: string[]): Comment[] {
  return comments.filter((comment) => !blockedUserIds.includes(comment.authorId));
}
