/**
 * The journal: short, timed entries under one heading of the daily note.
 *
 *     ## Journal
 *
 *     - 09:12 Called the workshop, part arrives on Thursday
 *     - [ ] 10:30 Send the offer #client
 *     - 14:05 A thought that needs two lines
 *       and gets them, indented
 *
 * Plain Markdown, the form Thino writes (`- HH:mm Text`, `- [ ] HH:mm Text`);
 * Knomo's `- HH:mm:ss Text` is read as well. Everything in here is pure: text
 * in, text out, no file access. The rule of the project applies to every edit —
 * a line Plainva was not asked to change comes back byte for byte: frontmatter,
 * line endings (LF or CRLF), the spelling of the other entries.
 *
 * Every edit is CHECKED before it is handed back: the result is parsed again and
 * has to contain the entry where it was put. A section that ends in an unclosed
 * code fence or HTML comment would swallow an appended line; then the entry goes
 * directly under the heading instead, and if that fails too the edit is refused
 * rather than written somewhere it cannot be read from.
 */
import { analyzeNoteOutline, type NoteOutlineNode } from "./noteSource.js";
import { stripAnchorMarkers } from "./workspace/commentAnchor.js";
import { findInlineTagsInLine } from "./tagRule.js";
import { isOpenTaskState, scanTasks, taskBoxChar, taskBoxState, type TaskBoxState } from "./vault/taskScan.js";
import { setChecklistTaskDone, type ChecklistMutationOptions } from "./vault/taskMutation.js";

export const DEFAULT_JOURNAL_HEADING = "Journal";

/** What a settings field may hold: `## Journal`, ` Journal ` and `` all mean something. */
export function normalizeJournalHeading(value: string | null | undefined): string {
  const text = (value ?? "").replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim();
  return text || DEFAULT_JOURNAL_HEADING;
}

export interface JournalEntry {
  /** 0-based index of the entry's first line in the note. */
  line: number;
  /** Lines the entry spans: continuation lines count, blank lines after it do not. */
  lineCount: number;
  /** The time as written: `HH:mm` or `HH:mm:ss` (a single-digit hour is read too). */
  time: string;
  /** Seconds since midnight — what entries are ordered by. */
  seconds: number;
  /** The text without marker, box and time; continuation lines dedented, comment anchors removed. */
  text: string;
  /** What the box holds when the entry is a task (`- [ ] 14:05 …`), otherwise `null`. */
  task: TaskBoxState | null;
  /** Inline `#tags`, in order of appearance, each once. */
  tags: string[];
  /** The exact source lines without their line endings — finds the entry again after the file changed. */
  source: string[];
}

export interface JournalSection {
  /** The heading the entries stand under; `null` when the note has none. */
  heading: { line: number; level: number; text: string } | null;
  entries: JournalEntry[];
}

/** Enough of an entry to find it again. */
export type JournalEntryRef = Pick<JournalEntry, "line" | "source">;

export type JournalEditFailure = "empty" | "time" | "missing" | "unplaceable";
export type JournalEdit =
  | { ok: true; content: string; entry: JournalEntry; createdHeading: boolean }
  | { ok: false; reason: JournalEditFailure };
export type JournalRemoval = { ok: true; content: string; removed: JournalEntry } | { ok: false; reason: JournalEditFailure };

export interface JournalOptions { heading?: string | null }

