import {
  convertFileToOkf,
  classifyOkfFile,
  type OkfScanResult,
  type OkfConversionOptions,
} from "@plainva/core";

/**
 * Running an OKF conversion over a vault (Gesamtplan W6, lifted in P8).
 *
 * Convert files with surgical edits, back up every changed file first,
 * validate after, and never abort the whole run on a single bad file (skip and
 * report instead). The per-file conversion itself lives in core; what is here
 * is the run: ordering, backups, cancellation and the report.
 *
 * Everything below is expressed over `OkfConversionAdapter`, so the shell only
 * has to bring a file API. WHICH paths get converted is the caller's business
 * — the desktop scans through its index, the phone through its own — but once
 * a scan exists, both shells run it the same way, and the desktop's unchanged
 * tests are the proof that lifting it changed nothing.
 */

export interface OkfConversionAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /**
   * Recursive walk, needed only by `rollbackOkfConversion`.
   *
   * Optional so a caller that never rolls back — a dry run, a test fake — does
   * not have to bring one. The shape is `IVaultAdapter.listDir`'s, because
   * that is what both shells already hand in.
   */
  listDir?(path?: string, recursive?: boolean): Promise<Array<{ path: string; isDirectory: boolean }>>;
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
  /** Parallel file workers (default 8). Overlaps I/O latency on network drives. */
  concurrency?: number;
  /**
   * Where the originals go, when the caller has to name it.
   *
   * Passed in to CONTINUE an interrupted run into the folder the first pass
   * already used: one undo then covers everything both passes touched, which
   * two folders could not. Left out, the run makes its own stamped folder.
   */
  backupDir?: string;
}): Promise<OkfRunReport> {
  const { adapter, scan, options, dryRun = false } = opts;
  const sampleLimit = opts.sampleLimit ?? 5;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = dryRun ? "" : opts.backupDir ?? `.plainva/backups/okf-conversion-${stamp}`;

  const report: OkfRunReport = {
    changed: [],
    unchanged: 0,
    skipped: [],
    backupDir,
    samples: [],
    cancelled: false,
  };

  const paths = scan.convertiblePaths;
  const total = paths.length;
  let done = 0;
  const createdDirs = new Set<string>(); // per-run ensureDirs cache (WP4)
  let cancelled = false;

  const processOne = async (path: string): Promise<void> => {
    const content = await adapter.readTextFile(path);
    const result = convertFileToOkf(content, options);
    if (!result.changed) {
      report.unchanged++;
      return;
    }
    if (classifyOkfFile(path, result.content) !== null) {
      // Post-write validation failed — never write a file we made worse.
      report.skipped.push({ path, error: "validation failed after conversion" });
      return;
    }
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
  };

  // Bounded concurrency: the previous sequential loop did one network round-trip
  // after another, which is brutal for a 500+ file vault on a network drive.
  // Each file's work is independent (read -> convert -> backup -> write); a small
  // worker pool overlaps the latency. ensureDirs' createdDirs cache is safe under
  // concurrency (single-threaded JS; createDir is idempotent/recursive), and the
  // report arrays are appended atomically between awaits.
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (cancelled || opts.isCancelled?.()) { cancelled = true; return; }
      const i = next++;
      if (i >= paths.length) return;
      const path = paths[i];
      try {
        await processOne(path);
      } catch (e) {
        report.skipped.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
      done++;
      opts.onProgress?.(done, total, path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()));
  report.cancelled = cancelled;

  return report;
}

/**
 * Puts every file a run backed up back where it came from.
 *
 * The backup folder is the complete record of the run: `runOkfConversion`
 * writes the ORIGINAL content of a file there immediately before overwriting
 * it, so "restore everything under `backupDir` to its vault path" undoes
 * exactly the set of files the run changed — no journal of names needed, and
 * a run that was interrupted halfway rolls back just as cleanly as one that
 * finished.
 *
 * Deliberately NOT deleted afterwards. The backup folder is the only copy of
 * the pre-conversion state; removing it as part of an undo would leave the
 * user with no second chance if the undo itself was the mistake. It ages out
 * with the rest of `.plainva/backups` like every other snapshot.
 */
export async function rollbackOkfConversion(
  adapter: OkfConversionAdapter,
  backupDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<OkfRollbackReport> {
  const report: OkfRollbackReport = { restored: [], failed: [] };
  if (!adapter.listDir) throw new Error("adapter cannot list directories");
  if (!(await adapter.exists(backupDir))) return report;

  const prefix = `${backupDir}/`;
  const entries = (await adapter.listDir(backupDir, true)).filter((e) => !e.isDirectory);
  let done = 0;
  for (const entry of entries) {
    // The backup mirrors the vault layout beneath `backupDir`, so the original
    // path is the entry's path with that prefix removed.
    const target = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : null;
    if (!target) {
      report.failed.push({ path: entry.path, error: "not under the backup folder" });
      done++;
      onProgress?.(done, entries.length);
      continue;
    }
    try {
      await adapter.writeTextFile(target, await adapter.readTextFile(entry.path));
      report.restored.push(target);
    } catch (e) {
      report.failed.push({ path: target, error: e instanceof Error ? e.message : String(e) });
    }
    done++;
    onProgress?.(done, entries.length);
  }
  return report;
}

export interface OkfRollbackReport {
  restored: string[];
  failed: { path: string; error: string }[];
}
