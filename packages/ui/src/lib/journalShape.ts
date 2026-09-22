/**
 * Which shape the journal is read in (plan Journal-Erweiterungen, X5/E4).
 *
 * A DEVICE choice, not a vault one: the stream reads a day downwards and suits
 * a phone, the wall lets a week be scanned and suits a wide window. The same
 * person wants different answers on different screens, so this never travels
 * with the settings profile.
 *
 * Both shells read and write it here, so the key cannot drift apart — and
 * `localStorage` can be absent or throw (a private window, blocked site data),
 * which is why every access is guarded and the stream is the answer when it
 * fails.
 */

export type JournalShape = "stream" | "cards";

const KEY = "plainva-journal-shape";

export function readJournalShape(): JournalShape {
  try {
    return localStorage.getItem(KEY) === "cards" ? "cards" : "stream";
  } catch {
    return "stream";
  }
}

export function writeJournalShape(shape: JournalShape): void {
  try {
    localStorage.setItem(KEY, shape);
  } catch {
    /* the choice is a convenience; losing it is not worth an error */
  }
}
