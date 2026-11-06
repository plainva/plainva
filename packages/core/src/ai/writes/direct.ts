import { editorTextOf, inShapeOf } from "../../textFileShape.js";
import { replaceVaultText, type TextUpdateFiles } from "../../vault/updateText.js";
import type { IVaultAdapter } from "../../vault/IVaultAdapter.js";
import type { AppliedWrite, DirectFallback, RunWrites } from "../history.js";
import { RUN_WRITES_CAP } from "../history.js";
import { noteHash } from "../runSnapshot.js";

/**
 * "Apply directly" (plan "KI direkt schreiben", W1): what an assistant's
 * change becomes where the user let it change notes without asking — in one
 * conversation, or in a folder whose rule says so. It is written at once,
 * and it has a net: a version of the note before it, a version of what the
 * assistant left (the history marks it "AI"), and a record per note that
 * takes the change back.
 *
 * Everything here is the rule; the shell brings its files and its ways
 * (`DirectWriteFiles`). A change goes through the chain's entry for replacing
 * a text that somebody keeps a backup of (`replaceVaultText`), so it lands
 * only on the note exactly as the assistant read it, never on a note with an
 * open conflict, and only after its version was kept. Where any of that does
 * not hold, nothing is written and the reason says why — the change is then
 * laid down as a suggestion, as it always was (`DirectFallback`).
 */

/** What the shell does for a direct change. */
export interface DirectWriteFiles {
  /** The vault's chain: a change goes through it, never around it. */
  files: TextUpdateFiles & Pick<IVaultAdapter, "exists">;
  /**
   * Keeps the note as it lies on disk now as a version, whatever the interval
   * between snapshots says, and answers that version's backup path; null where
   * there is no file. Throws where no version could be kept. `origin: "ai"`:
   * the text is the assistant's, and the history marks it so.
   */
  snapshot(path: string, origin?: "ai"): Promise<string | null>;
  /** Whether the note is open in an editor with keystrokes that are not saved yet. */
  unsaved(path: string): boolean;
  /** A note changed or made outside its editor: the index reads it, and an open editor takes the text. */
  changed(path: string): Promise<void>;
  /** The text of a kept version. */
  readVersion(backupPath: string): Promise<string>;
  /** Takes away a note the assistant made, the way the app deletes — with its net. True where it is gone. */
  discard(path: string): Promise<boolean>;
}

export type DirectOutcome = { ok: true; before: string; after: string } | { ok: false; fallback: DirectFallback };

const fail = (fallback: DirectFallback): DirectOutcome => ({ ok: false, fallback });

/** What a refusal of the chain says, by name: the errors cross the bundles of both shells. */
function fallbackOf(error: unknown): DirectFallback {
  const name = error instanceof Error ? error.name : "";
  if (name === "OpenConflictError") return "conflict";
  if (name === "VaultPermissionDeniedError") return "rights";
  if (name === "TextFileChangedError") return "changed";
  return "failed";
}

/**
 * Writes `intended` — the note as an editor holds it, `\n` and no byte order
 * mark — in the place of a note the assistant read as `base`. The file keeps
 * its own shape (line ends, byte order mark). Nothing is written where the
 * note is open with unsaved keystrokes, has an open conflict, was changed
 * since it was read, cannot be written here, or where its version could not
 * be kept first.
 */
export async function applyDirectChange(deps: DirectWriteFiles, path: string, base: string, intended: string): Promise<DirectOutcome> {
  if (deps.unsaved(path)) return fail("unsaved");
  // Kept in an object: what the preparation below finds is read after it, and a closure's assignments are not narrowed.
  const seen: { before: string | null; refused: DirectFallback | null } = { before: null, refused: null };
  try {
    const update = await replaceVaultText(deps.files, path, async (raw) => {
      seen.refused = null;
      // Another hand changed it since the assistant read it: the change is no longer the one it made.
      if (editorTextOf(raw) !== base) {
        seen.refused = "changed";
        return null;
      }
      seen.before = await deps.snapshot(path).catch(() => null);
      // Without its version a change is not written: there would be no way back (the net rule of deletions).
      if (seen.before === null) {
        seen.refused = "snapshot";
        return null;
      }
      return inShapeOf(raw, intended);
    });
    if (seen.refused) return fail(seen.refused);
    const before = seen.before;
    if (!update.changed || before === null) return fail("changed");
    const after = noteHash(update.text);
    // The assistant's text as a version of its own, marked; where that fails the change stands all the same.
    await deps.snapshot(path, "ai").catch(() => null);
    await deps.changed(path).catch(() => undefined);
    return { ok: true, before, after };
  } catch (error) {
    return fail(fallbackOf(error));
  }
}

