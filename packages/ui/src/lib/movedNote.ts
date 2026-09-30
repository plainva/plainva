import { searchMissingFile, VaultFileNotFoundError, type KnownFileIdentity, type MissingFileDeps, type MissingFileOutcome, type MissingFileSearch } from "@plainva/core";
import { sweepPinboardRefs, type PinboardSweepDeps } from "../base/pinboardSweep";
import { notifyFileOps } from "./indexMdAutoUpdate";

/**
 * A note whose file is missing, healed the same way in both shells (issue
 * 110, E9). The decision itself lives in the core (`searchMissingFile`);
 * this is what the two surfaces share around it.
 */
export type { KnownFileIdentity, MissingFileOutcome, MissingFileSearch };

/**
 * Where the note lives now, as the message names it: the folder with a
 * trailing slash ("4 blog/taken/"), or the vault's own name for its top level
 * — "in /" reads like an error.
 */
export function movedFolderLabel(to: string, vaultName: string): string {
  const path = to.replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  return slash < 0 ? `${vaultName}/` : `${path.slice(0, slash)}/`;
}

/**
 * The sentence under "Moved?": several files carry the note's content, or a
 * single one does but was written at another time — then "which one" would
 * ask about a choice the reader cannot see.
 */
export function movedChoiceBodyKey(candidates: number): "editor.movedFileAskBody" | "editor.movedFileAskOneBody" {
  return candidates === 1 ? "editor.movedFileAskOneBody" : "editor.movedFileAskBody";
}

/**
 * What an open note does once its file turned out to be missing, for both
 * shells alike. `unsaved`: the note holds text that never reached the disk.
 *
 *  - `stay`    the file is there after all; nothing changes;
 *  - `follow`  a proven move: the note follows. With unsaved text it is
 *              written to the NEW place first (`carry`) — the new file holds
 *              exactly what was last saved, so the unsaved text applies on
 *              top of it;
 *  - `ask`     "Moved?" with the candidates;
 *  - `missing` nothing found.
 *
 * `keepText`: the note is not swapped for a card or the missing state — its
 * unsaved text stays on screen (and in the draft journal) and the question
 * sits above it. Nothing is written back to the old place unless the reader
 * says so ("Save here again").
 */
export type MissingNoteStep =
  | { kind: "stay" }
  | { kind: "follow"; to: string; carry: boolean }
  | { kind: "ask"; candidates: string[]; keepText: boolean }
  | { kind: "missing"; keepText: boolean };

export function planMissingNote(outcome: MissingFileOutcome, unsaved: boolean): MissingNoteStep {
  switch (outcome.kind) {
    case "present": return { kind: "stay" };
    case "moved": return { kind: "follow", to: outcome.to, carry: unsaved };
    case "ambiguous": return { kind: "ask", candidates: outcome.candidates, keepText: unsaved };
    case "gone": return { kind: "missing", keepText: unsaved };
  }
}

/**
 * The stored paths a move made in Plainva carries along, applied to a move
 * made outside it once that move is proven (or the reader picked the file):
 * bookmarks, pinboard arrangements, and the "move" file operation, which
 * moves the note's remarks and refreshes managed listings. Links inside other
 * notes are left alone — a move in Plainva rewrites none either, and a move
 * made elsewhere must not change files nobody touched.
 */
export interface ExternalMoveDeps {
  /** The shell's own bookmark rename (the desktop routes a client window to its owner). */
  retargetBookmarks(from: string, to: string): Promise<unknown>;
  pinboard: PinboardSweepDeps;
  /** Re-indexes the database files the pinboard sweep rewrote. */
  reindex?(paths: string[]): Promise<unknown>;
}

export async function adoptExternalMove(deps: ExternalMoveDeps, from: string, to: string): Promise<void> {
  try {
    await deps.retargetBookmarks(from, to);
  } catch (e) {
    console.warn("[movedNote] bookmarks did not follow the move", e);
  }
  let swept: string[] = [];
  try {
    swept = await sweepPinboardRefs(deps.pinboard, [{ from, to }]);
  } catch (e) {
    console.warn("[movedNote] pinboard arrangements did not follow the move", e);
  }
  if (swept.length > 0 && deps.reindex) {
    try {
      await deps.reindex(swept);
    } catch {
      // The next index pass repairs it.
    }
  }
  notifyFileOps([{ type: "move", from, to }]);
}

export interface HealOptions {
  /** What the note knew about its file, for when the row is already gone. */
  known?: KnownFileIdentity | null;
  /** Runs once per proven move, however many surfaces asked (`adoptExternalMove`). */
  onProvenMove?: (from: string, to: string) => Promise<unknown>;
}

/**
 * One search per path at a time: a note open in two panes (or a screen that
 * renders twice) must not run two full reconciles side by side — nor carry a
 * proven move's bookmarks twice.
 */
const inFlight = new Map<string, Promise<MissingFileSearch>>();

export function healMissingNote(path: string, deps: MissingFileDeps, scope = "", opts: HealOptions = {}): Promise<MissingFileSearch> {
  const key = `${scope}\u0000${path}`;
  const running = inFlight.get(key);
  if (running) return running;
  const adopt = async (outcome: MissingFileOutcome): Promise<MissingFileOutcome> => {
    if (outcome.kind === "moved" && opts.onProvenMove) {
      await opts.onProvenMove(path, outcome.to).catch((e) => console.warn("[movedNote] adopting a proven move failed", e));
    }
    return outcome;
  };
  const run = searchMissingFile(path, deps, opts.known).then(async (search) => ({
    first: await adopt(search.first),
    settled: search.settled ? search.settled.then(adopt) : null,
  }));
  inFlight.set(key, run);
  const done = () => { if (inFlight.get(key) === run) inFlight.delete(key); };
  void run.then((search) => search.settled ?? undefined).then(done, done);
  return run;
}

/**
 * Proves that the file a surface loaded is still where the surface writes it
 * (issue 110, E9). A database or an image open while its file is moved or
 * deleted elsewhere must not recreate it at its old place: that is a duplicate
 * of a moved file or a deletion undone, and sync carries either on. So the
 * write of such a surface asks first and throws `VaultFileNotFoundError`
 * instead; the surface keeps its change and looks for the file
 * (`useMissingFile`). Only the reader's own "Save here again" writes there.
 *
 * The note editor needs no such step: its save carries the text it started
 * from, and the adapter tells a vanished file from a new one under its own
 * lock. A move in the very instant between this check and the write is not
 * caught here.
 */
export async function assertFileStillThere(adapter: { exists(path: string): Promise<boolean> }, path: string): Promise<void> {
  if (!(await adapter.exists(path))) throw new VaultFileNotFoundError(path);
}

/**
 * True for the error of a file that is not there. Across a window boundary
 * the class does not survive, the code does.
 */
export function isFileNotFound(error: unknown): boolean {
  return error instanceof VaultFileNotFoundError || (error as { code?: unknown } | null)?.code === "FILE_NOT_FOUND";
}