const ENTRY_LINE = /^(?<prefix>(?<indent> {0,3})(?<marker>[-*+])(?<gap>[ \t]+)(?:\[(?<box>[ xX/-])\](?<boxGap>[ \t]+))?)(?<time>(?<h>\d{1,2}):(?<m>\d{2})(?::(?<s>\d{2}))?)(?=[ \t]|$)[ \t]*(?<rest>.*)$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function secondsOf(h: string, m: string, s: string | undefined): number | null {
  const hours = Number(h), minutes = Number(m), seconds = s === undefined ? 0 : Number(s);
  return hours < 24 && minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

/** `HH:mm` (or `HH:mm:ss`) of a moment, in the device's local time — what an entry is stamped with. */
export function journalTimeOf(date: Date, withSeconds = false): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}${withSeconds ? `:${two(date.getSeconds())}` : ""}`;
}

/**
 * Whether ONE line opens a journal entry, judged without any context — what the
 * sync merge needs, which sees lines and no sections. `parseJournal` is the
 * stricter reader: it also knows the heading and the code fences.
 */
export function readJournalLine(line: string): { seconds: number; task: TaskBoxState | null } | null {
  const match = ENTRY_LINE.exec(line.replace(/\r$/, ""));
  if (!match?.groups) return null;
  const seconds = secondsOf(match.groups.h, match.groups.m, match.groups.s);
  return seconds === null ? null : { seconds, task: match.groups.box === undefined ? null : taskBoxState(match.groups.box) };
}

// ---------------------------------------------------------------- lines

interface SourceLine { text: string; eol: string }

/** Splits without losing a byte: `joinLines(splitLines(raw)) === raw`. A final line break adds no empty line. */
function splitLines(raw: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const breaks = /\r\n|\n/g;
  let cursor = 0;
  for (let match = breaks.exec(raw); match; match = breaks.exec(raw)) {
    lines.push({ text: raw.slice(cursor, match.index), eol: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < raw.length) lines.push({ text: raw.slice(cursor), eol: "" });
  return lines;
}

const joinLines = (lines: SourceLine[]): string => lines.map((line) => line.text + line.eol).join("");
const isBlank = (line: SourceLine | undefined): boolean => !line || line.text.trim() === "";
const fileEol = (lines: SourceLine[]): string => lines.find((line) => line.eol)?.eol ?? "\n";

/**
 * Inserts lines after `index` (`-1` = at the top). A note that ended without a
 * line break still ends without one; an empty note gets one.
 */
function insertAfter(lines: SourceLine[], index: number, texts: string[]): SourceLine[] {
  const next = lines.map((line) => ({ ...line }));
  const eol = next[index]?.eol || fileEol(next);
  const added = texts.map((text) => ({ text, eol }));
  if (index >= 0 && next[index].eol === "") {
    next[index].eol = eol;
    added[added.length - 1].eol = "";
  }
  next.splice(index + 1, 0, ...added);
  return next;
}

// ---------------------------------------------------------------- reading

interface ParsedEntry extends JournalEntry { marker: string; loose: boolean }
interface ParsedSection {
  lines: SourceLine[];
  heading: { line: number; lastLine: number; level: number; text: string } | null;
  /** First line after the section (exclusive). */
  endLine: number;
  entries: ParsedEntry[];
  /** The last top-level block inside the section, if any. */
  lastNode: NoteOutlineNode | null;
}

const sameHeading = (a: string, b: string): boolean => a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();

function dedent(text: string, column: number): string {
  if (text.startsWith("\t")) return text.slice(1);
  let cut = 0;
  while (cut < column && text[cut] === " ") cut++;
  return text.slice(cut);
}

function parseSection(raw: string, options: JournalOptions): ParsedSection {
  const lines = splitLines(raw);
  const wanted = normalizeJournalHeading(options.heading);
  const outline = analyzeNoteOutline(raw);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.text.length + line.eol.length; }
  const lineOf = (at: number): number => {
    let lo = 0, hi = starts.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= at) lo = mid + 1; else hi = mid; }
    return Math.max(0, lo - 1);
  };
  const lastLineOf = (node: { from: number; to: number }) => lineOf(Math.max(node.from, node.to - 1));

  const at = outline.findIndex((node) => node.type === "heading" && sameHeading(node.text ?? "", wanted));
  if (at < 0) return { lines, heading: null, endLine: lines.length, entries: [], lastNode: null };
  const head = outline[at];
  const closing = outline.find((node, i) => i > at && node.type === "heading" && node.level! <= head.level!);
  const endLine = closing ? closing.line - 1 : lines.length;
  const inside = outline.filter((node, i) => i > at && node.line - 1 < endLine);
  const entries: ParsedEntry[] = [];
  for (const list of inside) {
    if (list.type !== "list" || !list.items) continue;
    const loose = list.items.some((item, i) => i > 0 && isBlank(lines[item.line - 2]));
    for (const item of list.items) {
      const first = item.line - 1;
      const match = ENTRY_LINE.exec(lines[first]?.text ?? "");
      if (!match?.groups) continue;
      const seconds = secondsOf(match.groups.h, match.groups.m, match.groups.s);
      if (seconds === null) continue;
      const last = Math.max(first, lastLineOf(item));
      const source = lines.slice(first, last + 1).map((line) => line.text);
      const column = match.groups.indent.length + match.groups.marker.length + match.groups.gap.length;
      const body = [match.groups.rest, ...source.slice(1).map((text) => dedent(text, column))];
      const text = stripAnchorMarkers(body.join("\n")).text.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
      const tags: string[] = [];
      for (const part of text.split("\n")) for (const tag of findInlineTagsInLine(part)) if (!tags.includes(tag.name)) tags.push(tag.name);
      entries.push({
        line: first, lineCount: last - first + 1, time: match.groups.time, seconds, text,
        task: match.groups.box === undefined ? null : taskBoxState(match.groups.box), tags, source,
        marker: match.groups.marker, loose,
      });
    }
  }
  return {
    lines,
    heading: { line: head.line - 1, lastLine: lastLineOf(head), level: head.level!, text: head.text ?? "" },
    endLine, entries, lastNode: inside[inside.length - 1] ?? null,
  };
}

const publicEntry = ({ marker: _marker, loose: _loose, ...entry }: ParsedEntry): JournalEntry => entry;

/** The journal of one note: the heading that carries it and its entries in file order. */
export function parseJournal(raw: string, options: JournalOptions = {}): JournalSection {
  const section = parseSection(raw, options);
  return {
    heading: section.heading ? { line: section.heading.line, level: section.heading.level, text: section.heading.text } : null,
    entries: section.entries.map(publicEntry),
  };
}

// ---------------------------------------------------------------- writing

function entryLines(prefix: string, column: number, time: string, text: string): string[] {
  const parts = text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\s+|\n+$/g, "").split("\n");
  const pad = " ".repeat(column);
  return [`${prefix}${time}${parts[0] ? ` ${parts[0]}` : ""}`, ...parts.slice(1).map((part) => (part ? pad + part : ""))];
}

const sameSource = (a: string[], b: string[]): boolean => a.length === b.length && a.every((text, i) => text === b[i]);

/** The edit counts only when a fresh parse finds the entry exactly where it was put. */
function confirmed(lines: SourceLine[], line: number, source: string[], options: JournalOptions, createdHeading: boolean): JournalEdit | null {
  const content = joinLines(lines);
  const entry = parseJournal(content, options).entries.find((e) => e.line === line && sameSource(e.source, source));
  return entry ? { ok: true, content, entry, createdHeading } : null;
}

export interface JournalInsert extends JournalOptions {
  /** `HH:mm` or `HH:mm:ss`. */
  time: string;
  text: string;
  /** Write the entry as a task (`- [ ] 14:05 …`). */
  task?: TaskBoxState | null;
}

function placeEntry(raw: string, options: JournalOptions, build: (marker: string) => string[], place: { seconds: number } | "end"): JournalEdit {
  const section = parseSection(raw, options);
  const { lines } = section;
  const lastEntry = section.entries[section.entries.length - 1];
  const source = build(lastEntry?.marker ?? "-");

  if (!section.heading) {
    let last = lines.length - 1;
    while (last >= 0 && isBlank(lines[last])) last--;
    const title = `## ${normalizeJournalHeading(options.heading)}`;
    const hasGap = last >= 0 && last < lines.length - 1;
    const lead = last < 0 ? [title, ""] : hasGap ? [title, ""] : ["", title, ""];
    const after = last < 0 ? -1 : hasGap ? last + 1 : last;
    return confirmed(insertAfter(lines, after, [...lead, ...source]), after + 1 + lead.length, source, options, true) ?? { ok: false, reason: "unplaceable" };
  }

  const head = section.heading;
  if (place !== "end" && section.entries.length) {
    // Back to where the clock puts it: after the last entry that is not later.
    const before = [...section.entries].reverse().find((e) => e.seconds <= place.seconds);
    const first = section.entries[0];
    const result = before
      ? confirmed(insertAfter(lines, before.line + before.lineCount - 1, before.loose ? ["", ...source] : source), before.line + before.lineCount + (before.loose ? 1 : 0), source, options, false)
      : confirmed(insertAfter(lines, first.line - 1, first.loose ? [...source, ""] : source), first.line, source, options, false);
    if (result) return result;
  }

  let last = section.endLine - 1;
  while (last > head.lastLine && isBlank(lines[last])) last--;
  if (last > head.lastLine) {
    const tight = section.lastNode?.type === "list" && !(lastEntry && lastEntry.line + lastEntry.lineCount - 1 === last && lastEntry.loose);
    const result = confirmed(insertAfter(lines, last, tight ? source : ["", ...source]), last + (tight ? 1 : 2), source, options, false);
    if (result) return result;
  } else {
    const blanks = section.endLine - 1 - head.lastLine;
    const closes = section.endLine < lines.length;
    const result = blanks === 0
      ? confirmed(insertAfter(lines, head.lastLine, ["", ...source, ...(closes ? [""] : [])]), head.lastLine + 2, source, options, false)
      : confirmed(insertAfter(lines, head.lastLine + 1, [...source, ...(blanks === 1 && closes ? [""] : [])]), head.lastLine + 2, source, options, false);
    if (result) return result;
  }

  // The end of the section swallows what is appended. Directly under the heading it can be read.
  const gap = head.lastLine + 1 < lines.length && isBlank(lines[head.lastLine + 1]);
  const under = gap
    ? confirmed(insertAfter(lines, head.lastLine + 1, [...source, ""]), head.lastLine + 2, source, options, false)
    : confirmed(insertAfter(lines, head.lastLine, ["", ...source, ""]), head.lastLine + 2, source, options, false);
  return under ?? { ok: false, reason: "unplaceable" };
}

