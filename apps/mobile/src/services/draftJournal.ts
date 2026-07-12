import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { MobileVault } from "./vaultService";

/**
 * Mobile draft journal (M3E package G, desktop P2 counterpart): every
 * scheduled note save also lands as a crash-safe draft OUTSIDE the vault
 * (drafts/ never syncs). A confirmed write clears its draft; on the next
 * open of the note a draft that is newer than the file offers recovery.
 * Everything is best-effort — a journal hiccup must never block typing.
 */

export interface NoteDraft {
  path: string;
  text: string;
  ts: number;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 400;

const lastWrite = new Map<string, number>();
const pendingText = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function draftFile(v: MobileVault, path: string): string {
  // URL-safe base64 keeps arbitrary note paths inside one flat folder.
  const key = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_");
  return `drafts/${v.vaultId}/${key}.json`;
}

async function persist(v: MobileVault, path: string): Promise<void> {
  const text = pendingText.get(path);
  if (text === undefined) return;
  pendingText.delete(path);
  try {
    await Filesystem.writeFile({
      path: draftFile(v, path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
      data: JSON.stringify({ path, text, ts: Date.now() } satisfies NoteDraft),
    });
  } catch {
    /* best effort */
  }
}

/** Journals the text, throttled per note (the coordinator calls this on every schedule). */
export function writeDraft(v: MobileVault, path: string, text: string): void {
  pendingText.set(path, text);
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

/** A confirmed write drops the draft (the disk is now at least as new). */
export function clearDraft(v: MobileVault, path: string): void {
  pendingText.delete(path);
  const timer = timers.get(path);
  if (timer) {
    clearTimeout(timer);
    timers.delete(path);
  }
  void Filesystem.deleteFile({ path: draftFile(v, path), directory: Directory.Data }).catch(() => {
    /* nothing to drop */
  });
}

const pruned = new Set<string>();

/** Draft for this note, or null. Prunes stale drafts once per vault session. */
export async function readDraft(v: MobileVault, path: string): Promise<NoteDraft | null> {
  if (!pruned.has(v.vaultId)) {
    pruned.add(v.vaultId);
    void pruneDrafts(v);
  }
  try {
    const res = await Filesystem.readFile({
      path: draftFile(v, path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(String(res.data));
    if (parsed && typeof parsed.text === "string" && typeof parsed.ts === "number") {
      return { path, text: parsed.text, ts: parsed.ts };
    }
  } catch {
    /* no draft */
  }
  return null;
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
