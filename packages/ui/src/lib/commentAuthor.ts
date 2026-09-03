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
