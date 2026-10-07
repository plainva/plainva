import { presentableDiff } from "@codemirror/merge";
import {
  buildCommentAnchor,
  commentActionController,
  createWorkspaceObjectId,
  MAX_ANCHOR_QUOTE_BYTES,
  mintAnchorMarkerId,
  type CommentOperationService,
} from "@plainva/core";
import type { SuggestionChunk } from "../components/suggestMode";
import { runVisibleCommentOperation } from "../lib/commentActionView";
import { toast } from "../services/toastStore";
import type { AiSession, SelectionOutcome, SelectionRequest } from "./aiSession";

/**
 * The AI at a selection (plan KI-Harness P1.5, mockup v5 §5): what it can do
 * with a passage. The suggest actions come back as a suggestion round in the
 * note — accepted or rejected like a person's, authored "Plainva AI · model"
 * (E33) — the ask actions open the conversation with the passage along. One
 * catalog for the desktop's selection menu and the phone's AI sheet.
 */

export type AiSuggestAction = "rewrite" | "shorten" | "translate" | "tasks";
export type AiAskAction = "explain" | "ask";

export const AI_SUGGEST_ACTIONS: readonly AiSuggestAction[] = ["rewrite", "shorten", "translate", "tasks"];
export const AI_ASK_ACTIONS: readonly AiAskAction[] = ["explain", "ask"];

/** Languages "Translate" offers: the app's ten, by the English name the model reads. */
export const AI_TRANSLATE_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "pt-BR", name: "Brazilian Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "zh-CN", name: "Simplified Chinese" },
];

/** The longest passage an action takes; a longer one is a document, not a selection. */
export const SELECTION_MAX_CHARS = 12_000;

/** What the model is asked, in English — the passage keeps its own language unless it is translated. */
export function selectionInstruction(action: AiSuggestAction, language?: string): string {
  const keep = "Keep its facts, names, numbers, dates, links and Markdown";
  switch (action) {
    case "rewrite":
      return `Rewrite the passage so that it reads clearly and well. Keep its meaning. ${keep}, and its language.`;
    case "shorten":
      return `Shorten the passage to what matters, about half its length. ${keep}, and its language.`;
    case "translate":
      return `Translate the passage into ${language ?? "English"}. Keep names, numbers, dates, links, code and Markdown as they are.`;
    case "tasks":
      return "Turn the passage into concrete tasks, one Markdown task line each (\"- [ ] …\"), in the passage's language. Only tasks the passage states or clearly implies.";
  }
}

export const PASSAGE_ONLY = "Answer with the new text only: no introduction, no quotation marks around it, no explanation.";

/** What an ask action says in the conversation, in English (the answer follows the app's language). */
export function askMessage(action: AiAskAction): string | null {
  return action === "explain" ? "Explain the selected passage." : null;
}

/** The passage in a model's answer: a code fence or one pair of quotation marks around it removed. */
export function passageOf(answer: string): string {
  let text = answer.trim();
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    if (lines.length >= 2 && lines[lines.length - 1]!.trim() === "```") text = lines.slice(1, -1).join("\n").trim();
  }
  const pairs: [string, string][] = [
    ['"', '"'],
    ["“", "”"],
    ["„", "“"],
    ["«", "»"],
    ["「", "」"],
  ];
  for (const [open, close] of pairs) {
    const inner = text.slice(open.length, text.length - close.length);
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close) && !inner.includes(close)) {
      text = inner.trim();
      break;
    }
  }
  return text;
}

