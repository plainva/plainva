import type { TaskAnchorRecord } from "@plainva/core";
import type { TaskCompletionModel } from "../lib/taskDatabase";
import { chooseAnchorToAdopt, fieldsEqual, readNoteFields } from "./taskSync";

/**
 * Notes that claim the same provider task (finding 2026-09-20).
 *
 * The reconciler keeps exactly ONE note per task in sync — the one its state row
 * names. Every reconnect before the anchor adoption existed imported the task
 * again, so an older vault holds copies: "Blumen gießen.md", "… 2.md", "… 7.md".
 * Nothing updates a copy any more. It shows the state of the day it was written,
 * usually "open", and that is what a person sees in the task list next to the
 * real note — the maintainer's report "ticked off at Google, still open here"
 * was 63 such tasks, while the sync itself had done everything right.
 *
 * This module only FINDS and JUDGES them. What may go is decided conservatively:
 *
 * - the note the reconciler maintains always stays;
 * - a copy goes only when it carries nothing of its own — no body text the kept
 *   note lacks, and either the same fields as the kept note or "done";
 * - everything else stays and is shown, so a person can look.
 *
 * Removing a copy never touches the provider: a copy has no state row, and the
 * removal goes through the plain vault delete, not through the task-deletion
 * orders that make the provider copy follow.
 */

export type TaskCopyVerdict = "kept" | "removable" | "ownText" | "differs" | "unreadable";

export interface TaskNoteCopy {
  path: string;
  verdict: TaskCopyVerdict;
  /** First H1 of the note, or its file name. */
  title: string;
  done: boolean;
  due: string | null;
}

export interface TaskDuplicateGroup {
  /** Stable key of the task: list + uid. */
  key: string;
  uid: string;
  list: string;
  /** Title of the kept note. */
  title: string;
  /** Kept note first, then the copies by path. */
  notes: TaskNoteCopy[];
}

export interface FindTaskDuplicatesOptions {
  /** `VaultQueryService.getTaskAnchors()`. */
  anchorsByUid: ReadonlyMap<string, readonly TaskAnchorRecord[]>;
  /**
   * The note the reconciler maintains for a task on THIS device
   * (`pim_task_state.note_path`), or null when there is no state row — the
   * provider task is gone, or this device never listed it.
   */
  boundPath(list: string, uid: string): string | null;
  readTextFile(path: string): Promise<string>;
  /** Date column and completion model of the task database (as in the reconciler). */
  db: { dueKey: string | null; completion: TaskCompletionModel | null };
}

const fileStem = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");
/** "Steuern einreichen 2" -> "Steuern einreichen": the name the original would carry. */
const originalStem = (stem: string) => stem.replace(/ \d+$/, "");

