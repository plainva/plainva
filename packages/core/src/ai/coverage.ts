import { markdownLinkTarget } from "../linkEncoding.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { createFenceTracker } from "../markdownFence.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed, resolveMarkdownLinkIndexed, type LinkCorpusFile } from "../vault/LinkResolver.js";
import { wikiLinkInner, wikiLinkParts } from "../wikiLink.js";

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
   * Every file of the vault: a link is read against all of it, where it leads
   * in the editor. Without it only what the conversation had is asked — a
   * link that names another note of the same name is then taken for the one
   * it had.
   */
  vault?: readonly VaultLinkFile[];
}

/** A link of an answer that may name a note: how it is written, and its target as the app reads it. */
export interface AnswerNoteLink {
  type: "wikilink" | "markdown-link";
  target: string;
}

/** A Markdown destination with a scheme (`https:`, `mailto:`, `plainva:`) leads out of the vault — the graph's and the link look's rule. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Inline HTML elements whose content is code, not links. */
const CODE_OPEN = /^<(?:code|pre|kbd|samp)(?:\s[^>]*)?>$/i;
const CODE_CLOSE = /^<\/(?:code|pre|kbd|samp)\s*>$/i;
const HREF = /\shref\s*=\s*/gi;

/** The `href` values of the `<a>` elements in a piece of HTML, as written. */
function hrefsIn(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(HREF)) {
    const at = match.index + match[0].length;
    const quote = html[at];
    if (quote === '"' || quote === "'") {
      const end = html.indexOf(quote, at + 1);
      if (end > at) out.push(html.slice(at + 1, end));
    } else {
      let end = at;
      while (end < html.length && !/[\s>]/.test(html[end]!)) end++;
      if (end > at) out.push(html.slice(at, end));
    }
  }
  return out;
}

/**
 * The links of an answer that may name a note, in the order of the text, as
 * the app's parser reads them (`parseMarkdownAst`): wiki links — embeds are
 * shown, not cited —, inline Markdown links, links by reference to their
 * definition (`[P][ref]`), and the `<a href>` of inline HTML. Code is none of
 * them: fences, code spans of any length, and an HTML `<code>` element.
 * Targets are read as the index reads them (`wikiLinkParts`,
 * `markdownLinkTarget`); a Markdown destination with a scheme is left out.
 */
export function answerNoteLinks(answer: string): AnswerNoteLink[] {
  const tree = parseMarkdownAst(answer) as unknown as AstNode;
  const definitions = new Map<string, string>();
  const gather = (node: AstNode): void => {
    if (node.type === "definition" && typeof node.identifier === "string" && typeof node.url === "string" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    for (const child of node.children ?? []) gather(child);
  };
  gather(tree);
  const out: AnswerNoteLink[] = [];
  const markdown = (url: string) => {
    const { target } = markdownLinkTarget(url);
    if (!SCHEME.test(target)) out.push({ type: "markdown-link", target });
  };
  const walk = (node: AstNode, inCode: boolean): void => {
    if (!inCode) {
      if (node.type === "wikiLink" && typeof node.value === "string" && node.embed !== true) out.push({ type: "wikilink", target: wikiLinkParts(wikiLinkInner({ value: node.value, embed: false })).target });
      else if (node.type === "link" && typeof node.url === "string") markdown(node.url);
      else if (node.type === "linkReference" && typeof node.identifier === "string") {
        const url = definitions.get(node.identifier);
        if (url !== undefined) markdown(url);
      } else if (node.type === "html" && typeof node.value === "string") for (const href of hrefsIn(node.value)) markdown(href);
    }
    // Between an HTML `<code>` and its end, among the children of one parent, nothing is a link.
    let depth = 0;
    for (const child of node.children ?? []) {
      if (child.type === "html" && typeof child.value === "string") {
        const tag = child.value.trim();
        if (CODE_OPEN.test(tag)) {
          depth++;
          continue;
        }
        if (CODE_CLOSE.test(tag)) {
          depth = Math.max(0, depth - 1);
          continue;
        }
      }
      walk(child, inCode || depth > 0);
    }
  };
  walk(tree, false);
  return out;
}

interface AstNode {
  type: string;
  value?: unknown;
  url?: unknown;
  identifier?: unknown;
  embed?: unknown;
  children?: AstNode[];
}

/**
 * The notes an answer names as its source although the conversation never had
 * them (plan Oberfläche O7, E2): a link to a note that neither went with a
 * request of this conversation nor was read by a tool. That is the one claim
 * about notes the app can check without a second model — the answer says
 * "this note says so", and the app knows the model never saw that note. It is
 * what earns a warning under an answer; an answer that cites less than it
 * could gets the calm line, and its coverage stays in the details.
 *
 * `grounding` is what the whole conversation had, not one run: the context of
 * earlier turns goes on as text, and an unchanged note is not sent again. A
 * link leads where it leads in the editor (ADR 0027): a wiki link by the wiki
 * rule, a Markdown link from the linking note's folder first, both against
 * the whole vault where it is given — `[[Plan]]` that opens `Plan.md` is not
 * the sent `Projects/Plan.md`. A link that leads to a file that is no note
 * names no source; one that leads to no file names a note the conversation
 * never had. When the tools read more than the run kept a list of, nothing is
 * said: an unknown is no finding. Each note is named once, as the answer
 * spelled it first.
 */
export function unfoundedNoteCitations(answer: string, grounding: AnswerGrounding): string[] {
  if (grounding.readMore) return [];
  const had = [...grounding.sent, ...(grounding.read ?? [])];
  const hadKeys = new Set(had.map((path) => path.normalize("NFC")));
  // The titled entries go first: the index keeps the first entry per path, and a title must not lose to the bare path.
  const corpus: VaultLinkFile[] = grounding.vault ? [...grounding.vault] : [...(grounding.titled ?? []), ...had.map((path) => ({ path }))];
  const index = buildLinkTargetIndex(corpus);
  const attachments = new Set(corpus.filter((file) => file.mode === "attachment").map((file) => file.path));
  const from = grounding.from ?? "";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of answerNoteLinks(answer)) {
    const target = link.target.trim();
    // `[[#Heading]]` points into the open note's own text: no other note is named.
    if (!target) continue;
    const key = `${link.type}\u0000${target.normalize("NFC").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let leads: string | null;
    if (link.type === "markdown-link") {
      const answerOf = resolveMarkdownLinkIndexed(from, target, index);
      if (answerOf !== null && answerOf.kind === "folder" && answerOf.index === null) continue;
      leads = answerOf === null ? null : answerOf.kind === "file" ? answerOf.path : answerOf.index;
    } else leads = resolveLinkTargetIndexed(from, target, index);
    if (leads !== null && attachments.has(leads)) continue;
    if (leads !== null && hadKeys.has(leads.normalize("NFC"))) continue;
    if (!out.some((name) => name.normalize("NFC").toLowerCase() === target.normalize("NFC").toLowerCase())) out.push(target);
  }
  return out;
}
