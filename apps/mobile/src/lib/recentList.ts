import { vaultOps, type MobileVault } from "../services/vaultService";

/** One entry of the home screen's "Recent": a note and when it was opened. */
export interface RecentListEntry {
  path: string;
  title: string;
  /** Epoch ms — of the last open, or of the last change on a first run. */
  at?: number;
}

/**
 * What "Recent" shows — the band on the home screen and the full list behind
 * its heading read the same source, so the two can never disagree (plan
 * Rückmeldungen 2026-10-24, E8).
 *
 * The real list is the notes OPENED on this device (`.plainva/recents.json`).
 * On a first run nothing has been opened yet, but synced files exist: then the
 * most recently changed notes stand in, dated by their change. `opened` says
 * which of the two the answer is — only an opened entry can be removed from
 * the list.
 */
export async function loadRecentList(
  vault: MobileVault,
  limit: number,
  fallbackLimit = limit,
): Promise<{ entries: RecentListEntry[]; opened: boolean }> {
  const opened = await vaultOps.getRecents(vault, limit);
  if (opened.length > 0) {
    return { entries: opened.map((e) => ({ path: e.path, title: e.title, at: e.openedAt })), opened: true };
  }
  const changed = await vaultOps.recent(vault, fallbackLimit);
  return { entries: changed.map((e) => ({ path: e.path, title: e.title, at: e.mtime })), opened: false };
}
