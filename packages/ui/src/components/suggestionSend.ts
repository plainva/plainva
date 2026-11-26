import { commentOperationMatchesInput, planCommentRound, type CommentOperation } from "@plainva/core";
import type { EditorSession } from "./editorSession";
import type { SuggestionChunk } from "./suggestMode";

/**
 * Sending a suggestion and ending its round, the same in both shells (review of L5, rounds 2 and 3, 2026-11-25).
 *
 * The chunks of a proposal come from the word diff, which loads with the mode (performance plan L5); asking for them
 * waits. Both decisions that rest on them read the text they were made of, and the round's end looks again after
 * the wait: what the person typed in that moment is no part of the round that ended, and ending the mode would put
 * the base back over it.
 */
type ProposalSession = Pick<EditorSession, "view" | "suggestion">;

export type SuggestionToSend =
  | { kind: "nothing" }
  | { kind: "tooLarge" }
  | { kind: "send"; copy: string; base: string; chunks: SuggestionChunk[] };

/**
 * What a send of this moment would write: the copy as it stands now, its base and the chunks of the word diff
 * between them — waited for, never a coarser stand-in. `nothing` without a change, `tooLarge` when a block's quote
 * is over `maxQuoteBytes`. Rejects when the word diff cannot be loaded after its tries.
 */
export async function suggestionToSend(session: ProposalSession, maxQuoteBytes: number): Promise<SuggestionToSend> {
  const copy = session.view.state.doc.toString();
  const { base, chunks } = await session.suggestion();
  if (base === null || chunks.length === 0) return { kind: "nothing" };
  if (chunks.some((chunk) => new TextEncoder().encode(base.slice(chunk.fromA, chunk.toA)).length > maxQuoteBytes)) return { kind: "tooLarge" };
  return { kind: "send", copy, base, chunks };
}

/**
 * Whether a completed comment operation is the round of this suggestion, so the mode ends: its markers are the
 * chunks of the copy — the copy as it was asked and still is after the wait for the word diff — and the shell's own
 * checks (`current`: the same session, the mode still on, the note still the one saved) hold after the wait.
 */
export async function suggestionRoundEnds(options: {
  session: ProposalSession;
  operation: CommentOperation;
  notePath: string;
  note: () => string;
  current: () => boolean;
}): Promise<boolean> {
  const { session } = options;
  const copy = session.view.state.doc.toString();
  const { base, chunks } = await session.suggestion();
  if (!options.current()) return false;
  // Typed while the diff loaded: the round that ended is the one of the copy before, and this copy is not sent.
  if (session.view.state.doc.toString() !== copy) return false;
  if (base === null || chunks.length === 0) return false;
  return commentOperationMatchesInput(options.operation, planCommentRound(options.notePath, base, chunks, options.note()));
}
