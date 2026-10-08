/**
 * The notes a text names (plan KI-Harness P5-7): what the source check reads
 * before an assistant's text is laid down.
 *
 * A model is asked to name a note as a wiki link. A link is therefore the one
 * thing in its text that claims "this is in your vault" — and the one such
 * claim that can be checked without a second model. Nothing here judges a
 * statement; it finds the names, and whoever lays the text down asks the vault
 * whether a note of that name is there. A link to nothing is not forbidden: a
 * proposal may link to a note that is drafted in the same breath. It is
 * pointed out, to the model and to the user.
 *
 * Read the way the egress gate reads references: `[[Note]]`,
 * `[[Note#Heading]]`, `[[Note|alias]]` and the embeds `![[Note]]`, outside
 * code. `[[#Heading]]` names a place in the note itself, and a name with a
 * file's extension other than `.md` names a file — a picture, a database —,
 * which is not this check's to find.
 */

const WIKI_LINK = /!?\[\[([^[\]|#\n]*)(?:#[^[\]|\n]*)?(?:\|[^[\]\n]*)?\]\]/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A name that ends like a file: a dot and one to five letters or digits. */
const FILE_EXTENSION = /\.([a-z0-9]{1,5})$/i;

/** How many names one text is asked about, and how many of the missing ones are named back. */
export const LINK_CHECK_LIMITS = { targets: 100, named: 8 } as const;

/**
 * What the vault answers about one linked name. `note`: it leads to a note
 * this run may know of. `none`: no note of that name. `withheld`: there is
 * one, and the rules keep it from this recipient or this conversation.
 *
 * The last two are ONE answer to a model — a name must not be found out by
 * trying it, here as for every read — and two to the user, whose vault it is:
 * "not in this vault" would be untrue of a note that is there.
 */
export type LinkedNoteState = "note" | "none" | "withheld";

/**
 * The names a source check found no note for, sorted for whoever is told.
 * `told` is for the model: both kinds, in the order the text gives them,
 * undistinguished. `missing` and `withheld` are for the user and the record on
 * the device — `withheld` names notes the rules keep back, so nothing that
 * holds it may ever be sent to a model.
 */
export interface LinkCheckResult {
  told: string[];
  missing: string[];
  withheld: string[];
}

/**
 * A line with its code spans blanked, as CommonMark reads them: a run of
 * backticks opens a span that the next run of exactly as many closes; a run
 * nothing closes is text. Scanned by hand, in one pass over the line's runs —
 * a pattern with a back-reference takes quadratic time on a line a model made
 * of backticks.
 */
function withoutCodeSpans(line: string): string {
  if (!line.includes("`")) return line;
  const runs: { start: number; length: number }[] = [];
  for (let index = 0; index < line.length; ) {
    if (line[index] !== "`") {
      index++;
      continue;
    }
    let end = index;
    while (end < line.length && line[end] === "`") end++;
    runs.push({ start: index, length: end - index });
    index = end;
  }
  // The runs of each length, in order, and how far each list has been used: a pointer only moves forward.
  const byLength = new Map<number, number[]>();
  runs.forEach((run, at) => {
    const same = byLength.get(run.length);
    if (same) same.push(at);
    else byLength.set(run.length, [at]);
  });
  const used = new Map<number, number>();
  let out = "";
  let copied = 0;
  for (let at = 0; at < runs.length; at++) {
    const open = runs[at]!;
    const same = byLength.get(open.length)!;
    let next = used.get(open.length) ?? 0;
    while (next < same.length && same[next]! <= at) next++;
    used.set(open.length, next);
    if (next >= same.length) continue;
    const close = runs[same[next]!]!;
    const end = close.start + close.length;
    out += line.slice(copied, open.start) + " ".repeat(end - open.start);
    copied = end;
    // What lies between the two runs is the span's content: the scan goes on behind the closing run.
    at = same[next]!;
  }
  return out + line.slice(copied);
}

/** The text without what is code in it: a fenced block and a code span say `[[x]]` without linking anything. */
function withoutCode(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const mark = FENCE.exec(line)?.[1];
    if (fence !== null) {
      // A fence closes with at least as many of the same character as opened it.
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = null;
      out.push("");
      continue;
    }
    // A fence of backticks carries no backtick behind its run: "```a``` and [[b]]" is a paragraph with a span in
    // it, not the start of a block that would hide the rest of the text from the check.
    if (mark && !(mark[0] === "`" && line.slice(line.indexOf(mark) + mark.length).includes("`"))) {
      fence = mark;
      out.push("");
      continue;
    }
    out.push(withoutCodeSpans(line));
  }
  return out.join("\n");
}

/** Whether a link's name is a note's: no extension, or `.md`. */
function namesANote(target: string): boolean {
  const extension = FILE_EXTENSION.exec(target)?.[1]?.toLowerCase();
  return extension === undefined || extension === "md";
}

/**
 * The note a link's name stands for, as it is asked for: without the `.md` a
 * link may spell out — `[[Brief.md]]` and `[[Brief]]` are one note.
 */
export function linkedNoteName(target: string): string {
  return target.replace(/\.md$/i, "");
}

/** One note, whatever its letter case and whether its extension is written. */
const sameNote = (target: string) => linkedNoteName(target).toLowerCase();

/**
 * The notes a text links to, by the name each link gives — in the order of
 * their first appearance, each once whatever its letter case and with or
 * without its extension, at most `LINK_CHECK_LIMITS.targets`.
 */
export function linkedNoteTargets(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of withoutCode(text.replace(/\r\n?/g, "\n")).matchAll(WIKI_LINK)) {
    const target = (match[1] ?? "").trim();
    if (!target || !namesANote(target)) continue;
    const key = sameNote(target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push(target);
    if (found.length >= LINK_CHECK_LIMITS.targets) break;
  }
  return found;
}

/**
 * The notes `next` links to that `base` did not: what a change ADDS. A link
 * the note already had is the user's own — or was decided before — and is not
 * asked about again.
 */
export function addedNoteTargets(base: string, next: string): string[] {
  const had = new Set(linkedNoteTargets(base).map(sameNote));
  return linkedNoteTargets(next).filter((target) => !had.has(sameNote(target)));
}

/** A list of names as a draft or a run's record keeps it: text, bounded, without what a name cannot be. */
export function parseMissingLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > 300 || /[\n\r[\]|#]/.test(name)) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length >= LINK_CHECK_LIMITS.targets) break;
  }
  return out;
}