/**
 * Appends an entry at the end of the journal section — the file reads
 * chronologically. A missing heading is created at the end of the note, one
 * blank line away from what stands there, never in the middle of the text.
 */
export function insertJournalEntry(raw: string, insert: JournalInsert): JournalEdit {
  const time = TIME.exec(insert.time.trim());
  if (!time || secondsOf(time[1], time[2], time[3]) === null) return { ok: false, reason: "time" };
  if (!insert.text.trim()) return { ok: false, reason: "empty" };
  const box = insert.task ? `[${taskBoxChar(insert.task)}] ` : "";
  return placeEntry(raw, insert, (marker) => entryLines(`${marker} ${box}`, 2, insert.time.trim(), insert.text), "end");
}

/** Puts a removed entry back, spelled exactly as it was, at the place its time gives it. */
export function restoreJournalEntry(raw: string, entry: Pick<JournalEntry, "source" | "seconds">, options: JournalOptions = {}): JournalEdit {
  if (!entry.source.length || !readJournalLine(entry.source[0])) return { ok: false, reason: "missing" };
  return placeEntry(raw, options, () => entry.source, { seconds: entry.seconds });
}

function locate(section: ParsedSection, ref: JournalEntryRef): ParsedEntry | null {
  const exact = section.entries.find((e) => e.line === ref.line && sameSource(e.source, ref.source));
  if (exact) return exact;
  // The file moved on since it was read. The same spelling still names the entry;
  // of two that are spelled alike, the nearer one.
  const alike = section.entries.filter((e) => sameSource(e.source, ref.source));
  return alike.sort((a, b) => Math.abs(a.line - ref.line) - Math.abs(b.line - ref.line))[0] ?? null;
}

