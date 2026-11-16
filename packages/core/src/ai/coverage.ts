import { createFenceTracker } from "../markdownFence.js";
import { readNoteLinks } from "../linkRewrite.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed, type LinkCorpusFile } from "../vault/LinkResolver.js";

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
}

/** A target with a scheme (`https:`, `mailto:`, `plainva:`) leads out of the vault, not to a note. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A file that is no note: `plan.pdf`, `Tasks.base`. A name without an extension, or `.md`, is a note. */
const NOT_A_NOTE = /\.(?!md$)[a-z][a-z0-9]{0,4}$/i;

/**
 * The notes an answer names as its source although the conversation never had
 * them (plan Oberfläche O7, E2): a wiki link or a Markdown link to a note
 * that neither went with a request of this conversation nor was read by a
 * tool. That is the one claim about notes the app can check without a second
 * model — the answer says "this note says so", and the app knows the model
 * never saw that note. It is what earns a warning under an answer; an answer
 * that cites less than it could gets the calm line, and its coverage stays in
 * the details.
 *
 * `grounding` is what the whole conversation had, not one run: the context of
 * earlier turns goes on as text, and an unchanged note is not sent again.
 * The links are the parser's (`readNoteLinks`) — code spans of any length,
 * fences, `\|` in a table cell and embeds read as everywhere else — and a
 * link leads where the one rule of the app says it does
 * (`resolveLinkTarget`, ADR 0027): `[[Archive/Plan]]` is not the sent
 * `Projects/Plan.md`. When the tools read more than the run kept a list of,
 * nothing is said: an unknown is no finding. Each note is named once, as the
 * answer spelled it first.
 */
export function unfoundedNoteCitations(answer: string, grounding: AnswerGrounding): string[] {
  if (grounding.readMore) return [];
  // The titled entries go first: the index keeps the first entry per path, and a title must not lose to the bare path.
  const corpus: LinkCorpusFile[] = [...(grounding.titled ?? []), ...[...grounding.sent, ...(grounding.read ?? [])].map((path) => ({ path }))];
  const index = buildLinkTargetIndex(corpus);
  const from = grounding.from ?? "";
  const { links, unplaced } = readNoteLinks(answer);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of [...links, ...unplaced]) {
    if (link.type === "embed") continue;
    const target = link.target.trim();
    // `[[#Heading]]` points into the open note's own text: no other note is named.
    if (!target || SCHEME.test(target) || NOT_A_NOTE.test(target)) continue;
    const key = target.replace(/\.md$/i, "").normalize("NFC").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (resolveLinkTargetIndexed(from, target, index) === null) out.push(target);
  }
  return out;
}
