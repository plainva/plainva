import {
  convertFileToOkf,
  classifyOkfFile,
  frontmatterSpan,
  migrateOkfFile,
  OKF_ROOT_INDEX_PATH,
  OpenConflictError,
  readRootOkfDeclaration,
  replaceVaultText,
  VaultFileNotFoundError,
  type OkfMigrateFileOptions,
  type OkfScanResult,
  type OkfConversionOptions,
  type OkfVersionState,
  type TextUpdateFiles,
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
 *
 * Since the OKF v0.2 plan (P2, 2026-08-21) the run is generic: `runOkfTransform`
 * takes any pure per-file transform, and the conformance conversion and the
 * bundle migration are two callers of it — one run, one backup grammar, one
 * rollback, whatever the edit is.
 */

/**
 * The vault's files: its chain, or a storage with nothing above it. A file is
 * replaced by what was made of exactly the text its backup holds
 * (`replaceVaultText`); the backup and what an undo puts back are written as
 * whole files.
 */
export interface OkfConversionAdapter extends TextUpdateFiles {
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
  /**
   * Removes a file. Used for one thing: a backup the run wrote for a file it
   * did not convert in the end (see `runOkfTransform`). Optional for the same
   * reason as the walk; both shells hand in the vault's chain, which has it.
   */
  deleteItem?(path: string): Promise<void>;
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

function frontmatterPreview(content: string): string {
  const block = frontmatterSpan(content);
  return block ? content.slice(0, block.end).trimEnd() : "";
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

/**
 * The generic run. `transform` is pure (content in, content out); `validate`
 * may veto a result AFTER the transform and BEFORE anything is written — a
 * file that comes out worse is skipped and reported, never written.
 */
export async function runOkfTransform(opts: {
  adapter: OkfConversionAdapter;
  paths: string[];
  transform: (path: string, content: string) => { content: string; changed: boolean };
  /** Returns an error text to skip the file, or null when the result may be written. */
  validate?: (path: string, before: string, after: string) => string | null;
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
  /** Batch-folder prefix for a run that names its own folder (default `okf-conversion`). */
  backupPrefix?: string;
}): Promise<OkfRunReport> {
  const { adapter, paths, transform, dryRun = false } = opts;
  const sampleLimit = opts.sampleLimit ?? 5;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = opts.backupPrefix ?? "okf-conversion";
  const backupDir = dryRun ? "" : opts.backupDir ?? `.plainva/backups/${prefix}-${stamp}`;

  const report: OkfRunReport = {
    changed: [],
    unchanged: 0,
    skipped: [],
    backupDir,
    samples: [],
    cancelled: false,
  };

  const total = paths.length;
  let done = 0;
  const createdDirs = new Set<string>(); // per-run ensureDirs cache (WP4)
  let cancelled = false;

  /** What a file's text comes to: the text to write, or why none is written. */
  type Verdict = { next: string } | { unchanged: true } | { veto: string };
  const judge = (path: string, content: string): Verdict => {
    const result = transform(path, content);
    if (!result.changed) return { unchanged: true };
    const veto = opts.validate?.(path, content, result.content) ?? null;
    // Post-write validation failed — never write a file we made worse.
    return veto !== null ? { veto } : { next: result.content };
  };

  const processOne = async (path: string): Promise<void> => {
    // The text that was judged last, what it came to, and the text this call's backup holds.
    const last: { content: string; verdict: Verdict; backedUp: string | null } = { content: "", verdict: { unchanged: true }, backedUp: null };
    if (dryRun) {
      // What the run itself answers (`replaceVaultText`): a file with an open
      // conflict is not converted, neither of its two texts.
      const open = await adapter.getConflictSession?.(path);
      if (open) throw new OpenConflictError(open.workingCopyPath);
      last.content = await adapter.readTextFile(path);
      last.verdict = judge(path, last.content);
    } else {
      const backupPath = `${backupDir}/${path}`;
      // An undo puts back whatever lies in the backup folder. So a backup this
      // call wrote must not stay there for a file the run did not convert — a
      // file that changed while it was prepared and then needed nothing, one
      // that was given up on, one that was moved away meanwhile: an undo would
      // bring the earlier text back over somebody's change, or the file back
      // to a place it left. It is removed. Where it cannot be — files that
      // cannot remove, a file written a moment ago and still held by a scanner
      // — it is brought to what the file reads (`now`), so that an undo
      // changes nothing.
      const dropBackup = async (now: string | null): Promise<void> => {
        const removed = adapter.deleteItem ? await adapter.deleteItem(backupPath).then(() => true, (error) => error instanceof VaultFileNotFoundError) : false;
        if (!removed && now !== null && now !== last.backedUp) await adapter.writeTextFile(backupPath, now);
      };
      // The backup holds exactly the text that is replaced, because the backup
      // is what an undo puts back: the file is written only if it still is the
      // text that was judged and backed up, and judged anew where somebody
      // changed it meanwhile (`replaceVaultText`). A file with an open conflict
      // is refused there and reported as skipped: resolve it, then run again.
      try {
        await replaceVaultText(adapter, path, async (content) => {
          last.content = content;
          last.verdict = judge(path, content);
          if (!("next" in last.verdict)) return null;
          await ensureDirs(adapter, backupPath.split("/").slice(0, -1).join("/"), createdDirs);
          await adapter.writeTextFile(backupPath, content);
          last.backedUp = content;
          return last.verdict.next;
        });
      } catch (error) {
        // Not converted, as far as this call knows — except where the file
        // reads what was made of the backed-up text: a write that failed after
        // it had reached the file. That backup is the file's original and stays.
        if (last.backedUp !== null) {
          const made = "next" in last.verdict && last.backedUp === last.content ? last.verdict.next : null;
          await (async () => {
            if (!(await adapter.exists(path))) return dropBackup(null);
            const now = await adapter.readTextFile(path);
            if (now !== made) await dropBackup(now);
          })().catch(() => undefined);
        }
        throw error;
      }
      if (last.backedUp !== null && !("next" in last.verdict)) await dropBackup(last.content);
    }
    const { content, verdict } = last;
    if ("unchanged" in verdict) {
      report.unchanged++;
      return;
    }
    if ("veto" in verdict) {
      report.skipped.push({ path, error: verdict.veto });
      return;
    }
    if (report.samples.length < sampleLimit) {
      report.samples.push({
        path,
        before: frontmatterPreview(content),
        after: frontmatterPreview(verdict.next),
      });
    }
    report.changed.push(path);
  };

  // Bounded concurrency: the previous sequential loop did one network round-trip
  // after another, which is brutal for a 500+ file vault on a network drive.
  // Each file's work is independent (read -> transform -> backup -> write); a small
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

/** The conformance conversion (type field, reserved names) as a transform run. */
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
  /** See `runOkfTransform` — continue an interrupted run into its folder. */
  backupDir?: string;
}): Promise<OkfRunReport> {
  const { scan, options, ...rest } = opts;
  return runOkfTransform({
    ...rest,
    paths: scan.convertiblePaths,
    transform: (_path, content) => convertFileToOkf(content, options),
    validate: (path, _before, after) =>
      classifyOkfFile(path, after) === null ? null : "validation failed after conversion",
    backupPrefix: "okf-conversion",
  });
}

/**
 * The bundle migration (OKF v0.2 plan, P2): the root `index.md` declares the
 * version Plainva writes, and — opt-in, D2 — the legacy per-note `okf_version`
 * key disappears. Which files to look at comes from `scanOkfVersionState`; the
 * per-file edit is `migrateOkfFile` from core.
 *
 * Validation: the root must still pass the conformance check afterwards (the
 * declaration line is the only thing that moved), and a note must not come
 * out worse than it went in (a note that already violated a rule is migrated
 * anyway — the key is gone, the violation stays the violation it was).
 */
export async function runOkfMigration(opts: {
  adapter: OkfConversionAdapter;
  state: OkfVersionState;
  stripNoteVersion: boolean;
  rootIndexPath?: string;
  dryRun?: boolean;
  sampleLimit?: number;
  onProgress?: (done: number, total: number, path: string) => void;
  isCancelled?: () => boolean;
  concurrency?: number;
  backupDir?: string;
}): Promise<OkfRunReport> {
  const { state, stripNoteVersion, ...rest } = opts;
  const rootIndexPath = opts.rootIndexPath ?? OKF_ROOT_INDEX_PATH;
  const paths: string[] = [];
  if (state.rootIndex.exists && state.rootIndex.declared !== null && !state.rootIndex.current) {
    paths.push(rootIndexPath);
  }
  if (stripNoteVersion) {
    for (const n of state.notesWithVersion) if (n.path !== rootIndexPath) paths.push(n.path);
  }
  const fileOptions: OkfMigrateFileOptions = {
    rootIndexPath,
    stripNoteVersion,
    targetVersion: state.targetVersion,
  };
  return runOkfTransform({
    ...rest,
    paths,
    transform: (path, content) => migrateOkfFile(path, content, fileOptions),
    validate: (path, before, after) => {
      if (path === rootIndexPath) {
        if (readRootOkfDeclaration(after) !== state.targetVersion) return "root declaration did not take";
        return classifyOkfFile(path, after) === null ? null : "validation failed after migration";
      }
      const wasValid = classifyOkfFile(path, before) === null;
      const isValid = classifyOkfFile(path, after) === null;
      return wasValid && !isValid ? "validation failed after migration" : null;
    },
    backupPrefix: "okf-migration",
  });
}

/**
 * Puts every file a run backed up back where it came from.
 *
 * The backup folder is the complete record of the run: `runOkfTransform`
 * writes the ORIGINAL content of a file there immediately before overwriting
 * it, so "restore everything under `backupDir` to its vault path" undoes
 * exactly the set of files the run changed — no journal of names needed, and
 * a run that was interrupted halfway rolls back just as cleanly as one that
 * finished. This is the undo of the conversion AND of the migration.
 *
 * A file the run prepared and did not convert in the end — it changed
 * meanwhile and then needed nothing, or was given up on — has no backup here:
 * the run removes the one it wrote. Only files that cannot remove leave one,
 * holding the text the file had when the run let go of it.
 *
 * What an undo does not do is compare: a file edited after the run is put
 * back to what it was before the run, the edit with it. And a file whose
 * conflict opened after the run is reported as failed: a whole text for a
 * file with an open conflict is refused by the vault's chain — or, where the
 * working copy is such a write's own, goes into that copy and not the file.
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

/**
 * The bundle-version state as locale keys + params, so both shells say the
 * same thing in their settings row (desktop) and maintenance row (phone):
 * first the root line, then — when any are left — the legacy-note line.
 */
export function okfBundleStatusLines(state: OkfVersionState): { key: string; params: Record<string, string | number> }[] {
  const lines: { key: string; params: Record<string, string | number> }[] = [];
  if (!state.rootIndex.exists) lines.push({ key: "settings.okfBundleNoRoot", params: {} });
  else if (state.rootIndex.declared === null) lines.push({ key: "settings.okfBundleNoDeclaration", params: {} });
  else if (state.rootIndex.current) lines.push({ key: "settings.okfBundleCurrent", params: { declared: state.rootIndex.declared } });
  else lines.push({ key: "settings.okfBundleDeclares", params: { declared: state.rootIndex.declared, current: state.targetVersion } });
  if (state.notesWithVersion.length > 0) {
    lines.push({ key: "settings.okfBundleLegacy", params: { count: state.notesWithVersion.length } });
  }
  return lines;
}

/** `34× 0.1, 3× 1.0` — the mixed desktop/phone state, visible for the first time. */
export function okfVersionBreakdown(state: OkfVersionState): string {
  return Object.entries(state.byValue)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => `${n}× ${value}`)
    .join(", ");
}
