/**
 * The note as a snapshot for a foreign tool (Stufe D, D10).
 *
 * Comments live beside the note, never inside it - that is what keeps "a note
 * is an ordinary Markdown file" true (plan section 4). An EXPORT is the one
 * place where the opposite is right: the file leaves Plainva, nobody is going
 * to edit it here again, and the reader has no way to see the annotations
 * unless they travel in the text.
 *
 * Two shapes, because they serve genuinely different tools:
 *
 * - `appendix` puts the note through unchanged and lists the annotations at the
 *   end. Works in EVERY renderer - GitHub, Obsidian, a mail client, print.
 * - `critic` writes CriticMarkup (`{==passage==}{>>remark<<}`, `{~~old~>new~~}`)
 *   into the text, for the editors that understand it (iA Writer, Ulysses).
 *   Section 4 rejected the format as STORAGE for two reasons that both stop
 *   mattering here: no standard renderer hides it, and it carries neither
 *   author nor time. An export is read once by one tool, and the author and the
 *   date go into the remark as plain text.
 *
 * Only OPEN threads travel. An export is a handover for review, not an archive;
 * the same rule the vault-wide overview uses (D9).
 *
 * The invisible anchor markers are stripped in every mode, including `plain`.
 * They are Plainva bookkeeping, and the exported file is a copy for somebody
 * else - a note without comments never had one, so nothing changes for anyone
 * who does not use them.
 */
import { resolveCommentAnchor, stripAnchorMarkers, type WorkspaceCommentAnchor, type WorkspaceCommentRecord } from "@plainva/core";
import i18n from "../i18n";
import { buildCommentThreads, isCommentThreadOpen, type CommentThread } from "./commentThreads.js";

export type CommentExportMode = "plain" | "appendix" | "critic";

export interface CommentExportInput {
  /** The saved note, markers and all. */
  raw: string;
  comments: readonly WorkspaceCommentRecord[];
  /** authorMemberId -> display name; a missing name falls back to a placeholder. */
  names: ReadonlyMap<string, string>;
  mode: CommentExportMode;
  /** Injected so a test does not depend on the machine locale. */
  formatDate?: (iso: string) => string;
}

export interface CommentExportResult {
  text: string;
  /** Annotations written into the text (CriticMarkup mode only). */
  placed: number;
  /** Annotations that ended up in the list at the end. */
  listed: number;
}

/** Everything CriticMarkup gives a meaning to. */
const CRITIC_DELIMITERS = ["{==", "==}", "{>>", "<<}", "{~~", "~~}", "{++", "++}", "{--", "--}"];

/**
 * Keeps an authored remark from closing its own marker.
 *
 * The space inside the delimiter is deliberately visible rather than a
 * zero-width character: the reader of the export should be able to see that
 * something was adjusted, and an invisible fix in a file meant for a foreign
 * tool is the kind of thing that comes back as a bug report.
 */
function escapeCriticBody(text: string): string {
  let result = text;
  for (const delimiter of CRITIC_DELIMITERS) {
    result = result.split(delimiter).join(`${delimiter[0]} ${delimiter.slice(1)}`);
  }
  return result;
}

function authorName(memberId: string, names: ReadonlyMap<string, string>): string {
  return names.get(memberId) ?? i18n.t("workspaceSecurity.commentUnknownAuthor");
}

function defaultDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** One line of prose per comment: who, when. */
function byline(comment: WorkspaceCommentRecord, input: CommentExportInput): string {
  const format = input.formatDate ?? defaultDate;
  return `${authorName(comment.authorMemberId, input.names)} · ${format(comment.createdAt)}`;
}

