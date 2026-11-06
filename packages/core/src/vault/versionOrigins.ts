import type { IVaultAdapter } from "./IVaultAdapter.js";
import { BACKUPS_ROOT } from "./backupNaming.js";

/**
 * Which versions of the history an assistant wrote (plan "KI direkt
 * schreiben", W1): a change the assistant applied directly is kept as a
 * version of its own, and the history marks it "AI".
 *
 * A snapshot's name carries its time and nothing else, and its grammar is
 * read by every version of the app that shares the vault's backups — a
 * marker in the name would turn the version into a file older versions do
 * not recognise (an orphan of a note that does not exist). So the mark lives
 * beside the snapshots, in one small file under `.plainva/backups/`: a name
 * no reader of the grammar takes for a snapshot, and one no pruning touches
 * (`pruneOldBackups` never guesses at foreign files). A mark whose snapshot
 * was pruned is harmless and falls out of the list as newer ones come.
 */

export const AI_VERSIONS_FILE = `${BACKUPS_ROOT}/ai-versions.json`;

/** More marks than this are not kept: the oldest go first, long after their snapshots usually did. */
export const AI_VERSIONS_MAX = 2000;

type MarkFiles = Pick<IVaultAdapter, "readBinaryFile" | "writeTextFile">;

/**
 * The list read as bytes: a history that only lists versions — of an image, too — puts nothing through a text
 * reader, and a list that is not UTF-8 marks nothing.
 */
async function readMarks(files: Pick<IVaultAdapter, "readBinaryFile">): Promise<string[]> {
  return parseMarks(new TextDecoder("utf-8", { fatal: true }).decode(await files.readBinaryFile(AI_VERSIONS_FILE)));
}

/** One mark after the other per store: two writes of the list at once would lose one of them. */
const queues = new WeakMap<object, Promise<unknown>>();

function parseMarks(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { paths?: unknown };
    return Array.isArray(parsed.paths) ? parsed.paths.filter((path): path is string => typeof path === "string") : [];
  } catch {
    // A list that does not read marks nothing; the next mark starts it anew.
    return [];
  }
}

/** The backup paths of the versions an assistant wrote; empty where there are none or the list cannot be read. */
export async function readAiVersionMarks(files: Pick<IVaultAdapter, "readBinaryFile">): Promise<Set<string>> {
  try {
    return new Set(await readMarks(files));
  } catch {
    return new Set();
  }
}

/** Marks the version at `backupPath` as written by an assistant. */
export function markAiVersion(files: MarkFiles, backupPath: string): Promise<void> {
  const before = queues.get(files) ?? Promise.resolve();
  const next = before
    .catch(() => undefined)
    .then(async () => {
      let marks: string[] = [];
      try {
        marks = await readMarks(files);
      } catch {
        // No list yet.
      }
      if (marks.includes(backupPath)) return;
      marks.push(backupPath);
      await files.writeTextFile(AI_VERSIONS_FILE, `${JSON.stringify({ version: 1, paths: marks.slice(-AI_VERSIONS_MAX) })}\n`);
    });
  queues.set(files, next);
  return next;
}