function replaceLines(lines: SourceLine[], entry: ParsedEntry, texts: string[]): SourceLine[] {
  const next = lines.map((line) => ({ ...line }));
  const eol = next[entry.line].eol || fileEol(next);
  const closing = next[entry.line + entry.lineCount - 1].eol;
  const added = texts.map((text, i) => ({ text, eol: i === texts.length - 1 ? closing : eol }));
  next.splice(entry.line, entry.lineCount, ...added);
  return next;
}

/** New text (and, if given, a new time) for one entry. Indent, marker, box and the spelling of the time stay. */
export function replaceJournalEntry(raw: string, ref: JournalEntryRef, change: { text: string; time?: string }, options: JournalOptions = {}): JournalEdit {
  if (!change.text.trim()) return { ok: false, reason: "empty" };
  const time = change.time?.trim();
  if (time !== undefined) {
    const parts = TIME.exec(time);
    if (!parts || secondsOf(parts[1], parts[2], parts[3]) === null) return { ok: false, reason: "time" };
  }
  const section = parseSection(raw, options);
  const entry = locate(section, ref);
  const groups = entry && ENTRY_LINE.exec(entry.source[0])?.groups;
  if (!entry || !groups) return { ok: false, reason: "missing" };
  const column = groups.indent.length + groups.marker.length + groups.gap.length;
  const source = entryLines(groups.prefix, column, time ?? groups.time, change.text);
  return confirmed(replaceLines(section.lines, entry, source), entry.line, source, options, false) ?? { ok: false, reason: "unplaceable" };
}

