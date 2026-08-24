/**
 * May these two vaults be open at the same time? (multi-window stage D, § 6.6)
 *
 * Everything else in stage D is a question of comfort; this one is the single
 * case with the potential to lose data. Two vaults where one lies inside the
 * other would put two watchers on overlapping trees and two indexers on the
 * same files — writing two databases, and pushing the same file to two sync
 * targets that know nothing of each other. Whichever wrote last would win, and
 * neither would report anything.
 *
 * So this is refused rather than warned about, and it is refused with the name
 * of the other vault: "lies inside …" is something a person can act on, "cannot
 * open this vault" is not.
 *
 * Opening the SAME vault twice stays allowed — that is stage C, unchanged: one
 * runtime, two windows, one refcount.
 *
 * A pure rule on purpose: it decides on paths alone, so it can be tested without
 * a file system, and every door into a vault can ask it — the switcher, a new
 * window, and the restore at start, which would otherwise be the way around it.
 */
import i18n from "@plainva/ui/i18n";

/** Windows compares paths case-insensitively; POSIX does not. */
function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

/** Trailing separators and `\` vs `/` are spelling, not identity. */
function normalize(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return isWindowsPath(path) ? unified.toLowerCase() : unified;
}

/** True when `inner` lies below `outer` (never for the same path). */
function isInside(inner: string, outer: string): boolean {
  if (inner === outer) return false;
  // The separator matters: "/notes-old" must not count as inside "/notes".
  return inner.startsWith(outer + "/");
}

export interface VaultNestingConflict {
  /** The vault already open that this one collides with. */
  readonly other: string;
  /** `inside`: the new vault lies below the open one. `contains`: the reverse. */
  readonly kind: "inside" | "contains";
}

/**
 * The first conflict between `path` and the vaults already held, or null.
 *
 * The same path is never a conflict, so a second window on one vault passes —
 * and a repeated open of the vault this window already shows passes too.
 */
export function vaultNestingConflict(
  path: string,
  held: readonly string[],
): VaultNestingConflict | null {
  const candidate = normalize(path);
  if (!candidate) return null;
  for (const other of held) {
    const open = normalize(other);
    if (!open || open === candidate) continue;
    if (isInside(candidate, open)) return { other, kind: "inside" };
    if (isInside(open, candidate)) return { other, kind: "contains" };
  }
  return null;
}

/**
 * The refusal in the user's words — with the other vault NAMED.
 *
 * "Cannot open this vault" is something a person can only shrug at; "lies
 * inside …" tells them which of their two folders to move. Kept next to the
 * rule so the message and the reason cannot drift apart, and read by every door
 * that refuses: the switcher, a new window, and the restore at start.
 */
export function vaultNestingMessage(clash: VaultNestingConflict): string {
  return i18n.t(clash.kind === "inside" ? "window.vaultNestedInside" : "window.vaultNestedContains", {
    other: clash.other,
  });
}
