import { Store } from "@tauri-apps/plugin-store";
import {
  scanOkfConformance,
  convertFileToOkf,
  classifyOkfFile,
  type OkfScanResult,
  type OkfConversionOptions,
  type VaultQueryService,
} from "@plainva/core";
import { STORE_KEY, templateFolderKey } from "../contexts/VaultContext";

/**
 * Desktop orchestration of the OKF conversion (Gesamtplan W6): scan the vault
 * via the index, convert files with surgical edits, back up every changed
 * file first, validate after, and never abort the whole run on a single bad
 * file (skip + report instead).
 */

export interface OkfConversionAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export async function scanVaultOkf(opts: {
  vaultPath: string;
  queryService: VaultQueryService;
  adapter: Pick<OkfConversionAdapter, "readTextFile">;
}): Promise<OkfScanResult> {
  const store = await Store.load(STORE_KEY);
  const templateFolder = (await store.get<string>(templateFolderKey(opts.vaultPath))) || "Templates";
  const rows = await opts.queryService.db.query<{ path: string }>(
    `SELECT path FROM files WHERE mode != 'attachment'`
  );
  return scanOkfConformance({
    paths: rows.map((r) => r.path),
    readTextFile: (p) => opts.adapter.readTextFile(p),
    excludeFolders: [templateFolder],
  });
}

export interface OkfConversionSample {
  path: string;
  before: string;
  after: string;
}

export interface OkfRunReport {
  changed: string[];
  unchanged: number;
  skipped: { path: string; error: string }[];
  /** Vault-relative backup folder (empty for dry runs). */
  backupDir: string;
  samples: OkfConversionSample[];
  cancelled: boolean;
}

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function frontmatterPreview(content: string): string {
  const match = content.match(FM_RE);
  return match ? match[0].trimEnd() : "";
}

async function ensureDirs(adapter: OkfConversionAdapter, dirPath: string, created?: Set<string>): Promise<void> {
  const parts = dirPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    // Per-run cache (WP4): a 500-file conversion re-checked the same backup dir
    // segments for every file — one exists()/createDir() IPC pair each. Skip
    // segments we already ensured this run.
    if (created?.has(current)) continue;
    if (!(await adapter.exists(current))) {
      await adapter.createDir(current);
    }
    created?.add(current);
  }
}

export async function runOkfConversion(opts: {
  adapter: OkfConversionAdapter;
  scan: OkfScanResult;
  options: OkfConversionOptions;
  dryRun?: boolean;
  sampleLimit?: number;
  onProgress?: (done: number, total: number, path: string) => void;
  isCancelled?: () => boolean;
}): Promise<OkfRunReport> {
  const { adapter, scan, options, dryRun = false } = opts;
  const sampleLimit = opts.sampleLimit ?? 5;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = dryRun ? "" : `.plainva/backups/okf-conversion-${stamp}`;

  const report: OkfRunReport = {
    changed: [],
    unchanged: 0,
    skipped: [],
    backupDir,
    samples: [],
    cancelled: false,
  };

  const total = scan.convertiblePaths.length;
  let done = 0;
  const createdDirs = new Set<string>(); // per-run ensureDirs cache (WP4)

  for (const path of scan.convertiblePaths) {
    if (opts.isCancelled?.()) {
      report.cancelled = true;
      break;
    }
    try {
      const content = await adapter.readTextFile(path);
      const result = convertFileToOkf(content, options);
      if (!result.changed) {
        report.unchanged++;
      } else if (classifyOkfFile(path, result.content) !== null) {
        // Post-write validation failed — never write a file we made worse.
        report.skipped.push({ path, error: "validation failed after conversion" });
      } else {
        if (report.samples.length < sampleLimit) {
          report.samples.push({
            path,
            before: frontmatterPreview(content),
            after: frontmatterPreview(result.content),
          });
        }
        if (!dryRun) {
          const backupPath = `${backupDir}/${path}`;
          await ensureDirs(adapter, backupPath.split("/").slice(0, -1).join("/"), createdDirs);
          await adapter.writeTextFile(backupPath, content);
          await adapter.writeTextFile(path, result.content);
        }
        report.changed.push(path);
      }
    } catch (e) {
      report.skipped.push({ path, error: e instanceof Error ? e.message : String(e) });
    }
    done++;
    opts.onProgress?.(done, total, path);
  }

  return report;
}
