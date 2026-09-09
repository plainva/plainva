import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, remove, stat } from "@tauri-apps/plugin-fs";
import { isOwnerWindow } from "./windowContext";
import { getWindowBus } from "./windowBus";

/**
 * Crash/draft recovery journal (hardening plan P2.4). While a note is dirty,
 * the editor snapshots the buffer here (debounced ~2 s); a successful save
 * clears the entry. On opening a file, a surviving journal entry whose text
 * differs from the disk content is offered in a banner ("restore draft?").
 *
 * Honest scope: this narrows the loss window of a hard crash to roughly the
 * snapshot debounce and makes save failures RECOVERABLE and VISIBLE — it is
 * not a zero-loss guarantee.
 *
 * Storage: <appData>/drafts/<vaultHash>/<noteHash>.json — deliberately
 * OUTSIDE the vault (never synced, never in vault backups). Written through
 * the atomic write command (a torn journal would defeat its purpose).
 * Entries carry a monotonic revision: a save only clears the journal if no
 * NEWER snapshot was taken meanwhile (latest wins). Retention: entries older
 * than 7 days are pruned on vault open. "Forget app data" (vaultForget)
 * removes the vault's whole draft folder. Diagnostics exports never include
 * journal content (they only ever carry logs).
 */

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface DraftEntry {
  vaultPath: string;
  notePath: string;
  text: string;
  revision: number;
  savedAt: number;
  /** Revisions belong to one editor lifetime, including auxiliary windows. */
  sessionId?: string;
}

function decodeDrafts(text: string): DraftEntry[] {
  const value = JSON.parse(text) as DraftEntry | { version: number; entries: DraftEntry[] };
  const entries = "entries" in value && value.version === 2 ? value.entries : [value as DraftEntry];
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry?.text !== "string"
    || typeof entry.revision !== "number" || typeof entry.savedAt !== "number")) throw new Error("Invalid draft journal");
  return entries;
}

const sessionOf = (entry: DraftEntry) => entry.sessionId ?? "legacy";

/** FNV-1a 64-bit hex — a stable file-name handle, not a security boundary. */
export function pathHash(input: string): string {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    lo ^= input.charCodeAt(i);
    // 64-bit FNV prime multiply, split into two 32-bit halves.
    const loNew = (lo >>> 0) * 0x1b3 + (((hi >>> 0) * 0x1b3) % 0x100000000) * 0x100000000;
    hi = Math.floor(loNew / 0x100000000) % 0x100000000;
    lo = loNew % 0x100000000;
  }
  return ((hi >>> 0).toString(16).padStart(8, "0") + (lo >>> 0).toString(16).padStart(8, "0"));
}

let draftsRootPromise: Promise<{ dir: string; rootId: string }> | null = null;

/**
 * Where the journal lives — without creating anything.
 *
 * Split from `draftsRoot()` for the auxiliary windows (multi-window P1): they
 * READ drafts locally, and creating the directory is an fs write their
 * capability deliberately withholds. Nothing to read means nothing to create.
 */
async function draftsDir(): Promise<string> {
  return join(await appDataDir(), "drafts");
}

async function draftsRoot(): Promise<{ dir: string; rootId: string }> {
  if (!draftsRootPromise) {
    draftsRootPromise = (async () => {
      const dir = await draftsDir();
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const rootId = await invoke<string>("register_write_root", { path: dir });
      return { dir, rootId };
    })().catch((e) => {
      draftsRootPromise = null;
      throw e;
    });
  }
  return draftsRootPromise;
}

function relFile(vaultPath: string, notePath: string): string {
  return `${pathHash(vaultPath)}/${pathHash(notePath)}.json`;
}

