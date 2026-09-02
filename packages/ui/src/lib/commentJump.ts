/**
 * Jumping to one comment in one note (Stufe F, §6).
 *
 * Opening a note is not the same as landing on the remark somebody pointed at.
 * Three surfaces want the second thing and none of them could do it: the
 * vault-wide overview (D9) only ever opened the path, a notification (F2) had
 * nowhere to send the click, and the phone's sheet (F3) has the same need. So
 * this is one shared contract rather than three near-copies.
 *
 * It is deliberately a REQUEST, not a call: the surface that can open a note
 * and the surface that can highlight a card are different components, and on a
 * cold start neither exists yet at the moment the request is made. The shell
 * opens the note; the editor picks the request up when it has the note in hand
 * and clears it. A request for a note the user then navigates away from expires
 * on its own rather than fighting the navigation.
 */

export interface CommentJumpRequest {
  path: string;
  commentId: string;
}

/** The event both shells agree on. Named once so nobody spells it twice. */
export const COMMENT_JUMP_EVENT = "plainva-open-comment";

/**
 * The pending request, or null.
 *
 * Parked in a module rather than passed through props for the cold-start case:
 * a tapped notification can start the process, and the editor that should react
 * is mounted a second later. Parking survives that gap; a call would be made
 * into a component tree that does not exist yet.
 */
let pending: CommentJumpRequest | null = null;

/** Asks for a jump. The shell opens the note, the editor does the rest. */
export function requestCommentJump(request: CommentJumpRequest): void {
  pending = request;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COMMENT_JUMP_EVENT, { detail: request }));
  }
}

/**
 * Takes the request if it is for this note, and clears it.
 *
 * Taking rather than reading, because a request must fire once: leaving it in
 * place would re-select the card every time the note re-renders, and a card
 * that keeps re-selecting itself cannot be deselected by clicking it.
 */
export function takeCommentJump(path: string | null): CommentJumpRequest | null {
  if (!pending || !path || pending.path !== path) return null;
  const request = pending;
  pending = null;
  return request;
}

/** Drops a pending request. For a shell tearing down its vault. */
export function clearCommentJump(): void {
  pending = null;
}
