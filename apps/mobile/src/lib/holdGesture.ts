/**
 * What a hold on a card means once the finger lifts.
 *
 * A board card and a pinboard card answer a hold twice: held and released, the
 * card's menu opens; held and carried, the card moves. Both begin the same way
 * - the hold arms - so the two can only be told apart by what the finger does
 * AFTERWARDS, and that has to be decided in one place. The board decided it by
 * where the finger was let go: "over no column" meant "menu". A card carried to
 * the gap between two columns, to a lane heading or past the edge of the board
 * therefore opened the menu on top of the move that had just been abandoned,
 * and a gesture the system took back (a call, the app switcher) did the same
 * (TestFlight 2026-09-25: "menu and moving collide").
 *
 * The rule, as the design language states it for every gesture: one gesture,
 * one meaning. Moving begins with movement; the menu comes on release WITHOUT
 * movement; a cancelled gesture means nothing at all.
 */

/** How far the finger may drift during a hold and still count as resting. */
export const HOLD_MOVE_SLOP_PX = 8;

export type HoldEnd =
  /** The hold never armed: an ordinary tap or a scroll - not this gesture's business. */
  | "tap"
  /** Held and released in place: the card's menu. */
  | "menu"
  /** Held and carried: a move - the caller drops it where it is, or nowhere. */
  | "move"
  /** The system took the gesture back: neither. */
  | "none";

export function holdGestureEnd(state: { armed: boolean; moved: boolean; cancelled: boolean }): HoldEnd {
  if (!state.armed) return "tap";
  if (state.cancelled) return "none";
  return state.moved ? "move" : "menu";
}

/** True once the finger has left the slop circle around where it went down. */
export function holdMoved(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) > HOLD_MOVE_SLOP_PX;
}