/** A quote that has to survive inside a Markdown heading. */
function headingQuote(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

interface Placement {
  thread: CommentThread;
  from: number;
  to: number;
}

/**
 * Which threads can be written into the text, and which have to be listed.
 *
 * Three reasons a thread lands in the list instead: its passage is gone
 * (`orphan`, or there is no anchor at all - a remark about the whole note), it
 * overlaps one that was already placed (CriticMarkup does not nest), or the
 * passage itself contains CriticMarkup delimiters, where wrapping it would
 * hand the receiving tool a file it reads wrongly.
 */
function planPlacements(raw: string, threads: readonly CommentThread[]): { placements: Placement[]; leftovers: CommentThread[] } {
  const placements: Placement[] = [];
  const leftovers: CommentThread[] = [];
  for (const thread of threads) {
    const anchor = thread.root.anchor as WorkspaceCommentAnchor | null;
    const resolution = anchor ? resolveCommentAnchor(raw, anchor) : { status: "orphan" as const };
    if (resolution.status === "orphan") {
      leftovers.push(thread);
      continue;
    }
    const passage = raw.slice(resolution.from, resolution.to);
    const collides = placements.some((placed) => resolution.from < placed.to && placed.from < resolution.to);
    if (collides || CRITIC_DELIMITERS.some((delimiter) => passage.includes(delimiter))) {
      leftovers.push(thread);
      continue;
    }
    placements.push({ thread, from: resolution.from, to: resolution.to });
  }
  return { placements, leftovers };
}

function criticRemarks(thread: CommentThread, input: CommentExportInput): string {
  const parts: string[] = [];
  if (thread.root.suggestion) {
    parts.push(`{>>${escapeCriticBody(`${i18n.t("editor.exportSuggestion")} — ${byline(thread.root, input)}`)}<<}`);
  }
  for (const comment of [thread.root, ...thread.replies]) {
    if (!comment.body.trim()) continue;
    parts.push(`{>>${escapeCriticBody(`${byline(comment, input)}: ${comment.body.trim()}`)}<<}`);
  }
  return parts.join("");
}

/** The list at the end - one section per thread, readable in any renderer. */
function renderList(threads: readonly CommentThread[], input: CommentExportInput, partial: boolean): string {
  if (threads.length === 0) return "";
  const format = input.formatDate ?? defaultDate;
  const lines: string[] = ["", "---", "", `## ${i18n.t("editor.exportAnnotations")}`, ""];
  // No count in the prose: the sections are right below, and a "1 annotations"
  // line is exactly the kind of small wrongness a reader notices.
  lines.push(
    partial
      ? i18n.t("editor.exportAnnotationsUnplaced")
      : i18n.t("editor.exportAnnotationsIntro", { date: format(new Date().toISOString()) }),
  );
  for (const thread of threads) {
    const anchor = thread.root.anchor as WorkspaceCommentAnchor | null;
    const quote = anchor?.quote ? headingQuote(anchor.quote) : "";
    lines.push("", `### ${quote ? `„${quote}“` : i18n.t("editor.exportWholeNote")}`);
    const suggestion = thread.root.suggestion;
    if (suggestion) {
      // The passage already stands in the heading above - repeating it here
      // would make the reader compare two identical quotes for a difference.
      const replacement = suggestion.replacement.trim();
      lines.push(
        "",
        `*${replacement ? i18n.t("editor.exportSuggestionReplace", { text: headingQuote(replacement) }) : i18n.t("editor.exportSuggestionDelete")}*`,
      );
    }
    for (const comment of [thread.root, ...thread.replies]) {
      if (!comment.body.trim()) continue;
      lines.push("", `**${byline(comment, input)}**`, "", comment.body.trim());
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Does this note carry anything an export could show?
 *
 * The shells ask before they ask the user: a note without open annotations
 * exports exactly as it always did, with no extra question in the way. Same
 * definition of "open" as the renderer, so the dialog can never appear for a
 * file that would then come out unchanged.
 */
export function hasOpenAnnotations(
  comments: readonly WorkspaceCommentRecord[],
  names: ReadonlyMap<string, string>,
): boolean {
  return buildCommentThreads(comments, null, names).some((thread) => isCommentThreadOpen(thread.root));
}

/**
 * Builds the file that leaves Plainva.
 *
 * The threads are built with a null member id on purpose: a mention highlights
 * a thread for the person reading the app, and nothing about who exported the
 * file should change what the file says.
 */
export function renderNoteExport(input: CommentExportInput): CommentExportResult {
  const openThreads = buildCommentThreads(input.comments, null, input.names).filter((thread) =>
    isCommentThreadOpen(thread.root),
  );
  if (input.mode === "plain" || openThreads.length === 0) {
    return { text: stripAnchorMarkers(input.raw).text, placed: 0, listed: 0 };
  }
  if (input.mode === "appendix") {
    return {
      text: stripAnchorMarkers(input.raw).text + renderList(openThreads, input, false),
      placed: 0,
      listed: openThreads.length,
    };
  }
  const { placements, leftovers } = planPlacements(input.raw, openThreads);
  // Back to front, so an earlier offset is still the offset it was measured at.
  let text = input.raw;
  for (const placement of [...placements].sort((a, b) => b.from - a.from)) {
    const passage = text.slice(placement.from, placement.to);
    const suggestion = placement.thread.root.suggestion;
    const marked = suggestion ? `{~~${passage}~>${suggestion.replacement}~~}` : `{==${passage}==}`;
    text = text.slice(0, placement.from) + marked + criticRemarks(placement.thread, input) + text.slice(placement.to);
  }
  return {
    text: stripAnchorMarkers(text).text + renderList(leftovers, input, true),
    placed: placements.length,
    listed: leftovers.length,
  };
}
