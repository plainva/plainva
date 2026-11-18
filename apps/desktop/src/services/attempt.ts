/**
 * One action of a person, across its tries (A15).
 *
 * A request that would write twice when run twice — a journal line, a sent
 * mail — can fail in another window with "it may still land": the central
 * window took it and fell silent. The person then presses the button again.
 * That press is the same action as long as what it sends is unchanged, and it
 * carries the same attempt, so the central window runs it once
 * (`RPC_ONCE_KINDS` in `windowBus.ts`).
 *
 * `what` is what the action sends, as the surface sees it — compared, never
 * hashed or sent. Once a try succeeded, or what is sent changed, the next
 * press is a new action with a new attempt.
 */
export interface Attempt {
  /** The attempt for sending `what` now: the earlier one while `what` is unchanged and nothing succeeded. */
  for(what: string): string;
  /** A try succeeded: the next press is a new action. */
  succeeded(): void;
}

let counter = 0;

export function createAttempt(): Attempt {
  let held: { what: string; id: string } | null = null;
  return {
    for(what) {
      if (held?.what !== what) {
        counter += 1;
        held = { what, id: `attempt-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}` };
      }
      return held.id;
    },
    succeeded() {
      held = null;
    },
  };
}
