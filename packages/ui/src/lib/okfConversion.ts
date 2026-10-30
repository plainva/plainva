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
import { toast } from "../services/toastStore";

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

/**
 * What a run makes of a file's text, as data: the transform and its options.
 *
 * A run carries it in its report and an open conversion in its journal, so an
 * undo can tell a file that still is what the run made of its backup from one
 * somebody changed since (`rollbackOkfConversion`).
 */
export type OkfRunRecipe =
  | { kind: "conversion"; options: OkfConversionOptions }
  | { kind: "migration"; file: OkfMigrateFileOptions };

/** A pure per-file transform: content in, content out. */
export type OkfTransform = (path: string, content: string) => { content: string; changed: boolean };

/** The one transform a recipe stands for — the run and its undo read the same. */
export function okfRecipeTransform(recipe: OkfRunRecipe): OkfTransform {
  if (recipe.kind === "conversion") {
    const { options } = recipe;
    return (_path, content) => convertFileToOkf(content, options);
  }
  const { file } = recipe;
  return (path, content) => migrateOkfFile(path, content, file);
}

export interface OkfRunReport {
  changed: string[];
  unchanged: number;
  skipped: { path: string; error: string }[];
  /** Vault-relative backup folder (empty for dry runs). */
  backupDir: string;
  samples: OkfConversionSample[];
  cancelled: boolean;
  /** What the run made of a file — what its undo compares against. */
  recipe: OkfRunRecipe;
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
  /** The per-file edit (`okfRecipeTransform`); the report carries it for the undo. */
  recipe: OkfRunRecipe;
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
   *
   * A backup that lies there already is never written over: it holds the
   * file's text from before the run, and a file whose text has moved on from
   * it was converted by the earlier pass and is left as it is (§ 3.129 Nr. 1).
   */
  backupDir?: string;
  /** Batch-folder prefix for a run that names its own folder (default `okf-conversion`). */
  backupPrefix?: string;
}): Promise<OkfRunReport> {
  const { adapter, paths, recipe, dryRun = false } = opts;
  const transform = okfRecipeTransform(recipe);
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
    recipe,
  };

  const total = paths.length;
  let done = 0;
  const createdDirs = new Set<string>(); // per-run ensureDirs cache (WP4)
  let cancelled = false;
  // Only a folder that was there before this pass can hold an earlier pass's
  // backups; a fresh stamped one is not asked about every file.
  const continuing = !dryRun && opts.backupDir !== undefined && (await adapter.exists(backupDir));

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
      // A backup an earlier pass of this run wrote: the first write wins. It is
      // the file's text from before the run, the only one an undo can bring
      // back; writing it over with the text that pass made of it destroyed the
      // original (§ 3.129 Nr. 1).
      const earlier = continuing && (await adapter.exists(backupPath)) ? await adapter.readTextFile(backupPath) : null;
      // The backup holds exactly the text that is replaced, because the backup
      // is what an undo puts back: the file is written only if it still is the
      // text that was judged and backed up, and judged anew where somebody
      // changed it meanwhile (`replaceVaultText`). A file with an open conflict
      // is refused there and reported as skipped: resolve it, then run again.
      try {
        await replaceVaultText(adapter, path, async (content) => {
          last.content = content;
          if (earlier !== null && content !== earlier) {
            // Converted by an earlier pass — its text has moved on from the
            // backup. A note is converted at most once per run: "rename" is
            // not idempotent, a second pass moved the type it set itself.
            last.verdict = { unchanged: true };
            return null;
          }
          last.verdict = judge(path, content);
          if (!("next" in last.verdict)) return null;
          // Still the text of the earlier backup: that pass never got to the
          // file. Its backup already holds exactly this text and stays.
          if (earlier !== null) return last.verdict.next;
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
    recipe: { kind: "conversion", options },
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
    recipe: { kind: "migration", file: fileOptions },
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
 * An undo compares (§ 3.87 Nr. 15): a file is put back only while it still
 * is exactly what the run made of its backup (`recipe`), and the write goes
 * through only if it still is that text when it lands (`replaceVaultText`).
 * A file somebody edited, moved or deleted since the run is left as it is and
 * named in `changedSince` — its earlier text stays in the backup folder, and
 * no edit is lost to an undo. A file whose conflict opened after the run is
 * reported as failed: the vault's chain refuses to replace it until the
 * conflict is resolved.
 *
 * Deliberately NOT deleted afterwards. The backup folder is the only copy of
 * the pre-conversion state; removing it as part of an undo would leave the
 * user with no second chance if the undo itself was the mistake. It ages out
 * with the rest of `.plainva/backups` like every other snapshot.
 */
export async function rollbackOkfConversion(
  adapter: OkfConversionAdapter,
  backupDir: string,
  recipe: OkfRunRecipe,
  onProgress?: (done: number, total: number) => void,
): Promise<OkfRollbackReport> {
  const report: OkfRollbackReport = { restored: [], failed: [], changedSince: [] };
  if (!adapter.listDir) throw new Error("adapter cannot list directories");
  if (!(await adapter.exists(backupDir))) return report;

  const transform = okfRecipeTransform(recipe);
  /** What the run made of a backed-up text, or null where it made nothing of it. */
  const madeOf = (path: string, original: string): string | null => {
    try {
      const result = transform(path, original);
      return result.changed ? result.content : null;
    } catch {
      return null;
    }
  };

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
      const original = await adapter.readTextFile(entry.path);
      const made = madeOf(target, original);
      let kept = !(await adapter.exists(target));
      if (!kept) {
        await replaceVaultText(adapter, target, async (now) => {
          // Already the original (a file the run let go of, an undo before):
          // nothing to put back. The run's own text: back it goes. Anything
          // else is somebody's edit since the run, and it stays.
          kept = now !== original && now !== made;
          return now === made && made !== null ? original : null;
        });
      }
      (kept ? report.changedSince : report.restored).push(target);
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
  /**
   * Files that are no longer what the run made of them — edited, moved or
   * deleted since. Left as they are; their earlier text stays in the backup.
   */
  changedSince: string[];
}

/**
 * Says what an undo did, the same way in both shells: what failed, what was
 * put back, and — never silently — what was left because it changed since.
 */
export function announceOkfRollback(
  report: OkfRollbackReport,
  backupDir: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): void {
  if (report.failed.length > 0) toast.error(t("okf.rollbackFailed", { count: report.failed.length }));
  else toast.info(t("okf.rollbackDone", { count: report.restored.length }));
  if (report.changedSince.length > 0) {
    toast.warning(t("okf.rollbackKept", { count: report.changedSince.length, dir: backupDir }));
  }
}

/**
 * The marker of an open conversion, as both shells keep it (desktop: appData,
 * phone: the app's data container — each with its own atomic write).
 */
export interface OkfRunJournal {
  startedAt: string;
  /** Vault-relative backup folder of the open run. */
  backupDir: string;
  /** How many files the run set out to process, for the recovery wording. */
  total: number;
  /** The options the run started with, so continuing does not change its mind. */
  options: OkfConversionOptions;
}

/** One vault's journal, however the shell stores it. */
export interface OkfJournalStore {
  read(): Promise<OkfRunJournal | null>;
  /** Durable before it returns; throws where it could not be written. */
  write(journal: OkfRunJournal): Promise<void>;
  clear(): Promise<void>;
}

/** A fresh conversion was asked for while an earlier one is still open. */
export class OkfRunOpenError extends Error {
  constructor(readonly backupDir: string) {
    super(`An interrupted OKF conversion is still open (${backupDir}). Continue or undo it first.`);
    this.name = "OkfRunOpenError";
  }
}

/**
 * A conversion with its journal around it — the one way both shells run one.
 *
 * The order is the whole point: journal first, then the first write. A journal
 * that cannot be written aborts the run — a conversion nobody could recover
 * from is worse than one that never started.
 *
 * One run, one backup folder, one set of options (§ 3.129 Nr. 1):
 * - `resume` continues the open run: into ITS folder, with ITS options, read
 *   from the journal — never from what a screen happens to show. Two folders
 *   would mean two undos, neither of which restores the vault on its own; other
 *   options would give the vault two types, or a second rename.
 * - A fresh run (`options`) is refused while a run is open (`OkfRunOpenError`),
 *   so no screen — a failed continue that fell back to the preview, a second
 *   window — can start a second folder beside it.
 * Notes an earlier pass converted are left alone (`runOkfTransform`).
 */
export async function convertWithOkfJournal(opts: {
  journal: OkfJournalStore;
  adapter: OkfConversionAdapter;
  scan: OkfScanResult;
  /** A fresh run's options. */
  options?: OkfConversionOptions;
  /** Continue the open run instead. */
  resume?: boolean;
  onProgress?: (done: number, total: number, path: string) => void;
  isCancelled?: () => boolean;
  concurrency?: number;
}): Promise<OkfRunReport> {
  const open = await opts.journal.read();
  let backupDir: string;
  let options: OkfConversionOptions;
  if (opts.resume) {
    if (!open) throw new Error("There is no interrupted OKF conversion to continue.");
    ({ backupDir, options } = open);
  } else {
    if (open) throw new OkfRunOpenError(open.backupDir);
    if (!opts.options) throw new Error("A new OKF conversion needs its options.");
    options = opts.options;
    backupDir = `.plainva/backups/okf-conversion-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await opts.journal.write({
      startedAt: new Date().toISOString(),
      backupDir,
      total: opts.scan.convertiblePaths.length,
      options: { defaultType: options.defaultType, existingTypeStrategy: options.existingTypeStrategy, renameTo: options.renameTo },
    });
  }

  const report = await runOkfConversion({
    adapter: opts.adapter,
    scan: opts.scan,
    options,
    backupDir,
    onProgress: opts.onProgress,
    isCancelled: opts.isCancelled,
    concurrency: opts.concurrency,
  });

  // A cancelled run keeps its journal: it IS the interrupted state the
  // recovery is for. Only a run that reached the end is done with it.
  if (!report.cancelled) await opts.journal.clear();
  return report;
}

/**
 * Undoes a run from its backup folder and closes its journal.
 *
 * The journal is cleared only after a rollback that left nothing failed — a
 * partial restore must stay recoverable, so the next start offers it again —
 * and only if it is this folder's: an undo of an older run's report does not
 * close a run opened since.
 */
export async function undoWithOkfJournal(opts: {
  journal: OkfJournalStore;
  adapter: OkfConversionAdapter;
  backupDir: string;
  recipe: OkfRunRecipe;
  onProgress?: (done: number, total: number) => void;
}): Promise<OkfRollbackReport> {
  const report = await rollbackOkfConversion(opts.adapter, opts.backupDir, opts.recipe, opts.onProgress);
  if (report.failed.length === 0) {
    const open = await opts.journal.read();
    if (!open || open.backupDir === opts.backupDir) await opts.journal.clear();
  }
  return report;
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
