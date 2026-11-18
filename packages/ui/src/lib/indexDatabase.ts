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
  /** A small text file: the note a set-aside leaves while it runs (`SET_ASIDE_NOTE`). Null where there is none. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
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
 * The two newest copies are kept (`SET_ASIDE_COPIES_KEPT`); each is as
 * large as the index and holds the notes' text. Older ones are removed after
 * the run, companions first and the main file last, so a stop leaves no
 * half copy that reads as a whole one; a removal that fails is reported and
 * fails nothing.
 *
 * One at a time per database: a second press while one runs is that one.
 */
export function setAsideIndexDatabase(files: IndexDatabaseFiles, database: string, at: Date = new Date()): Promise<string> {
  const running = settingAside.get(database);
  if (running) return running;
  const run = (async () => {
    let stamp = await stampInNote(files, database);
    if (stamp === null) {
      stamp = setAsideStamp(at);
      // Never over an earlier set-aside: it is kept as it was.
      for (let n = 2; (await setAsidesOf(files, database)).has(stamp); n++) stamp = `${setAsideStamp(at)}-${n}`;
      await files.writeText(database + SET_ASIDE_NOTE, JSON.stringify({ stamp }));
    }
    const aside = `${database}${SET_ASIDE_MARKER}${stamp}`;
    // Moved already by the run this one finishes: what lies at the name now is the new database's.
    const moved = await files.exists(aside);
    if (!moved) {
      for (const companion of INDEX_DATABASE_COMPANIONS) {
        if (await files.exists(database + companion)) await files.rename(database + companion, aside + companion);
      }
      if (await files.exists(database)) await files.rename(database, aside);
    }
    if (!(await files.exists(database))) await files.writeEmpty(database);
    await files.remove(database + SET_ASIDE_NOTE);
    await keepNewestSetAsides(files, database);
    return aside;
  })();
  settingAside.set(database, run);
  const done = () => { if (settingAside.get(database) === run) settingAside.delete(database); };
  run.then(done, done);
  return run;
}

/** Removes all but the newest copies (`SET_ASIDE_COPIES_KEPT`): companions first, the main file last; a failure fails nothing. */
async function keepNewestSetAsides(files: IndexDatabaseFiles, database: string): Promise<void> {
  try {
    const stamps = [...(await setAsidesOf(files, database)).entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    for (const [, entry] of stamps.slice(SET_ASIDE_COPIES_KEPT)) {
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
  if ((await stampInNote(files, database)) === null) return null;
  return setAsideIndexDatabase(files, database);
}

/** Whether a database of this name was set aside, by the names in its folder. */
export function hasSetAside(namesInFolder: Iterable<string>, databaseName: string): boolean {
  for (const name of namesInFolder) if (name.startsWith(databaseName + SET_ASIDE_MARKER)) return true;
  return false;
}
