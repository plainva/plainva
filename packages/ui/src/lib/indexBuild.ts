import { toast } from "../services/toastStore";
import i18n from "../i18n";

/**
 * How far the first index of a vault has come — one store for both shells
 * (issue 143 on the phone; performance plan L3 on the desktop).
 *
 * A vault without an index used to be read whole before the app drew
 * anything: on the phone for a folder another app keeps, minutes through
 * Android's Storage Access Framework; on the desktop for every first open of
 * a vault, about a minute for 10 000 notes behind a splash screen. The first
 * scan now runs behind the open app, and this store is what the app says
 * about it: the boot surface counts the files read while a vault opens, the
 * strip on top of the app says that search, tags and databases are not whole
 * yet, and the operations that need the WHOLE index — a rename that rewrites
 * every link onto a note, a clean-up that calls a file unlinked, a link whose
 * note the index does not know yet — wait for it (`awaitWholeIndex`).
 *
 * Only the first build is reported. The warm pass on every start runs over an
 * index that is already whole, and a notice for it would be noise. One build
 * at a time: a window has one vault open (the phone one, a desktop window one).
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
/** Waiting for the end of the build of a vault (`whenIndexBuilt`). */
let ended: Array<{ vaultId: string; resolve: () => void }> = [];
/**
 * Progress comes per file; the screens hear of it at most this often — less
 * often than once a frame, so a counter never costs a frame (L3).
 */
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

/** Whether the first index of any vault is being built right now (one window, one vault). */
export function isAnyIndexBuilding(): boolean {
  return state !== null;
}

export function beginIndexBuild(vaultId: string): void {
  if (state && state.vaultId !== vaultId) settle(state.vaultId);
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
  settle(vaultId);
  notify();
}

function settle(vaultId: string): void {
  const waiting = ended.filter((w) => w.vaultId === vaultId);
  ended = ended.filter((w) => w.vaultId !== vaultId);
  for (const w of waiting) w.resolve();
}

/** Resolves once the first build of this vault has ended — at once where none runs. */
export function whenIndexBuilt(vaultId: string): Promise<void> {
  if (!isIndexBuilding(vaultId)) return Promise.resolve();
  return new Promise<void>((resolve) => { ended.push({ vaultId, resolve }); });
}

/**
 * Waits for the first index of a vault before something that needs ALL of it
 * (issue 143): a rename rewrites every link onto the note the index knows of,
 * a move every board that holds the file, a clean-up calls a file unlinked
 * when the index knows no link to it. Over half an index each of these would
 * do half its work and report it as done. Says once that it waits; returns at
 * once for every other vault. `whenIndexWhole` is the vault's own promise
 * where it has one; the end of the build where not.
 */
export async function awaitWholeIndex(v: { vaultId: string; whenIndexWhole?(): Promise<void> }): Promise<void> {
  if (!isIndexBuilding(v.vaultId)) return;
  toast.info(i18n.t("mobile.indexWaitWhole"));
  await (v.whenIndexWhole ? v.whenIndexWhole() : whenIndexBuilt(v.vaultId));
}

/** `awaitWholeIndex` for whichever vault this window is building, where the caller knows none. */
export async function awaitAnyWholeIndex(): Promise<void> {
  if (state) await awaitWholeIndex({ vaultId: state.vaultId });
}
