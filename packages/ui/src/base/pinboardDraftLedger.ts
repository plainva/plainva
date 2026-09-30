import { sha256Bytes, toHex, utf8Encode } from "@plainva/core";

/**
 * The drafts this device created for a pinboard's "New entry" and has not
 * ended yet (plan Befunde 2026-09-24, E15).
 *
 * A draft is a real file from the moment the entry opens — an editor needs
 * one. Closing an EMPTY entry takes it back silently. An app that is closed or
 * killed while the entry is open never gets that far, and the empty timestamp
 * note it leaves behind syncs to every device. So each draft is remembered
 * here — per device and vault, with a hash of exactly the bytes Plainva wrote —
 * until its entry ends, and whatever a crash left is finished at the next start
 * and before the next entry is planned (`sweepPinboardDrafts`):
 *
 *  - still there and byte-identical to what Plainva wrote → removed through
 *    the shell's ordinary delete (the trash where the shell has one);
 *  - changed in any way — typed text, a sync from another device — → kept,
 *    and only forgotten;
 *  - gone (a rename included) → forgotten;
 *  - open right now — in an entry or in any editor of this window, or in an
 *    entry of another window of this app where the platform can tell → left
 *    alone, still remembered.
 *
 * Nothing that was not remembered here is ever removed.
 *
 * Each draft is ONE storage key, written by `remember` and removed by
 * `forget` — never a shared list that two windows could read, change and write
 * back over each other, which could bring back an entry that had ended.
 */

/** Where the ledger lives: the device's `localStorage` in both shells. */
export interface DraftLedgerStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RememberedPinboardDraft {
  /** Vault-relative path the draft was written to. */
  path: string;
  /** SHA-256 (hex) of exactly the bytes Plainva wrote. */
  sha256: string;
  /** When it was written (ms since the epoch) — for diagnostics only. */
  at: number;
}

export interface PinboardDraftLedger {
  /**
   * Remembers a draft that is about to be written. Until `forget`, it counts
   * as open in this window.
   */
  remember(path: string, content: string): void;
  /** The entry ended — saved, closed or discarded. */
  forget(path: string): void;
  /** The remembered drafts of this vault, open ones included. */
  list(): RememberedPinboardDraft[];
  /** Whether the draft is open right now; see the module comment. */
  isOpen(path: string): Promise<boolean>;
}

/** The hash a draft is remembered by — of its UTF-8 bytes. */
export function pinboardDraftHash(content: string | Uint8Array): string {
  return toHex(sha256Bytes(typeof content === "string" ? utf8Encode(content) : content));
}

const STORAGE_PREFIX = "plainva-pinboard-draft:";

/** The storage key of one remembered draft. */
export function pinboardDraftKey(vaultKey: string, path: string): string {
  return `${STORAGE_PREFIX}${vaultKey}:${path}`;
}

function defaultStorage(): DraftLedgerStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Open right now"

/** Drafts remembered in this window whose entry has not ended — with the release of their Web Lock. */
const openHere = new Map<string, () => void>();

const openKey = (vaultKey: string, path: string) => `${vaultKey}\n${path}`;

/** Lets go of this window's hold on a draft, if it has one. The key carries a
 * vault and a note path, so what comes back is checked before it is called. */
function releaseOpen(k: string): void {
  const release = openHere.get(k);
  if (typeof release === "function") release();
}
const lockName = (vaultKey: string, path: string) => `plainva-pinboard-draft:${vaultKey}:${path}`;

interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
  query?(): Promise<{ held?: Array<{ name?: string }>; pending?: Array<{ name?: string }> }>;
}

