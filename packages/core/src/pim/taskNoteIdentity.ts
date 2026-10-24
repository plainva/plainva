import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { deleteFrontmatterPath, noteBodyOf, readFrontmatterPath, setFrontmatterPath } from "../frontmatter-surgical.js";
import { foldPathForCollision } from "../sync/pathIdentity.js";
import { trimEndChars } from "../textScan.js";

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

/**
 * The file-name stem of a mirrored task: its title, made safe for every file
 * system Plainva syncs to (Windows' reserved characters, no control characters,
 * no trailing dot or space, at most 80 characters).
 */
export function taskNoteStem(title: string): string {
  const printable = [...title].map((char) => (char.charCodeAt(0) < 32 ? " " : char)).join("");
  const cleaned = trimEndChars(printable.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim(), ". ");
  return trimEndChars([...cleaned].slice(0, 80).join(""), ". ") || "Task";
}

/**
 * Where a mirrored task's note lives (decision E11, 2026-09-24): its title, and
 * from the second task of that title on "Title 2", "Title 3" — the way every
 * other note is numbered. From 12.09. to 24.09. the name carried a piece of a
 * hash of the task's identity instead; the identity lives in the note's anchor
 * (`plainva.pim`), and the reconciler writes only where that anchor matches.
 */
export function taskNotePath(folder: string, title: string, n = 1): string {
  const dir = folder ? `${trimEndChars(folder, "/")}/` : "";
  return `${dir}${taskNoteStem(title)}${n > 1 ? ` ${n}` : ""}.md`;
}

type TaskFileReader = { exists(path: string): Promise<boolean>; readTextFile(path: string): Promise<string> };

export interface TaskNotePathOptions {
  /** Paths never to hand out, although they may look free or even hold this task (the place a displaced note leaves). */
  skip?: Iterable<string>;
  /**
   * Paths known to exist (the index). A name that differs from one of them only
   * in letter case or Unicode spelling is ONE file on Windows, macOS and for
   * Drive, so it counts as taken by that file.
   */
  known?: Iterable<string>;
}

/** Enough for any real list; a runaway loop ends as an error, not as a hang. */
const MAX_TASK_NAME_NUMBER = 10_000;

/**
 * The first name of the "Title", "Title 2", "Title 3" row that is free for this
 * task. Free means: nothing is there, or the file there already IS this task
 * (its anchor says so — an interrupted run is picked up, never duplicated). A
 * foreign anchor, a note without one, or a file that cannot be read takes the
 * next number. A name is never trusted without reading the anchor behind it.
 */
export async function availableTaskNotePath(
  adapter: TaskFileReader,
  folder: string,
  title: string,
  task: TaskNoteIdentity,
  options: TaskNotePathOptions = {},
): Promise<string> {
  const skip = new Set([...(options.skip ?? [])].map(foldPathForCollision));
  const twins = new Map<string, string>();
  for (const path of options.known ?? []) twins.set(foldPathForCollision(path), path);
  const key = taskNoteKey(task);
  for (let n = 1; n <= MAX_TASK_NAME_NUMBER; n++) {
    const path = taskNotePath(folder, title, n);
    const folded = foldPathForCollision(path);
    if (skip.has(folded)) continue;
    let occupant: string | null = (await adapter.exists(path)) ? path : null;
    if (!occupant) {
      const twin = twins.get(folded);
      if (twin && twin !== path && (await adapter.exists(twin))) occupant = twin;
    }
    if (!occupant) return path;
    let anchor: TaskNoteIdentity | null = null;
    try {
      anchor = readTaskNoteIdentity(await adapter.readTextFile(occupant));
    } catch {
      /* unreadable: taken */
    }
    if (anchor && taskNoteKey(anchor) === key) return occupant;
  }
  throw new Error("task_path_collision");
}

/**
 * A name Plainva itself gave a mirrored task between 12.09. and 24.09.:
 * "<title> — <16 or 64 hex digits>.md". Only the SHAPE — whether the digits
 * really are the hash of the note's own anchor decides `isOwnLegacyTaskNoteName`.
 */
export function parseLegacyTaskNoteName(path: string): { folder: string; stem: string; hex: string } | null {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  if (!name.endsWith(".md")) return null;
  const base = name.slice(0, -3);
  const sep = base.lastIndexOf(" — ");
  if (sep <= 0) return null;
  const hex = base.slice(sep + 3);
  if ((hex.length !== 16 && hex.length !== 64) || !/^[0-9a-f]+$/.test(hex)) return null;
  return { folder: slash < 0 ? "" : path.slice(0, slash), stem: base.slice(0, sep), hex };
}

/**
 * True only for a name Plainva assigned itself: the legacy shape AND the digits
 * are the (start of the) hash of the identity in the note's own anchor. A note
 * a person named "Plan — 0123456789abcdef.md" does not qualify, nor does a
 * mirrored note whose name was copied from another task.
 */
export function isOwnLegacyTaskNoteName(path: string, content: string): boolean {
  const parsed = parseLegacyTaskNoteName(path);
  if (!parsed) return false;
  const anchor = readTaskNoteIdentity(content);
  if (!anchor) return false;
  const hash = sha256Hex(utf8Encode(taskNoteKey(anchor)));
  return parsed.hex.length === 64 ? hash === parsed.hex : hash.startsWith(parsed.hex);
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

const WHITESPACE = /\s/;
const isWhitespace = (ch: string | undefined): boolean => ch !== undefined && WHITESPACE.test(ch);
/** Where `^` and `$` stand under the `m` flag, and what `.` does not match. */
const isLineBreak = (ch: string | undefined): boolean => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";

/**
 * The text of the first `# ` heading — what `/^#\s+(.+)$/m` captured — in one
 * pass (plan Befunde 24.09., E6). The pattern's `\s+` and `.+` shared the
 * blanks after the `#`. The reading is the old one: the blanks may run over
 * line breaks, and when nothing but blanks follows, the last blank that is no
 * line break becomes the text.
 */
function firstHeadingText(text: string): string | undefined {
  const n = text.length;
  for (let lineStart = 0; lineStart < n;) {
    if (text[lineStart] === "#") {
      let at = lineStart + 1;
      while (at < n && isWhitespace(text[at])) at++;
      if (at === n) at--;
      while (at > lineStart + 1 && isLineBreak(text[at])) at--;
      if (at > lineStart + 1) {
        let end = at;
        while (end < n && !isLineBreak(text[end])) end++;
        return text.slice(at, end);
      }
    }
    while (lineStart < n && !isLineBreak(text[lineStart])) lineStart++;
    lineStart++;
  }
  return undefined;
}

/**
 * Where a task goes when another task takes its place: the next free number of
 * its title ("Title 2" next to "Title"), never the place it leaves.
 */
export async function displacedTaskPath(adapter: TaskFileReader, originalPath: string, content: string): Promise<string> {
  const task = readTaskNoteIdentity(content);
  if (!task?.provider || !task.identity) throw new Error("task_identity_unverified");
  const folder = originalPath.includes("/") ? originalPath.slice(0, originalPath.lastIndexOf("/")) : "";
  const title = firstHeadingText(noteBodyOf(content))
    ?? originalPath.split("/").pop()!.replace(/\.md$/i, "");
  const path = await availableTaskNotePath(adapter, folder, title, task, { skip: [originalPath] });
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
