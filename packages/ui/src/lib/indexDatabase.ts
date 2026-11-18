import i18n from "../i18n";
import { errorText } from "./errorText";

/**
 * A vault's index database that does not open (both shells, the start).
 *
 * The desktop did not open such a vault and showed the driver's raw message;
 * the phone opened it restricted (`StructureRefusingVaultAdapter`) with a
 * notice. What can be done depends on WHY it does not open, and only one
 * reason is mended by building the index anew: a damaged file. A database
 * locked by another program, a full disk, a folder Plainva may not write to
 * are left as they are — rebuilding there would lose the sync state for
 * nothing — and the start says in words what the person can do.
 */
export type IndexDatabaseFailureKind = "damaged" | "locked" | "full" | "readOnly" | "unavailable";

/**
 * Why an index database did not open, from the error each shell's driver gives:
 * the desktop's sqlx ("error returned from database: (code: 11) database disk
 * image is malformed", extended codes included), the phone's plugin and
 * SQLite's own words.
 */
export function indexDatabaseFailureKind(error: unknown): IndexDatabaseFailureKind {
  const text = failureText(error);
  // SQLITE_CORRUPT (11) and its extended codes (267 virtual table, 523 sequence, 779 index), SQLITE_NOTADB (26).
  if (/\(code: (11|26|267|523|779)\)/.test(text)) return "damaged";
  if (/database disk image is malformed|file is not a database|SQLITE_CORRUPT|SQLITE_NOTADB|malformed database schema/i.test(text)) return "damaged";
  if (/\(code: (5|6|261|262|517)\)|database (?:table )?is locked|SQLITE_BUSY|SQLITE_LOCKED|database is busy/i.test(text)) return "locked";
  if (/\(code: 13\)|database or disk is full|SQLITE_FULL|no space left on device|ENOSPC/i.test(text)) return "full";
  if (/\(code: (8|14|264|776|1032)\)|readonly database|SQLITE_READONLY|SQLITE_CANTOPEN|unable to open database file|permission denied|EACCES|EPERM/i.test(text)) return "readOnly";
  return "unavailable";
}

