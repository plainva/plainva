import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { atomicWriteText } from "../platform/atomicFile";
import type { MobileVault } from "./vaultService";

/**
 * Mobile draft journal (M3E package G, desktop P2 counterpart): every
 * scheduled note save also lands as a crash-safe draft OUTSIDE the vault
 * (drafts/ never syncs). A confirmed write clears its draft; on the next
 * open of the note a draft that is newer than the file offers recovery.
 * Everything is best-effort — a journal hiccup must never block typing.
 *
 * Two properties are not cosmetic (finding 2026-08-19, desktop parity):
 *
 * 1. The draft is written through `atomicWriteText`, not a plain file write.
 *    A journal that can be torn by the very crash it exists for is no safety
 *    net; the native plugin fsyncs and renames into place.
 * 2. Entries carry the coordinator's monotonic REVISION, and a confirmed write
 *    only clears the draft when nothing newer was journalled meanwhile. Without
 *    it, typing on while a save is in flight loses exactly those keystrokes:
 *    the confirmation would delete the newer draft.
 */

export interface NoteDraft {
  path: string;
  text: string;
  ts: number;
  /** Coordinator revision this text belongs to; older journals have none. */
  revision?: number;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 400;

interface PendingDraft {
  v: MobileVault;
  path: string;
  text: string;
  revision: number;
  generation: number;
}
const lastWrite = new Map<string, number>();
const pendingDrafts = new Map<string, PendingDraft>();
const generations = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lanes = new Map<string, Promise<void>>();

function draftFile(v: MobileVault, path: string): string {
  const key = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_");
  return `drafts/${v.vaultId}/${key}.json`;
}

function serial(file: string, work: () => Promise<void>): Promise<void> {
  const run = (lanes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(file, run);
  void run.then(() => { if (lanes.get(file) === run) lanes.delete(file); },
    () => { if (lanes.get(file) === run) lanes.delete(file); });
  return run;
}

function cancelTimer(file: string): void {
  const timer = timers.get(file);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(file);
}

function schedulePersist(file: string, delay: number): void {
  if (timers.has(file)) return;
  timers.set(file, setTimeout(() => {
    timers.delete(file);
    void persist(file);
  }, delay));
}

function persist(file: string): Promise<void> {
  return serial(file, async () => {
    const pending = pendingDrafts.get(file);
    if (!pending) return;
    lastWrite.set(file, Date.now());
    try {
      const { path, text, revision } = pending;
      await atomicWriteText(
        file,
        JSON.stringify({ path, text, ts: Date.now(), revision } satisfies NoteDraft),
      );
      // Native acknowledgement covers THIS snapshot, not keystrokes that
      // arrived while it was writing. A failed write keeps its pending text.
      if (pendingDrafts.get(file) === pending) pendingDrafts.delete(file);
    } catch {
      schedulePersist(file, 2000);
    }
  });
}

/** Throttled per vault/document, independently of editor lifetime. */
export function writeDraft(v: MobileVault, path: string, text: string, revision = 0): void {
  const file = draftFile(v, path);
  const generation = (generations.get(file) ?? 0) + 1;
  generations.set(file, generation);
  pendingDrafts.set(file, { v, path, text, revision, generation });
  if (Date.now() - (lastWrite.get(file) ?? 0) >= THROTTLE_MS) {
    cancelTimer(file);
    void persist(file);
  } else {
    schedulePersist(file, THROTTLE_MS);
  }
}

/** Attempt all buffered journal snapshots before the OS suspends timers. */
export async function flushDrafts(v?: MobileVault): Promise<void> {
  const selected = [...pendingDrafts].filter(([, pending]) => !v || pending.v.vaultId === v.vaultId);
  await Promise.all(selected.map(([file]) => { cancelTimer(file); return persist(file); }));
}

/** Clear only the confirmed revision, ordered with all writes to this file.
 * Manual discard covers the generation present at the call, never later input. */
export function clearDraft(v: MobileVault, path: string, upToRevision = Infinity): void {
  const file = draftFile(v, path);
  const generation = generations.get(file) ?? 0;
  const stillCovered = () => {
    const pending = pendingDrafts.get(file);
    return (generations.get(file) ?? 0) === generation &&
      (!pending || pending.revision <= upToRevision);
  };
  void serial(file, async () => {
    if (!stillCovered()) return;
    try {
      if (upToRevision !== Infinity) {
        // Do not treat a permission/read/parse failure as an empty journal.
        const res = await Filesystem.readFile({ path: file, directory: Directory.Data, encoding: Encoding.UTF8 });
        const stored = JSON.parse(String(res.data)) as NoteDraft;
        if (typeof stored.revision !== "number" || stored.revision > upToRevision) return;
      }
      if (!stillCovered()) return;
      cancelTimer(file);
      pendingDrafts.delete(file);
      await Filesystem.deleteFile({ path: file, directory: Directory.Data });
    } catch {
      // Keeping a recoverable draft is safer than guessing that a read failed
      // because no newer version exists.
    }
  }).catch(() => {});
}

/** The journal entry as it sits on disk, without the retention sweep. */
async function readDraftFile(v: MobileVault, path: string): Promise<NoteDraft | null> {
  try {
    const res = await Filesystem.readFile({
      path: draftFile(v, path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(String(res.data));
    if (parsed && typeof parsed.text === "string" && typeof parsed.ts === "number") {
      return { path, text: parsed.text, ts: parsed.ts, revision: parsed.revision };
    }
  } catch {
    /* no draft */
  }
  return null;
}

const pruned = new Set<string>();

/** Draft for this note, or null. Prunes stale drafts once per vault session. */
export async function readDraft(v: MobileVault, path: string): Promise<NoteDraft | null> {
  if (!pruned.has(v.vaultId)) {
    pruned.add(v.vaultId);
    void pruneDrafts(v);
  }
  return readDraftFile(v, path);
}

/** Boot hygiene: drafts older than the retention window disappear. */
export async function pruneDrafts(v: MobileVault): Promise<void> {
  try {
    const dir = await Filesystem.readdir({ path: `drafts/${v.vaultId}`, directory: Directory.Data });
    const cutoff = Date.now() - RETENTION_MS;
    for (const f of dir.files) {
      if (f.type === "file" && typeof f.mtime === "number" && f.mtime < cutoff) {
        const file = `drafts/${v.vaultId}/${f.name}`;
        await serial(file, async () => {
          if (pendingDrafts.has(file)) return;
          try {
            // The directory snapshot can predate a fresh atomic write.
            const res = await Filesystem.readFile({ path: file, directory: Directory.Data, encoding: Encoding.UTF8 });
            const stored = JSON.parse(String(res.data)) as NoteDraft;
            if (pendingDrafts.has(file) || typeof stored.ts !== "number" || stored.ts >= cutoff) return;
            await Filesystem.deleteFile({ path: file, directory: Directory.Data });
          } catch { /* retain unreadable snapshots */ }
        });
      }
    }
  } catch {
    /* no drafts folder yet */
  }
}
