/**
 * How an appointment looks, derived from what it IS.
 *
 * The model carried `status` and `selfResponse` all along, and no calendar view
 * read either of them (report 2026-07-29, F7/F8): a cancelled appointment looked
 * exactly like one that is going ahead, and an invitation you had not answered
 * looked like one you had accepted. Both are the kind of thing you plan a day
 * around, so they need to be visible at a glance.
 *
 * One function, four states, every surface: time grid, month, agenda, day pane —
 * desktop and phone. The CSS families (`pv-evt--*`, `m-evt--*`) carry the actual
 * appearance; this only decides which one applies.
 */

export type EventVisualState = "confirmed" | "tentative" | "cancelled" | "unanswered";

/** The two fields that decide it, so a caller can pass a row of any shape. */
export interface EventStateInput {
  status?: "confirmed" | "tentative" | "cancelled";
  selfResponse?: "accepted" | "declined" | "tentative" | "needsAction";
}

/**
 * Precedence, strongest statement first:
 *
 * 1. `cancelled` — the appointment is off. Nothing else about it matters.
 * 2. `unanswered` — you are invited and have not replied (`needsAction`). It is
 *    not yet an appointment of yours, which is why it gets an outline (E8).
 * 3. `tentative` — either the organiser marked it so, or you replied "maybe".
 *    A "maybe" from you is the same uncertainty as a "maybe" about the event.
 * 4. `confirmed` — the ordinary case, unchanged.
 *
 * A `declined` invitation deliberately stays `confirmed`: the event still exists
 * for everyone else, and Plainva does not hide what you turned down — the
 * decline is visible in the dialog, where the answer belongs.
 */
export function eventVisualState(event: EventStateInput): EventVisualState {
  if (event.status === "cancelled") return "cancelled";
  if (event.selfResponse === "needsAction") return "unanswered";
  if (event.status === "tentative" || event.selfResponse === "tentative") return "tentative";
  return "confirmed";
}

/** Class suffix per shell: `pv-evt--cancelled`, `m-evt--cancelled`, … */
export function eventStateClass(prefix: "pv-evt" | "m-evt", state: EventVisualState): string {
  return state === "confirmed" ? prefix : `${prefix} ${prefix}--${state}`;
}

/** i18n key of the one-word label a state carries where there is room for it. */
export function eventStateLabelKey(state: EventVisualState): string | null {
  if (state === "cancelled") return "pim.stateCancelled";
  if (state === "unanswered") return "pim.stateUnanswered";
  if (state === "tentative") return "pim.stateTentative";
  return null;
}