function lockManager(): LockManagerLike | null {
  try {
    const locks = (globalThis as unknown as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
    return locks && typeof locks.request === "function" ? locks : null;
  } catch {
    return null;
  }
}

/**
 * Holds a Web Lock for as long as the entry is open. The desktop's secondary
 * windows share the lock manager with the main one, and a window that goes
 * away — closed or crashed — releases its locks, so a lock that is held is an
 * entry that is really still open somewhere. Without Web Locks the in-window
 * record is all there is.
 */
function holdLock(name: string): () => void {
  const locks = lockManager();
  if (!locks) return () => {};
  let release: (() => void) | null = null;
  let released = false;
  void locks
    .request(name, () => new Promise<void>((resolve) => {
      if (released) resolve();
      else release = resolve;
    }))
    .catch(() => {});
  return () => {
    released = true;
    release?.();
  };
}

async function lockHeldElsewhere(name: string): Promise<boolean> {
  const locks = lockManager();
  if (!locks?.query) return false;
  try {
    const state = await locks.query();
    return [...(state.held ?? []), ...(state.pending ?? [])].some((lock) => lock.name === name);
  } catch {
    return false;
  }
}

const PROBE_EVENT = "plainva-editor-shows-path";

interface EditorPathProbe {
  vaultKey: string;
  path: string;
  shown: boolean;
}

/** Whether an editor in this window shows `path` of the vault right now. */
export function editorShowsPath(vaultKey: string, path: string): boolean {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return false;
  const detail: EditorPathProbe = { vaultKey, path, shown: false };
  window.dispatchEvent(new CustomEvent(PROBE_EVENT, { detail }));
  return detail.shown;
}

/**
 * Makes an editor answer `editorShowsPath` for the note it shows — every
 * editor of both shells, so a draft that is open anywhere in the window is
 * never taken for a crash's leftover. Returns the unsubscribe.
 */
export function answerEditorPathProbe(current: () => { vaultKey: string | null; path: string | null }): () => void {
  if (typeof window === "undefined") return () => {};
  const onProbe = (event: Event) => {
    const detail = (event as CustomEvent<EditorPathProbe>).detail;
    if (!detail) return;
    const { vaultKey, path } = current();
    if (path !== null && vaultKey !== null && detail.path === path && detail.vaultKey === vaultKey) detail.shown = true;
  };
  window.addEventListener(PROBE_EVENT, onProbe);
  return () => window.removeEventListener(PROBE_EVENT, onProbe);
}

// ---------------------------------------------------------------------------

function parseEntry(raw: string | null): RememberedPinboardDraft | null {
  if (!raw) return null;
  try {
    const e: unknown = JSON.parse(raw);
    if (!e || typeof e !== "object") return null;
    const { path, sha256, at } = e as Partial<RememberedPinboardDraft>;
    return typeof path === "string" && path !== "" && typeof sha256 === "string" && typeof at === "number" ? { path, sha256, at } : null;
  } catch {
    return null;
  }
}

/** The remembered drafts of one vault — each its own key, found by its prefix. */
function readEntries(storage: DraftLedgerStorage | null, vaultKey: string): RememberedPinboardDraft[] {
  if (!storage) return [];
  const prefix = pinboardDraftKey(vaultKey, "");
  const out: RememberedPinboardDraft[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const entry = parseEntry(storage.getItem(key));
      // The key must be exactly this vault's key for that path: a vault whose
      // name continues this one's ("/a" and "/a:b") shares the prefix only.
      if (entry && key === pinboardDraftKey(vaultKey, entry.path)) out.push(entry);
    }
  } catch {
    /* a storage that cannot be read only costs the clean-up after a crash */
  }
  return out;
}

/**
 * The ledger of one vault on this device. `vaultKey` is the shell's name for
 * the vault (the desktop's vault path, the phone's vault id).
 */
export function pinboardDraftLedger(vaultKey: string, storage: DraftLedgerStorage | null = defaultStorage()): PinboardDraftLedger {
  return {
    remember(path, content) {
      const entry: RememberedPinboardDraft = { path, sha256: pinboardDraftHash(content), at: Date.now() };
      try {
        storage?.setItem(pinboardDraftKey(vaultKey, path), JSON.stringify(entry));
      } catch {
        /* a storage that refuses (quota, blocked) only costs the clean-up after a crash */
      }
      const k = openKey(vaultKey, path);
      releaseOpen(k);
      openHere.set(k, holdLock(lockName(vaultKey, path)));
    },
    forget(path) {
      try {
        storage?.removeItem(pinboardDraftKey(vaultKey, path));
      } catch {
        /* nothing more to do */
      }
      const k = openKey(vaultKey, path);
      releaseOpen(k);
      openHere.delete(k);
    },
    list: () => readEntries(storage, vaultKey),
    async isOpen(path) {
      if (openHere.has(openKey(vaultKey, path))) return true;
      if (editorShowsPath(vaultKey, path)) return true;
      return lockHeldElsewhere(lockName(vaultKey, path));
    },
  };
}

/** What finishing a crash's leftovers needs from the shell — each its normal path. */
export interface PinboardDraftSweepFiles {
  exists(path: string): Promise<boolean>;
  /** The file's bytes as they are on disk. */
  readBytes(path: string): Promise<Uint8Array>;
  /** The shell's ordinary delete (the trash where the shell has one). */
  remove(path: string): Promise<void>;
}

export interface PinboardDraftSweep {
  /** Unchanged since Plainva wrote them: removed. */
  removed: string[];
  /** Changed since: kept, and forgotten. */
  kept: string[];
  /** No longer there: forgotten. */
  forgotten: string[];
  /** Open right now: left alone, still remembered. */
  open: string[];
}

/**
 * Finishes what an app that went away while an entry was open left behind —
 * see the module comment. A step that fails (a file that cannot be read or
 * removed right now) leaves the draft remembered, so the next sweep tries
 * again; nothing is guessed.
 */
export async function sweepPinboardDrafts(files: PinboardDraftSweepFiles, ledger: PinboardDraftLedger): Promise<PinboardDraftSweep> {
  const result: PinboardDraftSweep = { removed: [], kept: [], forgotten: [], open: [] };
  for (const entry of ledger.list()) {
    try {
      if (await ledger.isOpen(entry.path)) {
        result.open.push(entry.path);
        continue;
      }
      if (!(await files.exists(entry.path))) {
        ledger.forget(entry.path);
        result.forgotten.push(entry.path);
        continue;
      }
      const bytes = await files.readBytes(entry.path);
      if (pinboardDraftHash(bytes) !== entry.sha256) {
        ledger.forget(entry.path);
        result.kept.push(entry.path);
        continue;
      }
      // Looked at once more right before the delete: an entry could have
      // opened it while the file was read.
      if (await ledger.isOpen(entry.path)) {
        result.open.push(entry.path);
        continue;
      }
      await files.remove(entry.path);
      ledger.forget(entry.path);
      result.removed.push(entry.path);
    } catch {
      /* stays remembered — the next sweep tries again */
    }
  }
  return result;
}
