import { getPlatformServices } from "../platform/services";

/**
 * The last few searches, per vault (S16).
 *
 * The empty search surface used to be blank — a field, a keyboard, and no
 * suggestion of what could be typed into it. The redesign's rule 6 says every
 * empty state explains itself and offers one action; for a search field the
 * most useful offer is what this person searched for last.
 *
 * It stays device-local (settings store, not the vault): a search is a thing
 * you did here, not a property of the notes, and syncing it would put query
 * strings into a file that travels.
 *
 * The desktop passes its vault PATH where the phone passes a vault id — both
 * are just a per-vault namespace here, and neither shell ever reads the
 * other's store.
 */

const MAX = 5;
// The key still says "mobile" because that is where this shipped first
// (2026-08-14). Renaming it would silently drop every phone's existing list
// for a device-local convenience value — not worth it. The name is stale, the
// data is not.
const key = (vaultId: string) => `mobileRecentSearches_${vaultId}`;

export async function loadRecentSearches(vaultId: string): Promise<string[]> {
  const store = await getPlatformServices().loadSettings();
  const raw = await store.get<unknown>(key(vaultId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, MAX);
}

export async function rememberSearch(vaultId: string, query: string): Promise<void> {
  const q = query.trim();
  // A single character is a keystroke on the way somewhere, not a search.
  if (q.length < 2) return;
  const store = await getPlatformServices().loadSettings();
  const prev = await loadRecentSearches(vaultId);
  // Most recent first, no duplicates — repeating a search should not push the
  // rest of the list out.
  const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  await store.set(key(vaultId), next);
  await store.save();
}

export async function clearRecentSearches(vaultId: string): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  await store.delete(key(vaultId));
  await store.save();
}
