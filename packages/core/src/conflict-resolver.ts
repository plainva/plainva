import { diff3Merge, diffIndices, merge } from "node-diff3";
import { alignTaskSyncMetadata, classifyTaskNotes } from "./pim/taskNoteIdentity.js";
import { readJournalLine } from "./journal.js";

export type MergeResult = {
  mergedText: string;
  hasConflicts: boolean;
};

const splitLines = (text: string): string[] => text.split(/\r?\n/);

// ---------------------------------------------------------------- journal

/**
 * Two devices that append to the journal of the same daily note insert at the
 * SAME place — the end of the section. A line-wise diff3 can only call that a
 * conflict, and a journal on two devices would produce a `.CONFLICT` copy a day.
 * So this one case is decided here (plan Journal, E6): where both sides did
 * nothing but insert journal entries at one place, the entries are united by
 * their time. Everything else stays on the careful path.
 */
interface JournalGroup { lead: number; lines: string[]; seconds: number }

const isBlank = (line: string): boolean => line.trim() === "";
/**
 * An entry starts at the margin. An indented line that looks like one is part
 * of the entry above it and must never be sorted away from it.
 */
const entryAtMargin = (line: string) => (/^[-*+]/.test(line) ? readJournalLine(line) : null);
const isListLine = (line: string): boolean => entryAtMargin(line) !== null || /^[ \t]+\S/.test(line);

/** Entries with their continuation lines; `null` as soon as any other line is among them. */
function journalGroups(lines: string[]): { groups: JournalGroup[]; trail: number } | null {
  const groups: JournalGroup[] = [];
  let blanks = 0;
  for (const line of lines) {
    const entry = entryAtMargin(line);
    if (entry) { groups.push({ lead: blanks, lines: [line], seconds: entry.seconds }); blanks = 0; continue; }
    if (isBlank(line)) { blanks++; continue; }
    const open = groups[groups.length - 1];
    if (!open || !/^[ \t]/.test(line)) return null;
    for (; blanks > 0; blanks--) open.lines.push("");
    open.lines.push(line);
  }
  return { groups, trail: blanks };
}

/**
 * The lines of a note with every journal entry as ONE unit, continuation lines
 * and the blank lines inside it included. A line-wise diff is free to align the
 * blank line inside an entry with a blank line of the ancestor, and then half
 * the entry stands in front of the other device's entry and half behind it.
 * A unit cannot be split.
 */
function journalUnits(lines: string[]): string[] {
  const units: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let end = i;
    if (entryAtMargin(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (isBlank(lines[j])) continue;
        if (!/^[ \t]/.test(lines[j])) break;
        end = j;
      }
    }
    units.push(lines.slice(i, end + 1).join("\n"));
    i = end;
  }
  return units;
}

const unitLines = (units: string[]): string[] => units.flatMap((unit) => unit.split("\n"));

