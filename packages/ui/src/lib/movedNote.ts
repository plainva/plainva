import { resolveMissingFile, type MissingFileDeps, type MissingFileOutcome } from "@plainva/core";

/**
 * A note whose file is missing, healed the same way in both shells (issue
 * 110, E9). The decision itself lives in the core (`resolveMissingFile`);
 * this is what the two surfaces share around it.
 */
export type { MissingFileOutcome };

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
 * One lookup per path at a time: a note open in two panes (or a screen that
 * renders twice) must not run two full reconciles side by side.
 */
const inFlight = new Map<string, Promise<MissingFileOutcome>>();

export function healMissingNote(path: string, deps: MissingFileDeps, scope = ""): Promise<MissingFileOutcome> {
  const key = `${scope}\u0000${path}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = resolveMissingFile(path, deps).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}
