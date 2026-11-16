import { createFenceTracker } from "../markdownFence.js";

/**
 * Coverage of an answer (plan KI-Harness P2b-5, §21 citation duty): how many
 * of its statements name a note. A statement is a paragraph or a list item
 * of prose — headings, code, tables and quotes are not; a statement is
 * covered when it carries a wiki link, the form the package asks the model to
 * cite in. Shown after the answer, beside what was sent, so a reader sees at
 * a glance whether the answer rests on the notes or on the model alone.
 */

export type CoverageLevel = "high" | "partial" | "low";

export interface AnswerCoverage {
  statements: number;
  cited: number;
  /** Null when the answer has no statement to judge (a greeting, a table only). */
  level: CoverageLevel | null;
}

/** Shorter than this, a line is a phrase ("Sure!", "Sources:"), not a statement. */
const MIN_STATEMENT = 24;
const HIGH = 0.8;
const PARTIAL = 0.4;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const CITATION = /\[\[[^[\]\n]+\]\]/;

/** The statements of an answer, in order. */
export function answerStatements(answer: string): string[] {
  const out: string[] = [];
  // What is code, the one fence rule of every scanner says (`markdownFence.ts`).
  const fence = createFenceTracker();
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join(" ").trim();
    if (text.length >= MIN_STATEMENT) out.push(text);
    paragraph = [];
  };
  for (const line of answer.split("\n")) {
    const trimmed = line.trim();
    const kind = fence.step(line);
    if (kind === "open" || kind === "close") {
      flush();
      continue;
    }
    if (kind === "code") continue;
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("|") || trimmed.startsWith(">")) {
      flush();
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      paragraph.push(trimmed.replace(LIST_ITEM, ""));
      flush();
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return out;
}

export function answerCoverage(answer: string): AnswerCoverage {
  const statements = answerStatements(answer);
  const cited = statements.filter((statement) => CITATION.test(statement)).length;
  if (!statements.length) return { statements: 0, cited: 0, level: null };
  const share = cited / statements.length;
  return { statements: statements.length, cited, level: share >= HIGH ? "high" : share >= PARTIAL ? "partial" : "low" };
}

/** What a run had of the vault: the notes its context carried, and the ones its tools read (`RunMeta`). */
export interface AnswerGrounding {
  /** Paths of the notes the context carried. */
  sent: readonly string[];
  /** Paths of the notes the run's tools read. */
  read?: readonly string[];
  /** The tools read more than `read` lists: then nothing is known about what was not read. */
  readMore?: boolean;
  /** Titles the sent notes go by (a `title` property), beside their file names — a link may name either (ADR 0027). */
  titles?: readonly string[];
}

const LINK = /(!?)\[\[([^[\]\n]+)\]\]/g;
const INLINE_CODE = /`[^`\n]*`/g;

/** A link target or a path as one comparable name: no heading or alias, no `.md`, case-insensitive. */
function linkKey(target: string): string {
  return target.split("|")[0]!.split("#")[0]!.trim().replace(/\.md$/i, "").normalize("NFC").toLowerCase();
}

/**
 * The notes an answer names as its source although the run never had them
 * (plan Oberfläche O7, E2): a `[[link]]` to a note that neither went with the
 * request nor was read by a tool. That is the one claim about notes the app
 * can check without a second model — the answer says "this note says so",
 * and the app knows the model never saw that note. It is what earns a
 * warning under an answer; an answer that cites less than it could gets the
 * calm line, and its coverage stays in the details.
 *
 * Embeds (`![[…]]`) and links inside code are no citations. When the tools
 * read more than the run kept a list of, nothing is said: an unknown is no
 * finding. Each note is named once, as the answer spelled it first.
 */
export function unfoundedNoteCitations(answer: string, grounding: AnswerGrounding): string[] {
  if (grounding.readMore) return [];
  const known = new Set<string>();
  for (const path of [...grounding.sent, ...(grounding.read ?? [])]) {
    known.add(linkKey(path));
    known.add(linkKey(path.replace(/^.*\//, "")));
  }
  for (const title of grounding.titles ?? []) known.add(linkKey(title));
  const out: string[] = [];
  const seen = new Set<string>();
  const fence = createFenceTracker();
  for (const line of answer.split("\n")) {
    if (fence.step(line) !== null) continue;
    for (const match of line.replace(INLINE_CODE, "").matchAll(LINK)) {
      if (match[1]) continue;
      const target = match[2]!.split("|")[0]!.split("#")[0]!.trim();
      const key = linkKey(target);
      // `[[#Heading]]` points into the open note's own text: no other note is named.
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!known.has(key) && !known.has(key.replace(/^.*\//, ""))) out.push(target);
    }
  }
  return out;
}
