import { frontmatterSpan } from "../frontmatter-block.js";
import { GFM_TASK_FENCE, GFM_TASK_LINE } from "../vault/taskScan.js";

/**
 * Calm hints at the open note (plan KI-Harness P8-3, mockup chapter 25): what
 * the device notices by itself, without asking a model — the part without IO.
 *
 * Three kinds, and no others: a link of the note that leads to no note (the
 * shell knows which, by the rule a click follows); a line that begins with
 * TODO and is no task; and, in today's daily note, an appointment of tomorrow
 * that no note is anchored to. Each comes with a step the app already knows —
 * creating the note a link names, turning the line into a task where it
 * stands, creating the meeting note — and nothing happens without a click.
 *
 * At most three, taken in turn from the kinds so that one kind does not hide
 * the others; each with the key "Don't show again" remembers. The key names
 * the thing as it stands: a line that changed is a new thing, and asks again.
 */

export type NoteHintKind = "link" | "todo" | "meeting";

export interface NoteHint {
  kind: NoteHintKind;
  /** What "Don't show again" remembers: the note, the kind and the thing as it stands. */
  key: string;
  /** The note's line the hint is about (1-based), where it is about a line. */
  line: number | null;
  /** A link: as it is written. A TODO line: its words after the marker. An appointment: its title. */
  subject: string;
}

export const NOTE_HINTS_MAX = 3;
/** How many hints of each kind are looked at before the three are chosen. */
const PER_KIND = NOTE_HINTS_MAX;

const blank = (char: string | undefined) => char === " " || char === "\t";
/** A byte order mark, built at run time: this file holds no such character. */
const BOM = String.fromCharCode(0xfeff);

/** A line that begins with TODO — its indentation, its list mark where it has one, and its words after the marker. */
export interface TodoLine {
  indent: string;
  bullet: string | null;
  rest: string;
}

/**
 * "TODO …", "Todo: …", "- TODO …", "* todo: …": the marker people write in
 * front of something to do, at the start of a line, then a blank or a colon,
 * then words. Read step by step: "TODOs" and "Todoist" are no marker, and a
 * heading, a quote or a task is not such a line.
 */
export function todoLineOf(line: string): TodoLine | null {
  let at = 0;
  while (blank(line[at])) at++;
  const indent = line.slice(0, at);
  let bullet: string | null = null;
  const mark = line[at];
  if (mark !== undefined && "-*+".includes(mark) && blank(line[at + 1])) {
    bullet = mark;
    at += 1;
    while (blank(line[at])) at++;
  }
  const word = line.slice(at, at + 4);
  if (word !== "TODO" && word !== "Todo" && word !== "ToDo" && word !== "todo") return null;
  let next = at + 4;
  if (line[next] === ":") next += 1;
  else if (!blank(line[next])) return null;
  while (blank(line[next])) next++;
  const rest = line.slice(next).trimEnd();
  return rest ? { indent, bullet, rest } : null;
}

/** The TODO lines of a note: outside its properties block and its code blocks, none that is a task already. */
export function todoLines(content: string): { line: number; raw: string; todo: TodoLine }[] {
  const span = frontmatterSpan(content);
  const lines = content.split(/\r?\n/);
  const bodyStart = span ? content.slice(0, span.end).split(/\r?\n/).length - 1 : 0;
  const out: { line: number; raw: string; todo: TodoLine }[] = [];
  let fenced = false;
  for (let index = bodyStart; index < lines.length; index++) {
    // The first line of a file with a byte order mark begins with it: the line is what follows.
    const raw = index === 0 && lines[0]!.startsWith(BOM) ? lines[0]!.slice(1) : lines[index]!;
    if (GFM_TASK_FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || GFM_TASK_LINE.test(raw)) continue;
    const todo = todoLineOf(raw);
    if (todo) out.push({ line: index + 1, raw, todo });
  }
  return out;
}

/** The line as a task where it stands: its indentation and list mark kept, the marker gone — "- [ ] words". */
export function todoAsTask(todo: TodoLine): string {
  return `${todo.indent}${todo.bullet ?? "-"} [ ] ${todo.rest}`;
}

/**
 * The note with one TODO line turned into a task — or null where that line is
 * no longer what the hint was about (the text changed meanwhile). Every other
 * line, the line ends and a byte order mark stay as they are.
 */
export function withTodoAsTask(content: string, line: number, raw: string): string | null {
  const parts = content.split(/(\r?\n)/);
  const index = (line - 1) * 2;
  if (index < 0 || index >= parts.length) return null;
  const bom = index === 0 && parts[0]!.startsWith(BOM) ? BOM : "";
  if (parts[index]!.slice(bom.length) !== raw) return null;
  const todo = todoLineOf(raw);
  if (!todo) return null;
  parts[index] = bom + todoAsTask(todo);
  return parts.join("");
}

export interface NoteHintsInput {
  path: string;
  /** Links of the note that lead to no note, as they are written, with their line. */
  links: readonly { label: string; line: number | null }[];
  todos: readonly { line: number; rest: string }[];
  /** Appointments of tomorrow no note is anchored to — only for today's daily note. */
  meetings: readonly { uid: string; title: string }[];
  /** What "Don't show again" hid. */
  dismissed: ReadonlySet<string>;
}

export const noteHintKey = (path: string, kind: NoteHintKind, thing: string): string => `${kind}\n${path}\n${thing}`;

/** The hints for a note: at most three, one of each kind in turn — links, TODO lines, appointments —, none that was hidden. */
export function noteHints(input: NoteHintsInput): NoteHint[] {
  const seen = new Set<string>();
  // Each thing once, and none that was hidden.
  const fresh = (hint: NoteHint): boolean => {
    if (input.dismissed.has(hint.key) || seen.has(hint.key)) return false;
    seen.add(hint.key);
    return true;
  };
  const links: NoteHint[] = input.links.map((link) => ({ kind: "link", key: noteHintKey(input.path, "link", link.label), line: link.line, subject: link.label }));
  const todos: NoteHint[] = input.todos.map((todo) => ({ kind: "todo", key: noteHintKey(input.path, "todo", todo.rest), line: todo.line, subject: todo.rest }));
  const meetings: NoteHint[] = input.meetings.map((meeting) => ({ kind: "meeting", key: noteHintKey(input.path, "meeting", meeting.uid), line: null, subject: meeting.title }));
  const lists = [links, todos, meetings].map((list) => list.filter(fresh).slice(0, PER_KIND));
  const out: NoteHint[] = [];
  for (let round = 0; out.length < NOTE_HINTS_MAX && round < PER_KIND; round++) {
    for (const list of lists) {
      const hint = list[round];
      if (hint && out.length < NOTE_HINTS_MAX) out.push(hint);
    }
  }
  return out;
}
