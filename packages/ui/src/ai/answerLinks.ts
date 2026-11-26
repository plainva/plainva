import { buildLinkTargetIndex, linkTargetMayNameNote, resolveMarkdownTargetIndexed, resolveNotePathIndexed } from "@plainva/core";
import { type AnswerGrounding, type VaultLinkFile } from "@plainva/core/ai";
import { parseInlineMarkdown, type InlineNode } from "../lib/inlineMarkdown";
import { planLinkOpen, type LinkOpenOutcome, type LinkToOpen } from "../lib/linkOpen";
import { parseAnswer, type AnswerBlock } from "./answerBlocks";

/**
 * Whether the view can show a link to a note in this answer at all — a wiki
 * link's two brackets, a Markdown link's bracket before its destination
 * (`parseInlineMarkdown` reads no other): the one look an answer without any
 * costs (review O7, third and fifth round). False is certain; true only means
 * "read it". Every link `answerLinksShown` finds passes it.
 */
export function answerMayLink(answer: string): boolean {
  return answer.includes("[[") || answer.includes("](");
}

/**
 * The links of an AI answer that lead into the vault, as the answer's view
 * shows them (review O7, fifth round): read by the parser the view renders
 * with (`parseAnswer`, `parseInlineMarkdown`, as `AiAnswer` draws them), so a
 * link is checked exactly where the reader sees one, and nowhere else. A wiki
 * link and a Markdown link that is no web address are what a click hands to
 * the note opener; a web address, a bare URL and code are none of them.
 *
 * Each link is in the form the click hands on (`LinkToOpen`): where it leads
 * is `planLinkOpen`'s to say, for the click and for the check alike.
 */
export function answerLinksShown(answer: string): LinkToOpen[] {
  const out: LinkToOpen[] = [];
  const inline = (nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "wikiLink") out.push({ text: node.target, kind: "wiki", ...(node.anchor ? { anchor: node.anchor } : {}) });
      else if (node.kind === "link") {
        if (!node.external) out.push({ text: node.written, kind: "markdown" });
      } else if ("children" in node) inline(node.children);
    }
  };
  // Line by line, as `AiAnswer` draws a paragraph and a list item.
  const text = (value: string): void => {
    for (const line of value.split("\n")) inline(parseInlineMarkdown(line));
  };
  const block = (b: AnswerBlock): void => {
    switch (b.kind) {
      case "paragraph":
        text(b.text);
        return;
      case "heading":
        inline(parseInlineMarkdown(b.text));
        return;
      case "list":
        for (const item of b.items) text(item.text);
        return;
      case "quote":
        b.blocks.forEach(block);
        return;
      case "table":
        for (const cell of [...b.header, ...b.rows.flat()]) inline(parseInlineMarkdown(cell));
        return;
      case "code":
      case "rule":
        return;
    }
  };
  parseAnswer(answer).forEach(block);
  return out;
}

/** Where a link of an answer leads, by the files the check was given. */
export interface AnswerLinkLookup {
  resolveWiki(target: string, sourcePath?: string): Promise<string | null>;
  resolveMarkdown: Parameters<typeof planLinkOpen>[1]["resolveMarkdown"];
}

/**
 * What a click on this link of the answer does — the one function of every
 * link click (`planLinkOpen`), with nothing asked of the disk: the check
 * knows what the index knows.
 */
export function answerLinkOutcome(link: LinkToOpen, lookup: AnswerLinkLookup): Promise<LinkOpenOutcome> {
  return planLinkOpen(link, { ...lookup, fileExists: async () => false, folderExists: async () => false });
}

/**
 * The targets a click on these links asks the vault about — as `planLinkOpen`
 * itself reads them, taken from the questions it asks. The files that can
 * answer them are all the check needs (`linkFilesNamed`).
 */