/** Makes an entry a task (`- [ ] 14:05 …`), sets what its box holds, or — with `null` — takes the box away. */
export function setJournalEntryTask(raw: string, ref: JournalEntryRef, task: TaskBoxState | null, options: JournalOptions = {}): JournalEdit {
  const section = parseSection(raw, options);
  const entry = locate(section, ref);
  const groups = entry && ENTRY_LINE.exec(entry.source[0])?.groups;
  if (!entry || !groups) return { ok: false, reason: "missing" };
  const lead = groups.indent + groups.marker + groups.gap;
  const box = task === null ? "" : `[${taskBoxChar(task)}]${groups.boxGap ?? " "}`;
  const source = [lead + box + entry.source[0].slice(groups.prefix.length), ...entry.source.slice(1)];
  return confirmed(replaceLines(section.lines, entry, source), entry.line, source, options, false) ?? { ok: false, reason: "unplaceable" };
}

/**
 * A click on the box of a task entry. It goes through the checklist mutation of
 * the task view, so the completion date and the successor of a repeating task
 * behave exactly as they do there.
 */
export function toggleJournalTask(raw: string, ref: JournalEntryRef, options: JournalOptions & ChecklistMutationOptions = {}): JournalEdit {
  const entry = locate(parseSection(raw, options), ref);
  if (!entry || entry.task === null) return { ok: false, reason: "missing" };
  const task = scanTasks(raw).find((t) => t.line === entry.line);
  if (!task) return { ok: false, reason: "missing" };
  const result = setChecklistTaskDone(raw, task.ordinal, isOpenTaskState(entry.task), options);
  if (!result.changed) return { ok: false, reason: "missing" };
  // A repeating task writes its successor ABOVE itself: the toggled entry moved down by that much.
  const moved = splitLines(result.content).length - splitLines(raw).length;
  const after = parseJournal(result.content, options).entries.find((e) => e.line === entry.line + moved);
  return after ? { ok: true, content: result.content, entry: after, createdHeading: false } : { ok: false, reason: "unplaceable" };
}

/**
 * Removes one entry with its continuation lines. In a list with blank lines
 * between the items, the blank line in front goes with it, so removing never
 * leaves a double gap behind.
 */
export function removeJournalEntry(raw: string, ref: JournalEntryRef, options: JournalOptions = {}): JournalRemoval {
  const section = parseSection(raw, options);
  const entry = locate(section, ref);
  if (!entry) return { ok: false, reason: "missing" };
  const next = section.lines.map((line) => ({ ...line }));
  const end = entry.line + entry.lineCount;
  const gapBefore = entry.line > 0 && isBlank(next[entry.line - 1]);
  const from = gapBefore && isBlank(next[end]) ? entry.line - 1 : entry.line;
  const closing = next[end - 1].eol;
  next.splice(from, end - from);
  // The note ended without a line break, and it still does.
  if (closing === "" && from > 0 && from === next.length) next[from - 1].eol = "";
  return { ok: true, content: joinLines(next), removed: publicEntry(entry) };
}
