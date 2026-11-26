import type { PublicationComment, WorkspaceCommentRecord } from "@plainva/core/workspace";
import { buildCommentThreads, isCommentThreadOpen } from "./commentThreads";

export function publicationFeedbackCounts(entries: readonly PublicationComment[]): { comments: number; suggestions: number } {
  const groups = new Map<string, WorkspaceCommentRecord[]>();
  for (const entry of entries) {
    const group = groups.get(entry.publicationId) ?? [];
    group.push(entry.comment); groups.set(entry.publicationId, group);
  }
  const counts = { comments: 0, suggestions: 0 };
  for (const records of groups.values()) for (const { root } of buildCommentThreads(records, null, new Map())) {
    if (isCommentThreadOpen(root)) counts[root.suggestion ? "suggestions" : "comments"]++;
  }
  return counts;
}