/**
 * After the shell made a note, a task or a line of the journal at the
 * assistant's word: what the record keeps of it. `before`: the version kept
 * of the note the line went into, null where the note is new.
 */
export async function madeDirectly(deps: DirectWriteFiles, path: string, before: string | null): Promise<{ before: string | null; after: string } | null> {
  try {
    const after = noteHash(await deps.files.readTextFile(path));
    await deps.snapshot(path, "ai").catch(() => null);
    await deps.changed(path).catch(() => undefined);
    return { before, after };
  } catch {
    return null;
  }
}

/**
 * Before the shell writes a line into a note that may be there — the
 * journal's day —: its version, kept now. `null` where the note is not there
 * (it will be new); a fallback where it is open unsaved, has an open
 * conflict, or no version could be kept.
 */
export async function keepBeforeMaking(deps: DirectWriteFiles, path: string | null): Promise<{ ok: true; before: string | null } | { ok: false; fallback: DirectFallback }> {
  if (path === null) return { ok: true, before: null };
  if (deps.unsaved(path)) return { ok: false, fallback: "unsaved" };
  try {
    if (!(await deps.files.exists(path))) return { ok: true, before: null };
    if (await deps.files.getConflictSession?.(path)) return { ok: false, fallback: "conflict" };
    const before = await deps.snapshot(path);
    return before === null ? { ok: false, fallback: "snapshot" } : { ok: true, before };
  } catch {
    return { ok: false, fallback: "snapshot" };
  }
}

export type DirectUndoOutcome = "undone" | "changed" | "gone" | "failed";

/**
 * Takes a direct change back. Where the note is still what the assistant left
 * — its text hashes to `after` —, the version before is put back (a note the
 * assistant made is taken away, with the net of every deletion). Where it
 * changed since, nothing is overwritten: `changed`, and the user is offered
 * the comparison instead.
 */
export async function undoDirectChange(deps: DirectWriteFiles, entry: Pick<AppliedWrite, "path" | "before" | "after">): Promise<DirectUndoOutcome> {
  const { path } = entry;
  if (deps.unsaved(path)) return "changed";
  try {
    if (!(await deps.files.exists(path))) return "gone";
    if (entry.before === null) {
      if (noteHash(await deps.files.readTextFile(path)) !== entry.after) return "changed";
      if (await deps.files.getConflictSession?.(path)) return "changed";
      return (await deps.discard(path)) ? "undone" : "failed";
    }
    const text = await deps.readVersion(entry.before);
    const seen = { differs: false };
    const update = await replaceVaultText(deps.files, path, async (raw) => {
      seen.differs = noteHash(raw) !== entry.after;
      if (seen.differs) return null;
      // What the assistant left stays in the history as well, marked; a failure here keeps the note as it is.
      await deps.snapshot(path, "ai");
      return text;
    });
    if (seen.differs) return "changed";
    if (update.changed) await deps.changed(path).catch(() => undefined);
    return "undone";
  } catch (error) {
    // A conflict that opened since is a change of somebody else's: compared, not overwritten.
    return fallbackOf(error) === "conflict" ? "changed" : "failed";
  }
}

/**
 * Keeps a direct change in the run's record: one line per note. A second
 * change of the same note in the run keeps the version from before the first
 * — taking it back takes back both — and the counts add up.
 */
export function recordApplied(writes: RunWrites, entry: AppliedWrite): void {
  const applied = (writes.applied ??= []);
  const existing = applied.find((item) => item.path === entry.path && !item.undone);
  if (existing) {
    existing.after = entry.after;
    existing.passages += entry.passages;
    existing.properties += entry.properties;
    return;
  }
  if (applied.length < RUN_WRITES_CAP) applied.push(entry);
}
