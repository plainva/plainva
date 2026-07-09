import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import type { Store } from "@tauri-apps/plugin-store";
import { format } from "date-fns";
import {
  DEFAULT_ZIP_KEEP,
  ZIP_EXCLUDED_DIR_NAMES,
  backupZipDestKey,
  backupZipKeepKey,
  backupZipLastRunKey,
  defaultZipDestination,
  sanitizeFileName,
  vaultFolderName,
} from "./backupPolicy";

export interface ZipRunOutcome {
  ok: boolean;
  zipPath?: string;
  fileCount?: number;
  skipped?: string[];
  error?: string;
}

interface RustZipResult {
  zip_path: string;
  file_count: number;
  total_bytes: number;
  skipped: string[];
}

export function buildZipFileName(vaultName: string, when: Date): string {
  return `${sanitizeFileName(vaultName)}_${format(when, "yyyy-MM-dd_HH-mm-ss")}.zip`;
}

/** Strict name pattern of OUR zips for a vault — protects foreign files in a
 *  user-chosen destination (rotation + the forget-vault cleanup share it). */
export function zipNamePattern(vaultName: string): RegExp {
  const esc = sanitizeFileName(vaultName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.zip$`);
}

/**
 * Returns the file names to delete so at most `keep` of OUR zips remain.
 * The strict pattern protects foreign files in a user-chosen destination.
 * The timestamp format sorts lexicographically, oldest first.
 */
export function selectZipsToDelete(fileNames: string[], vaultName: string, keep: number): string[] {
  const pattern = zipNamePattern(vaultName);
  const matching = fileNames.filter((n) => pattern.test(n)).sort();
  const effectiveKeep = Math.max(1, keep);
  if (matching.length <= effectiveKeep) return [];
  return matching.slice(0, matching.length - effectiveKeep);
}

let zipRunning = false;
export function isZipRunning(): boolean {
  return zipRunning;
}

export type ZipStatusState = "running" | "done" | "error";

function emitStatus(vaultPath: string, detail: Record<string, unknown> & { state: ZipStatusState }): void {
  window.dispatchEvent(new CustomEvent("plainva-backup-zip-status", { detail: { vaultPath, ...detail } }));
}

/**
 * Runs one full vault ZIP backup: resolve destination (custom or app-data
 * default), invoke the Rust command, rotate to keep-N, persist lastRun.
 * An unreachable destination (NAS offline) returns `{ok:false}` WITHOUT
 * touching lastRun, so the scheduler retries on its next tick.
 */
export async function runVaultZipBackup(opts: { vaultPath: string; store: Store }): Promise<ZipRunOutcome> {
  if (zipRunning) return { ok: false, error: "already-running" };
  zipRunning = true;
  const { vaultPath, store } = opts;
  try {
    const customDest = ((await store.get<string>(backupZipDestKey(vaultPath))) ?? "").trim();
    const destDir = customDest || (await defaultZipDestination(vaultPath));
    try {
      await mkdir(destDir, { recursive: true });
    } catch {
      // mkdir may reject if it already exists depending on backend; verified below.
    }
    if (!(await exists(destDir))) {
      throw new Error(destDir);
    }

    const vaultName = vaultFolderName(vaultPath);
    const destPath = await join(destDir, buildZipFileName(vaultName, new Date()));
    emitStatus(vaultPath, { state: "running" });

    const result = await invoke<RustZipResult>("create_vault_zip", {
      vaultPath,
      destPath,
      excludeDirNames: ZIP_EXCLUDED_DIR_NAMES,
    });

    const keep = (await store.get<number>(backupZipKeepKey(vaultPath))) ?? DEFAULT_ZIP_KEEP;
    try {
      const entries = await readDir(destDir);
      const names = entries.filter((e) => !e.isDirectory && e.name).map((e) => e.name as string);
      for (const stale of selectZipsToDelete(names, vaultName, keep)) {
        await remove(await join(destDir, stale));
      }
    } catch (e) {
      console.warn("[vaultZipBackup] rotation failed", e);
    }

    await store.set(backupZipLastRunKey(vaultPath), Date.now());
    await store.save();

    emitStatus(vaultPath, {
      state: "done",
      zipPath: result.zip_path,
      fileCount: result.file_count,
      skipped: result.skipped,
    });
    return { ok: true, zipPath: result.zip_path, fileCount: result.file_count, skipped: result.skipped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emitStatus(vaultPath, { state: "error", message });
    return { ok: false, error: message };
  } finally {
    zipRunning = false;
  }
}