/** Where the passage stands in the note now: where it was, or its one occurrence; null when it changed or repeats. */
export function relocate(doc: string, from: number, to: number, text: string): { from: number; to: number } | null {
  if (doc.slice(from, to) === text) return { from, to };
  const at = doc.indexOf(text);
  if (at < 0 || doc.indexOf(text, at + 1) >= 0) return null;
  return { from: at, to: at + text.length };
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

/**
 * A new passage as the chunks of a suggestion round, against the whole note:
 * clause-sized changes (the suggestion mode's own diff), none quoting more
 * than an anchor holds. `insert` puts the text after the passage as a
 * paragraph of its own (the tasks from a passage) instead of in its place.
 */
export function selectionChunks(doc: string, from: number, to: number, text: string, mode: "replace" | "insert"): SuggestionChunk[] {
  if (mode === "insert") return text.trim() ? [{ fromA: to, toA: to, replacement: `\n\n${text.trim()}\n` }] : [];
  const proposed = doc.slice(0, from) + text + doc.slice(to);
  const out: SuggestionChunk[] = [];
  for (const change of presentableDiff(doc, proposed)) {
    out.push(...withinAnchorLimit(doc, change.fromA, change.toA, proposed.slice(change.fromB, change.toB)));
  }
  return out;
}

/**
 * A change whose original text is longer than an anchor may quote, cut at
 * whitespace into consecutive pieces: the first carries the new text, the
 * others remove theirs. Accepting all of them gives the rewrite.
 */
function withinAnchorLimit(doc: string, fromA: number, toA: number, replacement: string): SuggestionChunk[] {
  if (byteLength(doc.slice(fromA, toA)) <= MAX_ANCHOR_QUOTE_BYTES) return [{ fromA, toA, replacement }];
  const pieces: SuggestionChunk[] = [];
  let start = fromA;
  while (start < toA) {
    let end = start;
    let bytes = 0;
    let lastBreak = -1;
    while (end < toA) {
      const size = byteLength(doc[end]!);
      if (bytes + size > MAX_ANCHOR_QUOTE_BYTES) break;
      bytes += size;
      end += 1;
      if (/\s/.test(doc[end - 1]!)) lastBreak = end;
    }
    if (end < toA && lastBreak > start) end = lastBreak;
    // Never split a surrogate pair: an anchor quotes whole characters.
    if (end < toA && end > start && /[\uD800-\uDBFF]/.test(doc[end - 1]!)) end -= 1;
    if (end === start) end = Math.min(toA, start + 1);
    pieces.push({ fromA: start, toA: end, replacement: pieces.length === 0 ? replacement : "" });
    start = end;
  }
  return pieces;
}

export interface SuggestionAuthor {
  id: string;
  displayName: string;
}

/**
 * Writes a suggestion round through the shell's comment service: nothing enters the note until someone accepts.
 * A block that proposes the value of a property (plan KI-Harness P5-3) says so at its anchor — it stays the passage
 * it is, the property's entry, so every build accepts it as the text change it is. `batch` continues a round that
 * is there: what one run proposes on one note in several steps is one round in the note's margin.
 */
export async function proposeSuggestionRound(
  service: CommentOperationService,
  round: { path: string; base: string; chunks: readonly (SuggestionChunk & { property?: string })[]; note: string; author: SuggestionAuthor; batch?: { id: string; index: number } },
): Promise<void> {
  const batchId = round.batch?.id ?? createWorkspaceObjectId();
  const first = round.batch?.index ?? 0;
  const markers = round.chunks.map((chunk, index) => ({
    path: round.path,
    body: "",
    parentCommentId: null,
    anchor: buildCommentAnchor(round.base, chunk.fromA, chunk.toA, mintAnchorMarkerId(round.base), chunk.property ? { kind: "property" as const, key: chunk.property } : undefined),
    suggestion: { replacement: chunk.replacement },
    batch: { batchId, index: first + index, note: round.note.trim() || null },
    author: round.author,
  }));
  await commentActionController(service).execute({ notePath: round.path, kind: "post", markers }, (operation) => runVisibleCommentOperation(service, operation));
}

/** What a shell tells the conversation about its editor's selection. */
export interface SelectionReader {
  /** Cheap: is anything selected in the open editor? */
  has(): boolean;
  /** The selection and its place, read once when an action starts. */
  range(): { path: string; from: number; to: number; text: string; doc: string } | null;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** Runs a suggest action and says what came of it: proposed, nothing to change, or why not. */
export async function runSuggestAction(
  session: Pick<AiSession, "proposeForSelection">,
  t: Translate,
  request: SelectionRequest,
): Promise<SelectionOutcome> {
  const outcome = await session.proposeForSelection(request);
  if (outcome.kind === "proposed") toast.success(t("ai.selection.proposed", { count: outcome.changes }));
  else if (outcome.kind === "unchanged") toast.info(t("ai.selection.unchanged"));
  else if (outcome.reason !== "cancelled") toast.error(t(`ai.selection.refused.${outcome.reason}`));
  return outcome;
}
