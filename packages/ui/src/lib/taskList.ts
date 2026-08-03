/**
 * The judgement behind the tasks view, shared by both shells (plan P7, S22).
 *
 * The desktop had this as local code inside its view. The phone needs the same
 * answers — which tasks a filter leaves, how they group, and whether a stale
 * read may overwrite a fresh checkbox — and a second implementation of "which
 * tasks are open" is exactly the kind of divergence this whole package exists
 * to remove. Pure and platform-free: no I/O, no React, testable in plain Node.
 */

/** One checkbox line as the query service reports it. */
export interface TaskLike {
  path: string;
  title: string;
  text: string;
  done: boolean;
  due?: string | null;
  tags: string[];
  excluded: boolean;
  ordinal: number;
}

/** One row of the standard task database. */
export interface TaskDbRowLike {
  title: string;
  done: boolean;
  due?: string | null;
}

export type TaskStatusFilter = "open" | "done" | "all";

export interface TaskFilters {
  status: TaskStatusFilter;
  /** Free text, matched against the task text (checkbox) or title (database). */
  text?: string;
  /** Vault folder prefix; empty = every folder. */
  folder?: string;
  tag?: string;
  /** Only tasks that carry a due date. */
  dueOnly?: boolean;
  /** Include notes that opted out with `plainva.tasks: false`. */
  includeHidden?: boolean;
}

function matchesStatus(done: boolean, status: TaskStatusFilter): boolean {
  return status === "all" || (status === "open" ? !done : done);
}

/** Checkbox tasks that survive the filters, in the order they were listed. */
export function filterTasks<T extends TaskLike>(tasks: readonly T[], f: TaskFilters): T[] {
  const q = (f.text ?? "").trim().toLowerCase();
  return tasks.filter((tk) => {
    if (!f.includeHidden && tk.excluded) return false;
    if (!matchesStatus(tk.done, f.status)) return false;
    if (f.folder && tk.path !== f.folder && !tk.path.startsWith(f.folder + "/")) return false;
    if (f.tag && !tk.tags.includes(f.tag)) return false;
    if (f.dueOnly && !tk.due) return false;
    if (q && !tk.text.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * The same filters over the database section. `folder` and `tag` do not apply —
 * a database row lives where its database says, and its tags are properties
 * rather than inline hashtags. The status filter DOES apply: without it a
 * completed provider task looked open and the filter appeared broken.
 */
export function filterTaskDbRows<T extends TaskDbRowLike>(rows: readonly T[], f: TaskFilters): T[] {
  const q = (f.text ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (!matchesStatus(r.done, f.status)) return false;
    if (f.dueOnly && !r.due) return false;
    if (q && !r.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export interface TaskGroup<T> {
  path: string;
  title: string;
  excluded: boolean;
  items: T[];
}

/** Groups by note, keeping first-seen order — the reading order of the list. */
export function groupTasksByNote<T extends TaskLike>(tasks: readonly T[]): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  for (const tk of tasks) {
    const existing = groups.get(tk.path);
    if (existing) existing.items.push(tk);
    else groups.set(tk.path, { path: tk.path, title: tk.title, excluded: tk.excluded, items: [tk] });
  }
  return [...groups.values()];
}

/**
 * Guards an optimistic checkbox against a slower read.
 *
 * Listing tasks is asynchronous; a write can finish while an older read is
 * still in flight. Without this, that older result rolls the checkbox back to
 * its pre-write value in front of the user, and the next refresh flips it
 * again — which reads as "my check-off did not stick".
 */
export class TaskMutationGate {
  value = 0;
  active = 0;
  begin(): void {
    this.active += 1;
    this.value += 1;
  }
  finish(): void {
    this.active = Math.max(0, this.active - 1);
    this.value += 1;
  }
  /** True only when nothing is in flight AND nothing changed since the read began. */
  canCommit(versionAtStart: number): boolean {
    return this.active === 0 && versionAtStart === this.value;
  }
}

/**
 * Hiding a note from the task list, or unhiding it (S31).
 *
 * The marker lives in the note itself (`plainva.tasks: false`), not in an app
 * register — the truth stays in the file, travels with it and is visible in any
 * editor. Which is exactly why the WRITE has to be one rule: unhiding DELETES
 * the key rather than writing `true`, so a note that was never hidden and a
 * note that was unhidden are byte-identical. Two shells deciding that
 * separately would produce files that differ for the same state, and the
 * difference would ride the sync.
 */
export function setNoteTaskExclusion(
  raw: string,
  excluded: boolean,
  ops: {
    setFrontmatterPath: (raw: string, path: string[], value: unknown) => string;
    deleteFrontmatterPath: (raw: string, path: string[]) => string;
  },
): string {
  return excluded
    ? ops.setFrontmatterPath(raw, ["plainva", "tasks"], false)
    : ops.deleteFrontmatterPath(raw, ["plainva", "tasks"]);
}
