import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * How far the first index of a vault has come (issue 143).
 *
 * A vault without an index used to be read whole before the app drew anything.
 * For a vault in a folder another app keeps that is minutes through Android's
 * Storage Access Framework — and with one call that never answered, forever.
 * The first scan of such a vault now runs behind the open app, and this store
 * is what the app says about it: the boot surface counts the files read while
 * a vault opens, the strip on top of the app says that search, tags and
 * databases are not whole yet, and the operations that need the WHOLE index —
 * a rename that rewrites every link onto a note, a clean-up that calls a file
 * unlinked — wait for it (`awaitWholeIndex` in vaultService).
 *
 * Only the first build is reported. The warm pass on every start runs over an
 * index that is already whole, and a notice for it would be noise.
 */

export interface IndexBuildState {
  vaultId: string;
  /** Files read and indexed so far. */
  done: number;
  /** Files to index; 0 while the folder is still being walked. */
  total: number;
}

let state: IndexBuildState | null = null;
const listeners = new Set<() => void>();
/** Progress comes per file; the screens hear of it at most this often. */
const NOTIFY_INTERVAL_MS = 200;
let lastNotified = 0;
let trailing: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  lastNotified = Date.now();
  if (trailing) { clearTimeout(trailing); trailing = null; }
  for (const listener of listeners) listener();
}

export function subscribeIndexBuild(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getIndexBuild(): IndexBuildState | null {
  return state;
}

/** Whether the first index of this vault is being built right now. */
export function isIndexBuilding(vaultId: string): boolean {
  return state !== null && state.vaultId === vaultId;
}

export function beginIndexBuild(vaultId: string): void {
  state = { vaultId, done: 0, total: 0 };
  notify();
}

/** Per file; ignored unless this vault's first build is running. */
export function reportIndexBuild(vaultId: string, done: number, total: number): void {
  if (!isIndexBuilding(vaultId)) return;
  state = { vaultId, done, total };
  const wait = NOTIFY_INTERVAL_MS - (Date.now() - lastNotified);
  if (wait <= 0) notify();
  else if (!trailing) trailing = setTimeout(notify, wait);
}

export function endIndexBuild(vaultId: string): void {
  if (!isIndexBuilding(vaultId)) return;
  state = null;
  notify();
}

/**
 * Waits for the first index of a folder vault before something that needs ALL
 * of it (issue 143): a rename rewrites every link onto the note the index
 * knows of, a move every board that holds the file, a clean-up calls a file
 * unlinked when the index knows no link to it. Over half an index each of
 * these would do half its work and report it as done. Says once that it
 * waits; returns at once for every other vault.
 */
export async function awaitWholeIndex(v: { vaultId: string; whenIndexWhole(): Promise<void> }): Promise<void> {
  if (!isIndexBuilding(v.vaultId)) return;
  toast.info(i18n.t("mobile.indexWaitWhole"));
  await v.whenIndexWhole();
}
