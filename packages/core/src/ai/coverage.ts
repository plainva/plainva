import { createFenceTracker } from "../markdownFence.js";
import { type LinkCorpusFile } from "../vault/LinkResolver.js";

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

/** A file of the vault as the link rule reads it (`VaultQueryService.linkTargets`): `attachment` for everything that is no note. */
export interface VaultLinkFile extends LinkCorpusFile {
  mode?: string | null;
}

/** What a conversation had of the vault: the notes its context carried, and the ones its tools read (`RunMeta`). */
export interface AnswerGrounding {
  /** Paths of the notes the context carried. */
  sent: readonly string[];
  /** Paths of the notes the run's tools read. */
  read?: readonly string[];
  /** The tools read more than `read` lists: then nothing is known about what was not read. */
  readMore?: boolean;
  /** Sent notes with the `title` they go by — a link may name a note by it (ADR 0027). */
  titled?: readonly LinkCorpusFile[];
  /** The note the conversation stands in: where `./Note` and `../Folder/Note` are read from. */
  from?: string;
  /**
   * The files of the vault the answer's links can lead to — all of them, or
   * only those the links can name (`linkFilesNamed`), which answers alike: a
   * link is read against them where a click on it leads. Without them only
   * what the conversation had is asked — a link that names another note of
   * the same name is then taken for the one it had.
   */
  vault?: readonly VaultLinkFile[];
}