function bodyOf(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  const body = m ? content.slice(m[0].length) : content;
  // The H1 is a FIELD (the task's title), compared separately — not body text.
  return body.replace(/^#[ \t]+\S[^\r\n]*\r?\n?/m, "").replace(/\s+/g, " ").trim();
}

/**
 * Every task claimed by more than one note, with a verdict per note.
 * Groups by list + uid: the same uid in two lists is two tasks.
 */
export async function findDuplicateTaskNotes(opts: FindTaskDuplicatesOptions): Promise<TaskDuplicateGroup[]> {
  const byTask = new Map<string, TaskAnchorRecord[]>();
  for (const records of opts.anchorsByUid.values()) {
    for (const rec of records) {
      const key = JSON.stringify([rec.list, rec.uid]);
      const list = byTask.get(key);
      if (list) list.push(rec);
      else byTask.set(key, [rec]);
    }
  }

  const groups: TaskDuplicateGroup[] = [];
  for (const [key, records] of byTask) {
    // One path can carry only one anchor; de-duplicate defensively all the same.
    const candidates = [...new Map(records.map((r) => [r.path, r])).values()];
    if (candidates.length < 2) continue;
    const { uid, list } = candidates[0]!;

    const bound = opts.boundPath(list, uid);
    const keptRecord =
      candidates.find((c) => c.path === bound) ??
      // No state row here: the same choice the reconciler would make when it
      // adopts one — the original name first, then no numeric suffix, then age.
      chooseAnchorToAdopt(candidates, originalStem(fileStem(candidates.slice().sort((a, b) => a.path.length - b.path.length)[0]!.path)));
    if (!keptRecord) continue;

    let keptContent: string;
    try {
      keptContent = await opts.readTextFile(keptRecord.path);
    } catch {
      continue; // nothing to compare against — leave the whole group alone
    }
    const keptFields = readNoteFields(keptContent, opts.db, false);
    const keptBody = bodyOf(keptContent);

    const notes: TaskNoteCopy[] = [
      { path: keptRecord.path, verdict: "kept", title: keptFields.title || fileStem(keptRecord.path), done: keptFields.completed, due: keptFields.due },
    ];
    for (const copy of candidates.filter((c) => c.path !== keptRecord.path).sort((a, b) => (a.path < b.path ? -1 : 1))) {
      let content: string;
      try {
        content = await opts.readTextFile(copy.path);
      } catch {
        notes.push({ path: copy.path, verdict: "unreadable", title: fileStem(copy.path), done: false, due: null });
        continue;
      }
      const fields = readNoteFields(content, opts.db, false);
      const body = bodyOf(content);
      const ownText = body.length > 0 && body !== keptBody;
      const verdict: TaskCopyVerdict = ownText
        ? "ownText"
        : fields.completed || fieldsEqual({ ...fields, title: fields.title || keptFields.title }, keptFields)
          ? "removable"
          : "differs";
      notes.push({ path: copy.path, verdict, title: fields.title || fileStem(copy.path), done: fields.completed, due: fields.due });
    }
    groups.push({ key, uid, list, title: notes[0]!.title, notes });
  }
  return groups.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * How many tasks are claimed by more than one note — from the anchor index
 * alone, no file is read. This is what the banner asks on every refresh; the
 * verdicts (which need the files) are only worked out when somebody looks.
 */
export function countDuplicateTasks(anchorsByUid: ReadonlyMap<string, readonly TaskAnchorRecord[]>): number {
  return summarizeDuplicateTasks(anchorsByUid).count;
}

/**
 * Count plus the IDENTITY of the current set of duplicates. The signature is
 * what "I have looked at these, they stay" is remembered against
 * (`lib/taskDuplicatesSeen`): a copy that joins or leaves changes it, and the
 * notice comes back on its own. Two independent 32-bit FNV-1a runs — short
 * enough for a preference value, and a collision would only hide a notice.
 */
export function summarizeDuplicateTasks(anchorsByUid: ReadonlyMap<string, readonly TaskAnchorRecord[]>): { count: number; signature: string } {
  const pathsByTask = new Map<string, Set<string>>();
  for (const records of anchorsByUid.values()) {
    for (const rec of records) {
      const key = JSON.stringify([rec.list, rec.uid]);
      const paths = pathsByTask.get(key);
      if (paths) paths.add(rec.path);
      else pathsByTask.set(key, new Set([rec.path]));
    }
  }
  const lines: string[] = [];
  for (const [key, paths] of pathsByTask) if (paths.size > 1) lines.push(`${key}${JSON.stringify([...paths].sort())}`);
  if (lines.length === 0) return { count: 0, signature: "" };
  const text = lines.sort().join("\n");
  const fnv = (seed: number) => {
    let h = seed;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return { count: lines.length, signature: `${fnv(0x811c9dc5)}${fnv(0x9747b28c)}` };
}

/** The paths a clean-up may remove — exactly the copies judged `removable`. */
export function removableTaskCopies(groups: readonly TaskDuplicateGroup[]): string[] {
  return groups.flatMap((g) => g.notes.filter((n) => n.verdict === "removable").map((n) => n.path));
}

/**
 * Removes the copies a person was SHOWN as removable — and only those that are
 * still removable now. The list on screen may be minutes old while a sync
 * writes notes; the verdicts are therefore worked out again right before the
 * delete, and a copy that has meanwhile gained text or changed is left alone.
 *
 * `deleteNote` is the shell's plain, confirmed vault delete. It must NOT be the
 * task-deletion path that makes the provider's task follow: a copy is not the
 * task, and the note the reconciler maintains stays.
 */
export async function removeTaskCopies(
  shown: readonly TaskDuplicateGroup[],
  opts: FindTaskDuplicatesOptions,
  deleteNote: (path: string) => Promise<void>
): Promise<{ removed: string[]; skipped: string[] }> {
  const wanted = new Set(removableTaskCopies(shown));
  const current = new Set(removableTaskCopies(await findDuplicateTaskNotes(opts)));
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const path of wanted) {
    if (!current.has(path)) {
      skipped.push(path);
      continue;
    }
    try {
      await deleteNote(path);
      removed.push(path);
    } catch (e) {
      console.warn("[taskDuplicates] could not remove a task copy", path, e);
      skipped.push(path);
    }
  }
  return { removed, skipped };
}
