import i18n from "../i18n";
import { errorText } from "./errorText";
import { reportingTo } from "../services/backgroundErrors";

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
  // The phone's plugin on iOS: the primary code only. FTS5's own words for its storage, met under any code.
  if (/\brc: (11|26)\b/.test(text)) return "damaged";
  if (/fts5: (?:corruption found|missing row|checksum mismatch)|invalid fts5 file format|vtable constructor failed/i.test(text)) return "damaged";
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
  /**
   * Writes an empty file — an empty SQLite database, which the next open
   * fills — only where no file of that name is: never over one, which may be
   * the database another window's run has just made and opened. One that is
   * there already is no failure.
   */
  writeEmpty(path: string): Promise<void>;
  /** The paths in `prefix`'s folder whose name begins with `prefix`'s name (`prefix` is a path). */
  listStartingWith(prefix: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  /** A small text file: the note a set-aside leaves while it runs (`SET_ASIDE_NOTE`). Null where there is none. */
  readText(path: string): Promise<string | null>;
  /**
   * Writes it; `exclusive`: only where no file of that name is yet — false
   * where one is (another window began a run first). A file system that
   * cannot tell writes and answers true.
   */
  writeText(path: string, text: string, options?: { exclusive?: boolean }): Promise<boolean>;
  /** When the file was last written, in ms; null where that cannot be told. */
  modifiedAt(path: string): Promise<number | null>;
}

/** The companions SQLite keeps beside a database, moved with it. */
export const INDEX_DATABASE_COMPANIONS = ["-wal", "-shm", "-journal"] as const;

/** The marker a set-aside database carries in its name: `<file>.broken-<time>` (`setAsideIndexDatabase`). */
export const SET_ASIDE_MARKER = ".broken-";

/**
 * The note a set-aside writes beside the database before its first step and
 * removes after its last: `<file>.setting-aside`, holding the stamp it sets
 * the files aside under. Only this note ever makes an open finish a
 * set-aside (`finishSetAside`) — never files that happen to lie beside the
 * database: a companion of an earlier copy whose main file is gone is no
 * sign that the database in use is damaged.
 */
export const SET_ASIDE_NOTE = ".setting-aside";

/** How many set-aside copies are kept, the newest: two rebuilds in a row keep the copy that had the data. */
export const SET_ASIDE_COPIES_KEPT = 2;

/** The time a set-aside is named by: sortable, and no character a file system refuses. */
export function setAsideStamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

/** The set-asides beside `database`, by their stamp: which of the files each one has. */
async function setAsidesOf(files: IndexDatabaseFiles, database: string): Promise<Map<string, { base: string | null; companions: string[] }>> {
  const prefix = database + SET_ASIDE_MARKER;
  const byStamp = new Map<string, { base: string | null; companions: string[] }>();
  for (const path of await files.listStartingWith(prefix)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const companion = INDEX_DATABASE_COMPANIONS.find((suffix) => rest.endsWith(suffix));
    const stamp = companion ? rest.slice(0, -companion.length) : rest;
    const entry = byStamp.get(stamp) ?? { base: null, companions: [] };
    if (companion) entry.companions.push(path);
    else entry.base = path;
    byStamp.set(stamp, entry);
  }
  return byStamp;
}

