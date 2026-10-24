import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One composer per window, and what a compose request does to it (finding
 * 2026-10-09).
 *
 * A window hosts a single composer: the central and the full window beside
 * their shell (`MailComposeHost`), an auxiliary window through `useAuxBridge`.
 * "Reply", "Forward", "New message" and "Send note by mail" all ask that host
 * for it. Asking again while it was open did nothing at all — the host stored
 * the new draft, and the composer, which reads what it is given once, when it
 * opens, went on showing the old one. No result, and no word why.
 *
 * A request now always has a visible result:
 *
 *  - no composer open: it opens with the draft;
 *  - a composer nobody wrote in: the new draft takes its place. Nothing would
 *    be lost, so nothing is asked;
 *  - a composer with a changed draft: its own leave question comes first.
 *    "Discard" opens the new draft, "Cancel" leaves the old one standing with
 *    everything typed;
 *  - a composer whose message is being sent or filed this moment: the request
 *    waits for that to land. Once the message is out or in its drafts folder
 *    the composer has closed and the new draft opens; if it failed, the
 *    composer stays, with its error and everything in it.
 *
 * What stands in the composer, and whether it is on its way, is the composer's
 * knowledge, so the composer says so here — the way it tells the window around
 * it (`windowCloseGuard`): it holds a question for as long as the host must
 * not replace it unasked. One slot, because a window has one composer.
 *
 * The phone reaches the same result by another road. Its composer is a pushed
 * screen that covers the list, the reader and the note, so the way to a second
 * request leads out of the composer, and leaving asks the same question
 * (`useLeaveGuard`) — also where something stands beside the composer and
 * could be tapped instead, the rail and the navigator of a tablet: what they
 * put over it asks first (`leaveThen`).
 */

/** Asks whether the composer's draft may go. Resolves true once it may. */
export type DraftQuestion = () => Promise<boolean>;

/** The question of this window's composer, while it must not be replaced unasked. */
let held: DraftQuestion | null = null;

/**
 * Declares that this window's composer must be asked before another draft
 * takes its place, for as long as the returned function has not been called.
 *
 * The release lets go of its own question only: in whatever order two
 * declarations come and go, one never switches off the other.
 */
export function holdComposeDraft(question: DraftQuestion): () => void {
  held = question;
  return () => {
    if (held === question) held = null;
  };
}

/** The draft that was held is decided — sent, filed, discarded or replaced. */
function letGo(): void {
  held = null;
}

/**
 * The host's side: the draft the open composer was given, a compose request,
 * the React key to render that composer under, and its way out.
 *
 * Stands where a `useState` for the draft stood, which is why it returns a
 * tuple. The second entry is not a setter, though: it is the request described
 * at the head of this file, and it may ask before anything changes.
 *
 * `key`: a new draft is a new composer. Rendered under it, nothing of the
 * message that was replaced — its sender, an opened Cc row, a recipient typed
 * halfway — reaches the next one.
 *
 * `close` belongs to the composer that is shown when it is handed out. A
 * composer that is no longer the one on screen may still call the one it was
 * given — its question was answered after another request had already taken
 * its place — and closes nothing then, least of all its successor.
 *
 * A host that is gone does nothing at all. The slot above belongs to the
 * window, not to one host: the host is built again when the window shows
 * another vault, and a request or a close that comes back to the old one after
 * an `await` must not answer for the composer of the new one.
 */
export function useComposeHost<Seed>(): readonly [
  draft: Seed | null,
  compose: (seed: Seed) => void,
  key: number,
  close: () => void,
] {
  const [shown, setShown] = useState<{ seed: Seed; key: number } | null>(null);
  /** The key of the composer shown now; 0 while there is none. Keys are never reused. */
  const current = useRef(0);
  const issued = useRef(0);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const compose = useCallback((seed: Seed) => {
    if (!alive.current) return;
    const show = () => {
      if (!alive.current) return;
      letGo();
      issued.current += 1;
      current.current = issued.current;
      setShown({ seed, key: issued.current });
    };
    const question = held;
    if (!question) {
      show();
      return;
    }
    void question().then((mayGo) => {
      if (mayGo) show();
    });
  }, []);

  const key = shown?.key ?? 0;
  const close = useCallback(() => {
    if (!alive.current || current.current !== key) return;
    letGo();
    current.current = 0;
    setShown(null);
  }, [key]);

  return [shown?.seed ?? null, compose, key, close] as const;
}

/** Test seam — the app never resets this. */
export function resetComposeHostForTest(): void {
  held = null;
}
