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

const lastWrite = new Map<string, number>();
const pendingText = new Map<string, string>();
const pendingRevision = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function draftFile(v: MobileVault, path: string): string {
  // URL-safe base64 keeps arbitrary note paths inside one flat folder.
  const key = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_");
  return `drafts/${v.vaultId}/${key}.json`;
}

async function persist(v: MobileVault, path: string): Promise<void> {
  const text = pendingText.get(path);
  if (text === undefined) return;
  const revision = pendingRevision.get(path) ?? 0;
  pendingText.delete(path);
  try {
    await atomicWriteText(
      draftFile(v, path),
      JSON.stringify({ path, text, ts: Date.now(), revision } satisfies NoteDraft),
    );
  } catch {
    /* best effort */
  }
}

/** Journals the text, throttled per note (the coordinator calls this on every schedule). */
export function writeDraft(v: MobileVault, path: string, text: string, revision = 0): void {
  pendingText.set(path, text);
  pendingRevision.set(path, revision);
  const now = Date.now();
  const last = lastWrite.get(path) ?? 0;
  if (now - last >= THROTTLE_MS) {
    lastWrite.set(path, now);
    void persist(v, path);
    return;
  }
  if (!timers.has(path)) {
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        lastWrite.set(path, Date.now());
        void persist(v, path);
      }, THROTTLE_MS),
    );
  }
}

/**
 * A confirmed write drops the draft — but only up to `upToRevision`.
 *
 * Typing while a save is in flight journals a NEWER text; deleting it on the
 * confirmation of the older one would throw away exactly the keystrokes the
 * journal exists for. `Infinity` forces (the "discard" button means it).
 */
export function clearDraft(v: MobileVault, path: string, upToRevision = Infinity): void {
  const pending = pendingRevision.get(path);
  if (pending !== undefined && pending > upToRevision) return;

  pendingText.delete(path);
  pendingRevision.delete(path);
  const timer = timers.get(path);
  if (timer) {
    clearTimeout(timer);
    timers.delete(path);
  }
  void (async () => {
    try {
      if (upToRevision !== Infinity) {
        const stored = await readDraftFile(v, path);
        if (stored && typeof stored.revision === "number" && stored.revision > upToRevision) return;
      }
      await Filesystem.deleteFile({ path: draftFile(v, path), directory: Directory.Data });
    } catch {
      /* nothing to drop */
    }
  })();
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
        await Filesystem.deleteFile({
          path: `drafts/${v.vaultId}/${f.name}`,
          directory: Directory.Data,
        }).catch(() => {});
      }
    }
  } catch {
    /* no drafts folder yet */
  }
}
