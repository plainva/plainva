import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { deleteFrontmatterPath, readFrontmatterPath, setFrontmatterPath } from "../frontmatter-surgical.js";

/** Provider identity belongs to the task. A local connection id never does. */
export interface TaskNoteIdentity {
  uid: string;
  list: string;
  provider?: string;
  identity?: string;
}

export function readTaskNoteIdentity(content: string): TaskNoteIdentity | null {
  const value = readFrontmatterPath(content, ["plainva", "pim"]);
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  if (a.kind !== "task" || !text(a.uid) || !text(a.list)) return null;
  return { uid: a.uid, list: a.list, ...(text(a.provider) ? { provider: a.provider } : {}), ...(text(a.identity) ? { identity: a.identity } : {}) };
}

/** Legacy anchors may be adopted only after checking their actual contents. */
export function taskNoteMatches(anchor: TaskNoteIdentity | null, task: TaskNoteIdentity): boolean {
  return !!anchor && anchor.uid === task.uid && anchor.list === task.list
    && (!anchor.provider || !task.provider || anchor.provider === task.provider)
    && (!anchor.identity || !task.identity || anchor.identity === task.identity);
}

export function taskNoteKey(task: TaskNoteIdentity): string {
  return JSON.stringify([task.provider ?? "", task.identity ?? "", task.list, task.uid]);
}

export function classifyTaskNotes(left: string, right: string): "same" | "different" | "unknown" {
  const a = readTaskNoteIdentity(left), b = readTaskNoteIdentity(right);
  // Do not infer identity from a title, a device-local id or an incomplete
  // legacy anchor. Only fully qualified identities support automatic repair.
  if (!a?.provider || !a.identity || !b?.provider || !b.identity) return "unknown";
  return taskNoteKey(a) === taskNoteKey(b) ? "same" : "different";
}

export function taskNotePath(folder: string, title: string, task: TaskNoteIdentity, fullHash = false): string {
  const hash = sha256Hex(utf8Encode(taskNoteKey(task)));
  const printable = [...title].map(char => char.charCodeAt(0) < 32 ? " " : char).join("");
  const stem = printable.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80) || "Task";
  return `${folder ? folder.replace(/\/$/, "") + "/" : ""}${stem} — ${hash.slice(0, fullHash ? 64 : 16)}.md`;
}

type TaskFileReader = { exists(path: string): Promise<boolean>; readTextFile(path: string): Promise<string> };

/** Never trust a shortened hash (or a filename) without reading its anchor. */
export async function availableTaskNotePath(adapter: TaskFileReader, folder: string, title: string, task: TaskNoteIdentity): Promise<string> {
  for (const fullHash of [false, true]) {
    const path = taskNotePath(folder, title, task, fullHash);
    if (!await adapter.exists(path)) return path;
    const anchor = readTaskNoteIdentity(await adapter.readTextFile(path));
    if (anchor && taskNoteKey(anchor) === taskNoteKey(task)) return path;
  }
  throw new Error("task_path_collision");
}

/** Align only known machine fields before comparing/merging the SAME task.
 * Unknown frontmatter, comments and user text remain part of the comparison. */
export function alignTaskSyncMetadata(content: string, reference: string): string {
  if (classifyTaskNotes(content, reference) !== "same") return content;
  let out = content;
  const paths: string[][] = [["plainva", "pim", "account"]];
  const generatedBy = readFrontmatterPath(content, ["generated", "by"]);
  const referenceBy = readFrontmatterPath(reference, ["generated", "by"]);
  if (typeof generatedBy === "string" && generatedBy.startsWith("plainva-task-sync/")
    && typeof referenceBy === "string" && referenceBy.startsWith("plainva-task-sync/")) paths.push(["generated", "by"], ["generated", "at"]);
  for (const path of paths) {
    const value = readFrontmatterPath(reference, path);
    out = value === undefined ? deleteFrontmatterPath(out, path) : setFrontmatterPath(out, path, value);
  }
  return out;
}

export function taskNotesEquivalent(left: string, right: string): boolean {
  return classifyTaskNotes(left, right) === "same" && alignTaskSyncMetadata(left, right) === alignTaskSyncMetadata(right, right);
}

/** Preserve a displaced task before replacing a colliding legacy path.
 * The caller queues the returned path BEFORE replacing the source. Repeating
 * after a crash reuses the copy; an independently edited destination blocks
 * replacement, so neither version can disappear during repair. */
export async function preserveDisplacedTask(
  adapter: TaskFileReader & { writeTextFile(path: string, content: string): Promise<void> },
  originalPath: string,
  content: string,
  expectedPath?: string,
): Promise<string> {
  const path = await displacedTaskPath(adapter, originalPath, content);
  if (expectedPath && path !== expectedPath) throw new Error("comparisonChanged");
  if (await adapter.exists(path)) {
    const existing = await adapter.readTextFile(path);
    if (existing !== content && !taskNotesEquivalent(existing, content)) throw new Error("task_destination_changed");
  } else {
    await adapter.writeTextFile(path, content);
    if (await adapter.readTextFile(path) !== content) throw new Error("task_copy_not_saved");
  }
  return path;
}

export async function displacedTaskPath(adapter: TaskFileReader, originalPath: string, content: string): Promise<string> {
  const task = readTaskNoteIdentity(content);
  if (!task?.provider || !task.identity) throw new Error("task_identity_unverified");
  const folder = originalPath.includes("/") ? originalPath.slice(0, originalPath.lastIndexOf("/")) : "";
  const title = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").match(/^#\s+(.+)$/m)?.[1]
    ?? originalPath.split("/").pop()!.replace(/\.md$/i, "");
  const path = await availableTaskNotePath(adapter, folder, title, task);
  if (path === originalPath) throw new Error("task_source_is_destination");
  return path;
}

/** A confirmation applies to the bytes the user actually compared. */
export async function assertComparisonUnchanged(adapter: TaskFileReader, originalPath: string, original: string | null, copyPath: string, copy: string): Promise<void> {
  const current = await adapter.exists(originalPath) ? await adapter.readTextFile(originalPath) : null;
  if (current !== original || !await adapter.exists(copyPath) || await adapter.readTextFile(copyPath) !== copy) throw new Error("comparisonChanged");
}

export async function separateTaskConflict(adapter: TaskFileReader & { writeTextFile(path: string, content: string): Promise<void>; deleteItem(path: string): Promise<void> }, originalPath: string, original: string, copyPath: string, copy: string, expectedPath?: string): Promise<string> {
  if (classifyTaskNotes(original, copy) !== "different") throw new Error("task_identity_unverified");
  await assertComparisonUnchanged(adapter, originalPath, original, copyPath, copy);
  const path = await preserveDisplacedTask(adapter, originalPath, copy, expectedPath);
  await assertComparisonUnchanged(adapter, originalPath, original, copyPath, copy);
  await adapter.deleteItem(copyPath);
  return path;
}
