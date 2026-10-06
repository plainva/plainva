import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { commentActionController, commentAuthorKey, commentCreatedAt, isLegacyTableQuote, type CommentOperationService, type WorkspaceCommentRecord } from "@plainva/core";
import { aiMentionNames, isAiAuthorId, isAiMentionId } from "../lib/aiMention";
import { runVisibleCommentOperation } from "../lib/commentActionView";
import { mentionedMemberIds, parseCommentMentions } from "../lib/commentMentions";
import { useStableHandler } from "../lib/useStableHandler";
import { toast } from "../services/toastStore";
import type { SuggestionAuthor } from "./aiSelectionActions";
import type { AiSession, AiState, ThreadReplyOutcome, ThreadReplyRequest } from "./aiSession";

/**
 * "@AI" in a comment thread (plan KI-Harness P3-6, §19.1 D): the user
 * addresses the assistant in a remark, and it answers as a reply in the same
 * thread, under its own name. Shared by the desktop column and the phone's
 * sheet; each shell calls `answer` from the one place where a person pressed
 * Send, after their own remark is stored.
 *
 * That place is the whole trigger. A remark that arrives through sync, a
 * journal that is replayed, a reply the assistant wrote itself — none of them
 * passes there, so none of them can start a run: other people's text can ask
 * the assistant for anything, and nothing happens until someone on THIS
 * device sends a remark that addresses it.
 */

/** Does this remark address the assistant, in any of the spellings? */
export function addressesAi(body: string, label: string): boolean {
  for (const id of mentionedMemberIds(body, aiMentionNames(label))) if (isAiMentionId(id)) return true;
  return false;
}

/** The remark without the mention: what the model is asked. */
export function withoutAiMention(body: string, label: string): string {
  return parseCommentMentions(body, aiMentionNames(label))
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.text)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** A long thread goes with its first remark — what it is about — and its latest ones. */
export const THREAD_REMARKS_MAX = 30;
/** One remark's share of the request; the store allows far longer ones. */
export const THREAD_REMARK_MAX_CHARS = 4_000;