function failureText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.message} ${failureText((error as { cause?: unknown }).cause ?? "")}`;
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error ?? "");
}

/**
 * Whether the vault is an encrypted workspace, as the start could tell when
 * its index database did not open: `"unknown"` where the question itself
 * failed — then it is treated as one, and nothing is rebuilt
 * (`indexDatabaseRebuildOffered`).
 */
export type IndexDatabaseWorkspace = boolean | "unknown";

/** Asks whether the vault is an encrypted workspace; a question that fails is `"unknown"`, never "no". */
export async function indexDatabaseWorkspace(read: () => Promise<unknown>): Promise<IndexDatabaseWorkspace> {
  try {
    return !!(await read());
  } catch {
    return "unknown";
  }
}

/** What the start says about an index database that did not open: why, in words, and what the person can do. */
export function indexDatabaseFailureMessage(kind: IndexDatabaseFailureKind, error: unknown, workspace: IndexDatabaseWorkspace): string {
  // Damaged, but whether it may be rebuilt is not known: said as a database that did not open, without the offer.
  if (kind === "damaged" && workspace === "unknown") return i18n.t("indexDatabase.unavailable", { reason: errorText(error) });
  if (kind === "damaged") return i18n.t(workspace ? "indexDatabase.damagedWorkspace" : "indexDatabase.damaged");
  if (kind === "locked") return i18n.t("indexDatabase.locked");
  if (kind === "full") return i18n.t("indexDatabase.full");
  if (kind === "readOnly") return i18n.t("indexDatabase.readOnly", { reason: errorText(error) });
  return i18n.t("indexDatabase.unavailable", { reason: errorText(error) });
}

/**
 * Whether the start offers to build the index anew: only for a damaged file,
 * and never in an encrypted workspace — its queue, revisions and comment
 * outbox live in that database, and a new one would lose them — nor where
 * that could not be told (`IndexDatabaseWorkspace`).
 */
export function indexDatabaseRebuildOffered(kind: IndexDatabaseFailureKind, workspace: IndexDatabaseWorkspace): boolean {
  return kind === "damaged" && workspace === false;
}

/** The files a set-aside moves, as each shell's file system reaches them (`setAsideIndexDatabase`). */
export interface IndexDatabaseFiles {
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  /** Writes an empty file: an empty SQLite database, which the next open fills. */
  writeEmpty(path: string): Promise<void>;
  /** The paths in `prefix`'s folder whose name begins with `prefix`'s name (`prefix` is a path). */
  listStartingWith(prefix: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

/** The companions SQLite keeps beside a database, moved with it. */
export const INDEX_DATABASE_COMPANIONS = ["-wal", "-shm", "-journal"] as const;

/** The marker a set-aside database carries in its name: `<file>.broken-<time>` (`setAsideIndexDatabase`). */
export const SET_ASIDE_MARKER = ".broken-";

/** The time a set-aside is named by: sortable, and no character a file system refuses. */
export function setAsideStamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

/** The set-asides beside `database`, by their stamp: which of the files each one has. */
async function setAsidesOf(files: IndexDatabaseFiles, database: string): Promise<Map<string, { base: boolean; paths: string[] }>> {
  const prefix = database + SET_ASIDE_MARKER;
  const byStamp = new Map<string, { base: boolean; paths: string[] }>();
  for (const path of await files.listStartingWith(prefix)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const companion = INDEX_DATABASE_COMPANIONS.find((suffix) => rest.endsWith(suffix));
    const stamp = companion ? rest.slice(0, -companion.length) : rest;
    const entry = byStamp.get(stamp) ?? { base: false, paths: [] };
    if (!companion) entry.base = true;
    entry.paths.push(path);
    byStamp.set(stamp, entry);
  }
  return byStamp;
}

/**
 * A set-aside that stopped half-way: its companions moved, the database not
 * (`setAsideIndexDatabase`). Opened as it is, the database would come up
 * without its log; the run is finished instead, under the stamp it began.
 */
async function unfinishedStamp(files: IndexDatabaseFiles, database: string): Promise<string | null> {
  if (!(await files.exists(database))) return null;
  for (const [stamp, entry] of await setAsidesOf(files, database)) if (!entry.base) return stamp;
  return null;
}

/**
 * Sets a damaged index database aside and leaves an empty one in its place.
 *
 * The files keep their bytes under `<file>.broken-<time>` — the companions as
 * `<file>.broken-<time>-wal` and so on, so no sweep that knows a database by
 * its companions takes them for orphans — and nothing ever opens or writes
 * them again. The companions go first and the database last; a stop in
 * between is finished at the next open (`finishSetAside`) or the next press,
 * under the same stamp. The empty database is written last; until it is
 * there, a set-aside beside the name tells the open not to bring an older
 * copy back in (`hasSetAside`).
 *
 * One set-aside is kept, the newest: each is as large as the index and holds
 * the notes' text, so the earlier ones go once the new one is in place.
 *
 * One at a time per database: a second press while one runs is that one.
 */
export function setAsideIndexDatabase(files: IndexDatabaseFiles, database: string, at: Date = new Date()): Promise<string> {
  const running = settingAside.get(database);
  if (running) return running;
  const run = (async () => {
    let stamp = await unfinishedStamp(files, database);
    if (stamp === null) {
      stamp = setAsideStamp(at);
      // Never over an earlier set-aside: it is kept as it was until this one is in place.
      for (let n = 2; await files.exists(`${database}${SET_ASIDE_MARKER}${stamp}`); n++) stamp = `${setAsideStamp(at)}-${n}`;
    }
    const aside = `${database}${SET_ASIDE_MARKER}${stamp}`;
    for (const companion of INDEX_DATABASE_COMPANIONS) {
      if (await files.exists(database + companion)) await files.rename(database + companion, aside + companion);
    }
    if (await files.exists(database)) await files.rename(database, aside);
    await files.writeEmpty(database);
    for (const [other, entry] of await setAsidesOf(files, database)) {
      if (other !== stamp) for (const path of entry.paths) await files.remove(path);
    }
    return aside;
  })();
  settingAside.set(database, run);
  const done = () => { if (settingAside.get(database) === run) settingAside.delete(database); };
  run.then(done, done);
  return run;
}

const settingAside = new Map<string, Promise<string>>();

/**
 * Before a database is opened: finishes a set-aside that stopped half-way
 * (`unfinishedStamp`), so it never opens without its log. Returns where it
 * was set aside, or null where nothing was half done.
 */
export async function finishSetAside(files: IndexDatabaseFiles, database: string): Promise<string | null> {
  if ((await unfinishedStamp(files, database)) === null) return null;
  return setAsideIndexDatabase(files, database);
}

/** Whether a database of this name was set aside, by the names in its folder. */
export function hasSetAside(namesInFolder: Iterable<string>, databaseName: string): boolean {
  for (const name of namesInFolder) if (name.startsWith(databaseName + SET_ASIDE_MARKER)) return true;
  return false;
}