/** The stamp of the set-aside under way, from its note; null where none runs or the note says nothing usable. */
async function stampInNote(files: IndexDatabaseFiles, database: string): Promise<string | null> {
  const text = await files.readText(database + SET_ASIDE_NOTE).catch(() => null);
  if (!text) return null;
  try {
    const stamp = (JSON.parse(text) as { stamp?: unknown }).stamp;
    return typeof stamp === "string" && /^[0-9TZ-]+$/.test(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

/**
 * Sets a damaged index database aside and leaves an empty one in its place.
 *
 * The files keep their bytes under `<file>.broken-<time>` — the companions as
 * `<file>.broken-<time>-wal` and so on, so no sweep that knows a database by
 * its companions takes them for orphans — and nothing ever opens or writes
 * them again. Before its first step the run writes its note
 * (`SET_ASIDE_NOTE`), and removes it after its last; a stop anywhere in
 * between is finished at the next open (`finishSetAside`) or the next press,
 * under the stamp in the note. Each step looks before it moves: the
 * companions go while the database has not moved yet, the database last,
 * the empty one only where no database is. Until the empty one is there, a
 * set-aside beside the name tells the open not to bring an older copy back
 * in (`hasSetAside`).
 *
 * The copy just made and the newest other one are kept (`keepSetAsides`);
 * each is as large as the index and holds the notes' text.
 *
 * One at a time per database: a second press while one runs is that one,
 * and a run that finds another's note — another window pressed first —
 * finishes that run instead of beginning its own.
 */
export function setAsideIndexDatabase(files: IndexDatabaseFiles, database: string, at: Date = new Date()): Promise<string> {
  const running = settingAside.get(database);
  if (running) return running;
  const run = (async () => {
    let stamp = await stampInNote(files, database);
    if (stamp !== null && (await noteIsStale(files, database, stamp))) {
      await dropStaleNote(files, database);
      stamp = null;
    }
    if (stamp === null) {
      stamp = setAsideStamp(at);
      // Never over an earlier set-aside: it is kept as it was.
      for (let n = 2; (await setAsidesOf(files, database)).has(stamp); n++) stamp = `${setAsideStamp(at)}-${n}`;
      // Another window that began a run first has its note there: this one finishes that run.
      if (!(await files.writeText(database + SET_ASIDE_NOTE, JSON.stringify({ stamp }), { exclusive: true }))) {
        stamp = (await stampInNote(files, database)) ?? stamp;
      }
    }
    const aside = `${database}${SET_ASIDE_MARKER}${stamp}`;
    // Moved already by the run this one finishes: what lies at the name now is the new database's.
    if (!(await files.exists(aside))) {
      for (const companion of INDEX_DATABASE_COMPANIONS) await moveIfThere(files, database + companion, aside + companion);
      await moveIfThere(files, database, aside);
    }
    // Only where none lies: the other window's run may have made it and opened it (`writeEmpty`).
    if (!(await files.exists(database))) await files.writeEmpty(database);
    await files.remove(database + SET_ASIDE_NOTE).catch(async (error: unknown) => {
      // Gone already: the other window's run took it away.
      if (await files.exists(database + SET_ASIDE_NOTE)) throw error;
    });
    await keepSetAsides(files, database, stamp);
    return aside;
  })();
  settingAside.set(database, run);
  const done = () => { if (settingAside.get(database) === run) settingAside.delete(database); };
  run.then(done, done);
  return run;
}

/** Moves a file where it is still there; one another run moved to the same place meanwhile counts as moved. */
async function moveIfThere(files: IndexDatabaseFiles, from: string, to: string): Promise<void> {
  if (!(await files.exists(from))) return;
  try {
    await files.rename(from, to);
  } catch (error) {
    if (!(await files.exists(from)) && (await files.exists(to))) return;
    throw error;
  }
}

/**
 * A note whose run left nothing anywhere — neither the copy nor one of its
 * companions — beside a database written after the note: the copy went
 * (by hand, or with "forget"), and the database there is a new one in use.
 * Finishing would set that one aside. Where the times cannot be told, the
 * note counts as stale too: nothing is moved on a guess.
 */
async function noteIsStale(files: IndexDatabaseFiles, database: string, stamp: string): Promise<boolean> {
  if ((await setAsidesOf(files, database)).has(stamp)) return false;
  if (!(await files.exists(database))) return false;
  const noteAt = await files.modifiedAt(database + SET_ASIDE_NOTE).catch(() => null);
  const databaseAt = await files.modifiedAt(database).catch(() => null);
  return noteAt === null || databaseAt === null || databaseAt > noteAt;
}

async function dropStaleNote(files: IndexDatabaseFiles, database: string): Promise<void> {
  const report = reportingTo("index:set-aside-note");
  report(new Error("a set-aside note without its copy, beside a newer database, was removed; nothing was moved"));
  await files.remove(database + SET_ASIDE_NOTE).catch(report);
}

/**
 * After a run: the copy it just made is kept whatever its stamp says — a
 * clock set back must not make it the oldest — and beside it the newest
 * other whole copy (`SET_ASIDE_COPIES_KEPT`, two in all). Only copies with
 * their main file count; a companion whose main file is gone is no copy and
 * goes with the old ones. Removed companions first, the main file last, so a
 * stop leaves no half copy that reads as a whole one; a removal that fails is
 * reported and fails nothing.
 */
async function keepSetAsides(files: IndexDatabaseFiles, database: string, current: string): Promise<void> {
  try {
    const all = await setAsidesOf(files, database);
    const others = [...all.entries()].filter(([stamp, entry]) => stamp !== current && entry.base !== null).sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    const kept = new Set([current, ...others.slice(0, SET_ASIDE_COPIES_KEPT - 1).map(([stamp]) => stamp)]);
    for (const [stamp, entry] of all) {
      if (kept.has(stamp)) continue;
      for (const path of entry.companions) await files.remove(path);
      if (entry.base) await files.remove(entry.base);
    }
  } catch (error) {
    reportingTo("index:set-aside-prune")(error);
  }
}

const settingAside = new Map<string, Promise<string>>();

/**
 * Before a database is opened: finishes a set-aside that stopped half-way —
 * only one whose note says so (`SET_ASIDE_NOTE`) — so the database never
 * opens without its log. Returns where it was set aside, or null where none
 * was under way; whatever else lies beside the database, nothing moves then.
 */
export async function finishSetAside(files: IndexDatabaseFiles, database: string): Promise<string | null> {
  const stamp = await stampInNote(files, database);
  if (stamp === null) return null;
  // Its copy gone and a newer database there: the note goes, nothing moves (`noteIsStale`).
  if (await noteIsStale(files, database, stamp)) {
    await dropStaleNote(files, database);
    return null;
  }
  return setAsideIndexDatabase(files, database);
}

/** Whether a database of this name was set aside, by the names in its folder. */
export function hasSetAside(namesInFolder: Iterable<string>, databaseName: string): boolean {
  for (const name of namesInFolder) if (name.startsWith(databaseName + SET_ASIDE_MARKER)) return true;
  return false;
}