function clip(text: string): string {
  if (text.length <= THREAD_REMARK_MAX_CHARS) return text;
  let end = THREAD_REMARK_MAX_CHARS;
  // Never half a character: a cut inside a surrogate pair moves one back.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** The remark the user just sent. */
export interface PostedRemark {
  commentId: string;
  /** The thread it answers in; null when it starts one. */
  parentCommentId: string | null;
  body: string;
  /** The passage a new thread was attached to. */
  quote: string | null;
}

/**
 * What the assistant is told of a thread: the passage it hangs on, every
 * remark before the question under its author's stated name, and the question
 * itself. The names are for the model, so the user's own remarks do not read
 * "You" — that word would mean the model.
 */
export function threadReplyRequest(input: {
  path: string;
  /** The note's remarks as the surface holds them, with or without the one just sent. */
  comments: readonly WorkspaceCommentRecord[];
  posted: PostedRemark;
  /** id -> stated name, as the cards read them. */
  names: ReadonlyMap<string, string>;
  /** Who this device is in the remarks. */
  selfId: string | null;
  /** The assistant's word in the app's language. */
  label: string;
}): ThreadReplyRequest {
  const { posted, names, selfId } = input;
  const rootId = posted.parentCommentId ?? posted.commentId;
  const root = posted.parentCommentId ? (input.comments.find((comment) => comment.commentId === rootId) ?? null) : null;
  const replies = input.comments
    .filter((comment) => comment.commentId !== posted.commentId && comment.parentCommentId === rootId)
    .sort((a, b) => commentCreatedAt(a).localeCompare(commentCreatedAt(b)));
  const all = root ? [root, ...replies] : replies;
  const kept = all.length > THREAD_REMARKS_MAX ? [all[0]!, ...all.slice(all.length - (THREAD_REMARKS_MAX - 1))] : all;
  const who = (record: WorkspaceCommentRecord): string => {
    const key = commentAuthorKey(record);
    const name = record.legacyOrigin?.authorName || names.get(key) || "";
    if (isAiAuthorId(key)) return name || "Assistant";
    if (!record.legacyOrigin && selfId && record.authorMemberId === selfId) return name ? `${name} (the user)` : "The user";
    return name || "Another person";
  };
  const thread = kept.map((record) => ({
    author: who(record),
    at: commentCreatedAt(record),
    body: clip(record.suggestion ? `${record.body}\n(Proposes to replace the passage with: ${record.suggestion.replacement})`.trim() : record.body),
  }));
  const anchored = root?.anchor && !isLegacyTableQuote(root.anchor) ? root.anchor.quote : null;
  const quote = (posted.parentCommentId ? anchored : posted.quote)?.trim() || null;
  return { path: input.path, rootCommentId: rootId, quote, thread, question: withoutAiMention(posted.body, input.label) };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Writes the assistant's reply through the shell's comment service, like any
 * remark: journaled, synced, deletable. The service takes one operation at a
 * time, and the user may be sending their next remark this very moment — then
 * the reply waits a little and tries again rather than being lost.
 */
export async function postThreadReply(
  service: CommentOperationService,
  reply: { path: string; parentCommentId: string; body: string; author: SuggestionAuthor },
): Promise<void> {
  const input = {
    notePath: reply.path,
    kind: "post" as const,
    markers: [{ path: reply.path, body: reply.body, parentCommentId: reply.parentCommentId, author: reply.author }],
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await commentActionController(service).execute(input, (operation) => runVisibleCommentOperation(service, operation));
      return;
    } catch (error) {
      const busy = error instanceof Error && error.message === "comment-operation-running";
      if (!busy || attempt >= 9) throw error;
      await wait(300);
    }
  }
}

// --- which thread the assistant is answering right now -----------------------------

export interface ThreadReplyTarget {
  path: string;
  rootCommentId: string;
}

let current: ThreadReplyTarget | null = null;
const listeners = new Set<() => void>();

function setTarget(next: ThreadReplyTarget | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The thread of this note the assistant is writing in, by its first remark's id; null when there is none. */
export function useThreadReplyTarget(path: string | null): string | null {
  const target = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return target && path !== null && target.path === path ? target.rootCommentId : null;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Runs the reply and says what came of it — nothing when it worked (the reply
 * is there to read), the reason when it did not. A run the user stopped or
 * whose send overview they declined is their own decision and needs no toast.
 */
export async function runThreadReply(
  session: Pick<AiSession, "replyInThread">,
  t: Translate,
  request: ThreadReplyRequest,
): Promise<ThreadReplyOutcome> {
  setTarget({ path: request.path, rootCommentId: request.rootCommentId });
  let outcome: ThreadReplyOutcome;
  try {
    outcome = await session.replyInThread(request);
  } finally {
    if (current?.path === request.path && current.rootCommentId === request.rootCommentId) setTarget(null);
  }
  if (outcome.kind === "refused" && outcome.reason !== "cancelled") toast.error(t(`ai.thread.refused.${outcome.reason}`));
  return outcome;
}

// --- the assistant as a comment surface sees it -----------------------------------------

/** What the column and the sheet need of the assistant; they get none where it cannot answer. */
export interface CommentThreadAi {
  /** Its word in the app's language: what "@" completes and what the waiting row is headed with. */
  label: string;
  /** The thread of this note it is writing in, by the first remark's id. */
  replyingTo: string | null;
  stop(): void;
}

const NO_STATE = (): AiState | null => null;
const NO_SUBSCRIPTION = () => () => {};

/**
 * The assistant for one note's comments, the same in both shells.
 *
 * `ai` is what the surface shows — absent while the AI is off on this device,
 * no vault is attached, or the remarks are sealed (an encrypted workspace's
 * comments cannot carry the assistant as an author yet, E32). `answer` is
 * called after the user's own remark is stored and starts the reply when that
 * remark addresses the assistant; it says why when the reply cannot be given.
 */
export function useCommentThreadAi(
  session: AiSession | null,
  path: string | null,
  options: { sealed: boolean },
): {
  ai: CommentThreadAi | null;
  answer(posted: PostedRemark, context: { comments: readonly WorkspaceCommentRecord[]; names: ReadonlyMap<string, string>; selfId: string | null }): void;
} {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session ? session.subscribe : NO_SUBSCRIPTION, session ? session.getState : NO_STATE, session ? session.getState : NO_STATE);
  // The AI is on for this device and reads this vault; without either, a mention is text like any other.
  const available = Boolean(session && state?.loaded && state.settings.enabled && state.hasVault) && path !== null;
  const offered = available && !options.sealed;
  const label = t("ai.title");
  const replyingTo = useThreadReplyTarget(path);
  const ai = useMemo<CommentThreadAi | null>(() => (offered ? { label, replyingTo, stop: () => session?.stop() } : null), [offered, label, replyingTo, session]);
  const answer = useStableHandler((posted: PostedRemark, context: { comments: readonly WorkspaceCommentRecord[]; names: ReadonlyMap<string, string>; selfId: string | null }) => {
    // Where the remarks are sealed the assistant is not offered, yet someone may type its name: the run then says why not.
    if (!session || !available || path === null || !addressesAi(posted.body, label)) return;
    void runThreadReply(session, t, threadReplyRequest({ path, posted, label, ...context }));
  });
  return { ai, answer };
}