/** Blank lines, then at most one heading, then blank lines: the section a device had to create first. */
function scaffoldLength(lines: string[]): number {
  let at = 0;
  while (at < lines.length && lines[at].trim() === "") at++;
  if (at < lines.length && /^#{1,6}[ \t]+\S/.test(lines[at])) at++;
  else return 0;
  while (at < lines.length && lines[at].trim() === "") at++;
  return at;
}

const sameLines = (a: string[], b: string[]): boolean => a.length === b.length && a.every((line, i) => line === b[i]);

/**
 * What both sides inserted at one place, united — or `null` when the lines are
 * not purely journal entries. `before` holds the lines in front of the place.
 */
function uniteJournalLines(a: string[], b: string[], before: string[], withoutBase: boolean): string[] | null {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const prefix = a.slice(0, head), suffix = tail ? a.slice(a.length - tail) : [];
  let restA = a.slice(head, a.length - tail), restB = b.slice(head, b.length - tail);

  // Without a common ancestor, a section only ONE side has is that side's to keep.
  let scaffold: string[] = [];
  if (withoutBase && (restA.length === 0) !== (restB.length === 0)) {
    const rest = restA.length ? restA : restB;
    scaffold = rest.slice(0, scaffoldLength(rest));
    if (restA.length) restA = restA.slice(scaffold.length); else restB = restB.slice(scaffold.length);
  }

  const left = journalGroups(restA), right = journalGroups(restB);
  if (!left || !right || left.groups.length + right.groups.length === 0) return null;

  // A list that sets a blank line between its items gets one between the united
  // entries too. Under a heading the same blank line is padding and stands once.
  // Judged by what stands in front, because the diff is free to put the blank
  // line of such a list before the inserted entry or behind it.
  const context = [...before, ...prefix, ...scaffold];
  let gap = 0;
  while (gap < context.length && isBlank(context[context.length - 1 - gap])) gap++;
  const previous = context[context.length - 1 - gap];
  const separator = gap > 0 && previous !== undefined && isListLine(previous) ? gap : 0;

  // The same entry on both sides is one entry.
  const taken = new Set<JournalGroup>();
  const theirs = right.groups.filter((group) => {
    const twin = left.groups.find((own) => !taken.has(own) && sameLines(own.lines, group.lines));
    if (twin) taken.add(twin);
    return !twin;
  });

  // By time, the local side first on a tie. Neither side's own order is ever changed.
  const out: string[] = [...prefix, ...scaffold];
  let i = 0, j = 0, first = true;
  while (i < left.groups.length || j < theirs.length) {
    const own = left.groups[i], other = theirs[j];
    const group = !other || (own && own.seconds <= other.seconds) ? left.groups[i++] : theirs[j++];
    for (let n = first ? group.lead : Math.max(group.lead, separator); n > 0; n--) out.push("");
    out.push(...group.lines);
    first = false;
  }
  for (let n = Math.max(left.trail, right.trail); n > 0; n--) out.push("");
  return [...out, ...suffix];
}

/** The three-way result when every conflict is journal entries inserted at one place; otherwise `null`. */
function uniteJournalConflicts(yours: string[], base: string[], theirs: string[]): string[] | null {
  const out: string[] = [];
  for (const region of diff3Merge(journalUnits(yours), journalUnits(base), journalUnits(theirs), { excludeFalseConflicts: true })) {
    if (region.ok) { out.push(...unitLines(region.ok)); continue; }
    const conflict = region.conflict!;
    // Only pure insertions: nothing of the common ancestor is replaced or removed.
    if (conflict.o.length > 0) return null;
    const united = uniteJournalLines(unitLines(conflict.a), unitLines(conflict.b), out, false);
    if (!united) return null;
    out.push(...united);
  }
  return out;
}

/**
 * Two versions of a note and no common ancestor — both devices created today's
 * daily note before either had seen the other's. Where the two differ ONLY in
 * journal entries (and the journal section one of them had to create), nothing
 * is in doubt: every line of both is kept, the entries united by their time.
 * Any other difference is a conflict, as it always was.
 */
export function mergeWithoutBase(yours: string, theirs: string): MergeResult {
  if (classifyTaskNotes(yours, theirs) === "different") return { mergedText: yours, hasConflicts: true };
  const a = journalUnits(splitLines(yours)), b = journalUnits(splitLines(theirs));
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of diffIndices(a, b)) {
    out.push(...unitLines(a.slice(cursor, hunk.buffer1[0])));
    const united = uniteJournalLines(unitLines(hunk.buffer1Content), unitLines(hunk.buffer2Content), out, true);
    if (!united) return { mergedText: yours, hasConflicts: true };
    out.push(...united);
    cursor = hunk.buffer1[0] + hunk.buffer1[1];
  }
  out.push(...unitLines(a.slice(cursor)));
  return { mergedText: out.join("\n"), hasConflicts: false };
}

// ---------------------------------------------------------------- three-way

/**
 * Performs a 3-way text merge using diff3.
 *
 * @param base The original common ancestor text
 * @param yours The local text changes
 * @param theirs The remote text changes
 * @returns An object containing the merged text (with conflict markers if any) and a boolean indicating if conflicts exist.
 */
