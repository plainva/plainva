/**
 * The avatar chip on a comment card (K3): two letters and a hue.
 *
 * No pictures - a workspace member has a display name in the policy and
 * nothing else, and inventing an image store for a chip would be a feature
 * nobody asked for. The hue is derived from the member id, so the same person
 * keeps the same colour on every device without anything being stored.
 */
export const AUTHOR_HUES = 6;

export function authorInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const first = [...words[0]][0] ?? "";
  const second = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : ([...words[0]][1] ?? "");
  return (first + second).toUpperCase();
}

export function authorHue(memberId: string): number {
  let hash = 0;
  for (let i = 0; i < memberId.length; i += 1) hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0;
  return hash % AUTHOR_HUES;
}

/** The two facts a byline needs: who wrote it, and whether the record comes from the sealed path (which carries a revision) or the open one. */
export interface CommentAuthorRef {
  authorMemberId: string;
  targetRevisionId?: string;
}

/**
 * What a card, a round or an overview row writes as the author (finding
 * 2026-09-09: "Unknown member" on every own remark in a plain vault).
 *
 * Three answers, in this order: "you" for the reader's own remarks - the id
 * is known, and a name is what the OTHERS need; the name the author's device
 * (or a workspace policy) stated; and, failing that, an honest fallback that
 * fits the store the record came from. In a plain vault the author is a
 * DEVICE, so a missing name means "a device that has not said its name yet",
 * never an unknown member - a workspace record always carries a revision,
 * an open one never does, and that is what tells the two apart.
 */
export function commentAuthorLabel(
  ref: CommentAuthorRef,
  names: ReadonlyMap<string, string>,
  selfId: string | null,
  t: (key: string) => string,
): string {
  if (selfId && ref.authorMemberId === selfId) return t("comments.commentAuthorYou");
  const name = names.get(ref.authorMemberId);
  if (name) return name;
  return t(ref.targetRevisionId === undefined ? "comments.commentUnnamedDevice" : "comments.commentUnknownAuthor");
}