export async function answerLinkTargets(links: readonly LinkToOpen[]): Promise<string[]> {
  const asked = new Set<string>();
  const ask = async (target: string) => {
    if (target.trim()) asked.add(target);
    return null;
  };
  for (const [at, link] of links.entries()) {
    if (at > 0 && at % LINKS_PER_SLICE === 0) await breath();
    await answerLinkOutcome(link, { resolveWiki: ask, resolveMarkdown: ask });
  }
  return [...asked];
}

/**
 * How many links one slice of the check leads before it lets the screen draw: a chain of resolved promises runs as
 * one block, so a long answer is gone through in parts.
 */
const LINKS_PER_SLICE = 50;
const breath = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * What a link leads to, for the check (plan Oberfläche O7, E2; review O7,
 * fourth and fifth round): a note — its path —, or nothing it could rest on.
 * A note the click would create is a note that is not there; that a target
 * meant a note at all is asked by its form only then (`linkTargetMayNameNote`:
 * no scheme, drive, `www.`, folder or extension of another kind). A folder, a
 * heading, an address and a place that is no note name no source.
 */
export type AnswerLinkLead = { kind: "file"; path: string; name: string } | { kind: "missing"; name: string } | null;

export function answerLinkLead(outcome: LinkOpenOutcome): AnswerLinkLead {
  if (outcome.action === "open") return { kind: "file", path: outcome.path, name: outcome.path };
  if (outcome.action === "create") return linkTargetMayNameNote(outcome.target) ? { kind: "missing", name: outcome.target } : null;
  return null;
}

/**
 * The notes an answer names as its source although the conversation never
 * had them (plan Oberfläche O7, E2): links the view shows (`answerLinksShown`)
 * that a click would open as a note neither sent with a request nor read by a
 * tool — or would create, a note that is not there. Where each leads is the
 * click's answer (`planLinkOpen`, `resolveNotePathIndexed`,
 * `resolveMarkdownTargetIndexed`) over `grounding.vault` — the files these
 * links can name — or, without it, over what the conversation had. A file
 * that is no note names no source. When the tools read more than the run kept
 * a list of, nothing is said: an unknown is no finding. Each note is named
 * once, as the click asked for it first; past `limit` notes no more are looked for.
 */
export async function unfoundedAmongShown(links: readonly LinkToOpen[], grounding: AnswerGrounding, limit = Infinity): Promise<string[]> {
  if (grounding.readMore || links.length === 0) return [];
  const had = [...grounding.sent, ...(grounding.read ?? [])];
  const hadKeys = new Set(had.map((path) => path.normalize("NFC")));
  // The titled entries go first: the index keeps the first entry per path, and a title must not lose to the bare path.
  const corpus: VaultLinkFile[] = grounding.vault ? [...grounding.vault] : [...(grounding.titled ?? []), ...had.map((path) => ({ path }))];
  const index = buildLinkTargetIndex(corpus);
  const attachments = new Set(corpus.filter((file) => file.mode === "attachment").map((file) => file.path));
  const out: string[] = [];
  const said = new Set<string>();
  for (const [at, link] of links.entries()) {
    if (out.length >= limit) break;
    if (at > 0 && at % LINKS_PER_SLICE === 0) await breath();
    let asked: string | null = null;
    const outcome = await answerLinkOutcome(link, {
      resolveWiki: async (target, from) => {
        asked ??= target;
        return resolveNotePathIndexed(target, from, index);
      },
      resolveMarkdown: async (target, from) => {
        asked ??= target;
        return resolveMarkdownTargetIndexed(target, from, index);
      },
    });
    const lead = answerLinkLead(outcome);
    if (lead === null) continue;
    if (lead.kind === "file" && (attachments.has(lead.path) || hadKeys.has(lead.path.normalize("NFC")))) continue;
    const name = (asked as string | null) ?? lead.name;
    const key = name.normalize("NFC").toLowerCase();
    if (said.has(key)) continue;
    said.add(key);
    out.push(name);
  }
  return out;
}