export function mergeText(base: string, yours: string, theirs: string): MergeResult {
  // Different provider tasks can occupy the same legacy filename. Even a
  // clean line merge must never combine their fields into a third task.
  if (classifyTaskNotes(yours, theirs) === "different") return { mergedText: yours, hasConflicts: true };
  if (classifyTaskNotes(base, yours) === "same" && classifyTaskNotes(yours, theirs) === "same") {
    base = alignTaskSyncMetadata(base, theirs);
    yours = alignTaskSyncMetadata(yours, theirs);
    theirs = alignTaskSyncMetadata(theirs, theirs);
  }
  const baseLines = splitLines(base);
  const yoursLines = splitLines(yours);
  const theirsLines = splitLines(theirs);

  const result = merge(yoursLines, baseLines, theirsLines);
  if (result.conflict) {
    // Nothing that merges cleanly today takes this path.
    const united = uniteJournalConflicts(yoursLines, baseLines, theirsLines);
    if (united) return { mergedText: united.join("\n"), hasConflicts: false };
  }

  return {
    mergedText: result.result.join("\n"),
    hasConflicts: result.conflict
  };
}

/** A read-back contains the intended change, possibly with additional edits. */
export function containsTextChanges(base: string, intended: string, actual: string): boolean {
  if (actual === intended) return true;
  const result = mergeText(base, intended, actual);
  return !result.hasConflicts && result.mergedText === actual;
}

/** Editor input can continue on the same line as a confirmed external write.
 * Keep whole words atomic: two competing edits to one word still conflict.
 * Bound the fallback after trimming the shared prefix/suffix; large divergent
 * documents retain the ordinary conflict-copy path instead of costly diffing. */
export function mergeEditorText(base: string, yours: string, theirs: string): MergeResult {
  const lines = mergeText(base, yours, theirs);
  if (!lines.hasConflicts) return lines;
  const tokenize = (text: string) => text.match(/\s+|\S+/gu) ?? [];
  const a = tokenize(yours), o = tokenize(base), b = tokenize(theirs);
  let start = 0;
  while (start < a.length && start < o.length && start < b.length && a[start] === o[start] && o[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < o.length - start && end < b.length - start
    && a[a.length - end - 1] === o[o.length - end - 1] && o[o.length - end - 1] === b[b.length - end - 1]) end++;
  if (a.length + o.length + b.length - 3 * (start + end) > 4096) return lines;
  const middle = (tokens: string[]) => tokens.slice(start, tokens.length - end);
  const ancestor = middle(o);
  const changes = (tokens: string[]) => diffIndices(ancestor, middle(tokens)).map((change) => ({
    from: change.buffer1[0], to: change.buffer1[0] + change.buffer1[1], insert: change.buffer2Content,
  }));
  const left = changes(a), right = changes(b);
  const edits = [...left];
  for (const r of right) {
    let duplicate = false;
    for (const l of left) {
      if (l.from === r.from && l.to === r.to && l.insert.join("") === r.insert.join("")) { duplicate = true; break; }
      // Insertions at opposite edges of a replaced word are independent;
      // insertions inside it, overlapping replacements and competing inserts
      // at the same boundary require the ordinary conflict-copy path.
      const overlap = l.from === l.to && r.from === r.to ? l.from === r.from
        : l.from === l.to ? r.from < l.from && l.from < r.to
        : r.from === r.to ? l.from < r.from && r.from < l.to
        : l.from < r.to && r.from < l.to;
      if (overlap) return lines;
    }
    if (!duplicate) edits.push(r);
  }
  for (const edit of edits.sort((l, r) => r.from - l.from || r.to - l.to)) ancestor.splice(edit.from, edit.to - edit.from, ...edit.insert);
  return { mergedText: [...o.slice(0, start), ...ancestor, ...(end ? o.slice(o.length - end) : [])].join(""), hasConflicts: false };
}
