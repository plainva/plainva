import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import { pathHash } from "./draftJournal";

/**
 * The marker that says an OKF conversion is open.
 *
 * The phone got this first (parity plan P8), for a reason that reads as
 * mobile-specific and is not: a conversion writes into EVERY note of a vault,
 * and a run that dies at note 300 of 500 leaves a vault where some notes carry
 * the OKF fields and some do not — with nothing anywhere saying so. The next
 * start looks completely normal. Being killed out of the background is simply
 * the everyday way a run ends on a phone; a desktop that loses power, gets
 * force-quit or hits a crash mid-run leaves exactly the same vault, only less
 * often. "Less often" is not "recoverable".
 *
 * Two properties make this a journal rather than a variable, both taken from
 * `draftJournal.ts`, which solved the same problem for unsaved editor text:
 *
 * 1. It reaches the disk BEFORE the first change, through `write_file_atomic`
 *    (write to a temp file, fsync, atomic rename), so a process that dies
 *    mid-run leaves a complete marker rather than a torn one.
 * 2. It lives in appData, OUTSIDE the vault — never synced, never in a vault
 *    backup, so a half state cannot travel to another device.
 *
 * What it does NOT carry is the list of converted files, and that is the
 * point: `runOkfConversion` copies a file's ORIGINAL content into the run's
 * backup folder immediately before overwriting it, so the backup folder
 * already IS the complete record of what changed. The journal only has to say
 * "a run is open, and its backups are here" — one write at the start, one
 * delete at the end, rather than a write per note.
 *
 * A word on what an interrupted run leaves behind: an incomplete vault, not a
 * broken one. The conversion adds frontmatter keys and never touches the body,
 * so every note is valid Markdown before and after. That is why the recovery
 * ASKS instead of rolling back on its own — continuing is usually what the
 * user wants.
 */

export interface OkfJournal {
  startedAt: string;
  /** The vault this run belongs to, so a stray journal can be recognised. */
  vaultPath: string;
  /** Vault-relative backup folder of the interrupted run. */
  backupDir: string;
  /** How many files the run set out to process, for the recovery wording. */
  total: number;
  /** The options the run started with, so continuing does not change its mind. */
  options: { defaultType: string; existingTypeStrategy?: "keep" | "rename"; renameTo?: string };
}

let journalRootPromise: Promise<{ dir: string; rootId: string }> | null = null;

async function journalRoot(): Promise<{ dir: string; rootId: string }> {
  if (!journalRootPromise) {
    journalRootPromise = (async () => {
      const dir = await join(await appDataDir(), "okf-journal");
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const rootId = await invoke<string>("register_write_root", { path: dir });
      return { dir, rootId };
    })().catch((e) => {
      journalRootPromise = null;
      throw e;
    });
  }
  return journalRootPromise;
}

/**
 * Durable, before the first change.
 *
 * Throws on failure, and the caller must let it: a run without a journal is
 * exactly the run nobody can recover from, so "no journal, no run" is the
 * whole point (fail-closed).
 */
export async function writeOkfJournal(journal: OkfJournal): Promise<void> {
  const { rootId } = await journalRoot();
  await invoke("write_file_atomic", {
    rootId,
    relPath: `${pathHash(journal.vaultPath)}.json`,
    contents: JSON.stringify(journal),
    encoding: "utf8",
  });
}

export async function clearOkfJournal(vaultPath: string): Promise<void> {
  try {
    const { dir } = await journalRoot();
    const file = await join(dir, `${pathHash(vaultPath)}.json`);
    if (await exists(file)) await remove(file);
  } catch {
    // Already gone, or never written — both mean there is nothing pending.
  }
}

export async function readOkfJournal(vaultPath: string): Promise<OkfJournal | null> {
  try {
    const { dir } = await journalRoot();
    const file = await join(dir, `${pathHash(vaultPath)}.json`);
    if (!(await exists(file))) return null;
    const parsed = JSON.parse(await readTextFile(file)) as OkfJournal;
    // Without a backup folder there is nothing to roll back to and nothing to
    // continue into; treat such a journal as absent rather than offer a
    // recovery that cannot work.
    return parsed?.backupDir && parsed?.options?.defaultType ? parsed : null;
  } catch {
    return null;
  }
}