// Owner-window operations share one lane per vault/document. A delayed
// clear must finish before a later atomic snapshot replaces the same file.
const lanes = new Map<string, Promise<void>>();
function serial(file: string, work: () => Promise<void>): Promise<void> {
  const run = (lanes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(file, run);
  void run.then(() => { if (lanes.get(file) === run) lanes.delete(file); },
    () => { if (lanes.get(file) === run) lanes.delete(file); });
  return run;
}

export async function recordDraft(
  vaultPath: string,
  notePath: string,
  text: string,
  revision: number,
  sessionId = "legacy",
): Promise<void> {
  // An auxiliary window hands its snapshots to the owner, like every other
  // write. Not a restriction but the same rule: one window owns the disk. The
  // crash story is unchanged — a crash takes the whole process with it, and the
  // owner's journal covers the drafts of every window in it.
  if (!isOwnerWindow()) {
    const bus = await getWindowBus();
    await bus.request("draft-record", { vaultPath, notePath, text, revision, sessionId });
    return;
  }
  await serial(relFile(vaultPath, notePath), async () => {
    const { dir, rootId } = await draftsRoot();
    const file = await join(dir, relFile(vaultPath, notePath));
    const entries = (await exists(file)) ? decodeDrafts(await readTextFile(file)) : [];
    const previous = entries.find((entry) => sessionOf(entry) === sessionId);
    if (previous && previous.revision > revision) return;
    const entry: DraftEntry = { vaultPath, notePath, text, revision, sessionId, savedAt: Date.now() };
    await invoke("write_file_atomic", {
      rootId,
      relPath: relFile(vaultPath, notePath),
      contents: JSON.stringify({ version: 2, entries: [...entries.filter((draft) => sessionOf(draft) !== sessionId), entry] }),
      encoding: "utf8",
    });
  });
}

export async function readDraft(
  vaultPath: string,
  notePath: string,
  diskText?: string,
): Promise<DraftEntry | null> {
  try {
    const file = await join(await draftsDir(), pathHash(vaultPath), `${pathHash(notePath)}.json`);
    if (!(await exists(file))) return null;
    const entries = decodeDrafts(await readTextFile(file));
    return entries.filter((entry) => diskText === undefined || entry.text !== diskText)
      .sort((a, b) => b.savedAt - a.savedAt || sessionOf(a).localeCompare(sessionOf(b)))[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Clears the journal entry — but only if no snapshot NEWER than
 * `upToRevision` was written meanwhile (latest wins). `Infinity` forces.
 */
export async function clearDraft(
  vaultPath: string,
  notePath: string,
  upToRevision: number,
  sessionId = "legacy",
): Promise<void> {
  if (!isOwnerWindow()) {
    // `Infinity` does not survive JSON — null carries "force" over the bus.
    const bus = await getWindowBus();
    await bus
      .request("draft-clear", {
        vaultPath,
        notePath,
        upToRevision: Number.isFinite(upToRevision) ? upToRevision : null,
        sessionId,
      })
      .catch(() => {
        /* best-effort, same as the local path below */
      });
    return;
  }
  await serial(relFile(vaultPath, notePath), async () => {
    try {
      const file = await join(await draftsDir(), pathHash(vaultPath), `${pathHash(notePath)}.json`);
      if (!(await exists(file))) return;
      const entries = decodeDrafts(await readTextFile(file));
      const remaining = entries.filter((entry) => sessionOf(entry) !== sessionId || entry.revision > upToRevision);
      if (remaining.length === entries.length) return;
      if (remaining.length === 0) await remove(file);
      else {
        const { rootId } = await draftsRoot();
        await invoke("write_file_atomic", { rootId, relPath: relFile(vaultPath, notePath),
          contents: JSON.stringify({ version: 2, entries: remaining }), encoding: "utf8" });
      }
    } catch {
      // best-effort — a stale journal entry is annoying, not dangerous
    }
  });
}

/** Removes entries older than the retention window (called on vault open). */
export async function pruneDrafts(vaultPath: string): Promise<void> {
  try {
    const { dir } = await draftsRoot();
    const vaultDir = await join(dir, pathHash(vaultPath));
    if (!(await exists(vaultDir))) return;
    const entries = await readDir(vaultDir);
    const cutoff = Date.now() - RETENTION_MS;
    for (const e of entries) {
      if (e.isDirectory || !e.name) continue;
      const file = await join(vaultDir, e.name);
      await serial(`${pathHash(vaultPath)}/${e.name}`, async () => {
        try {
          const s = await stat(file);
          if ((s.mtime?.getTime() ?? 0) < cutoff) await remove(file);
        } catch {
          /* skip unreadable entries */
        }
      });
    }
  } catch {
    /* best-effort */
  }
}

/** Removes ALL drafts of a vault — wired into "forget app data". */
export async function removeVaultDrafts(vaultPath: string): Promise<void> {
  try {
    const dir = await join(await appDataDir(), "drafts", pathHash(vaultPath));
    if (await exists(dir)) await remove(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
}
