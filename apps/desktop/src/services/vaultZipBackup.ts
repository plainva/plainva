import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import type { ISettingsStore } from "@plainva/ui";
import {
  DEFAULT_ZIP_KEEP,
  ZIP_EXCLUDED_DIR_NAMES,
  backupZipDestKey,
  backupZipKeepKey,
  backupZipLastRunKey,
  defaultZipDestination,
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

/* Naming and pruning are shared with the phone since S36 (see @plainva/ui). */
export { buildZipFileName, selectZipsToDelete, zipNamePattern } from "@plainva/ui";
import { buildZipFileName, selectZipsToDelete } from "@plainva/ui";

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
export async function runVaultZipBackup(opts: { vaultPath: string; store: ISettingsStore }): Promise<ZipRunOutcome> {
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
