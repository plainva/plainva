/**
 * The readable text of a failure, whatever shape it arrived in.
 *
 * WHY THIS EXISTS
 * Errors that cross the Tauri boundary are STRINGS, not Error objects: a Rust
 * command returns `Err(String)` and the plugin layer rejects with that value
 * as-is. `err.message` on a string is `undefined`, and an undefined
 * interpolation renders as nothing — so a message built as
 * "… Reason: {{error}}" reaches the user as "… Reason:" and stops there.
 *
 * That shipped. A reporter's screenshot on issue #46 showed a delete failure
 * whose whole purpose was to name its cause, saying nothing after the colon.
 * The diagnostics line two statements above it used String(err) and was fine,
 * which is the only reason the difference was visible at all.
 *
 * The same expression was already inlined in ~180 places. One function means
 * the next boundary that returns a bare string is handled by default rather
 * than by whoever remembers.
 */

/** Never returns an empty string: a blank reason is worse than an ugly one. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err.trim() || "unknown error";

  if (err instanceof Error) {
    // An Error with an empty message still carries its name — "TypeError" says
    // more than nothing at all.
    return err.message.trim() || err.name || "unknown error";
  }

  // Plain objects with a message: some plugin layers reject with `{message}`
  // without an Error prototype, and structured clone strips prototypes too.
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();

    // A stringified object is useless ("[object Object]") — say so plainly
    // rather than pretending there is a reason on screen.
    const asString = String(err);
    if (asString && asString !== "[object Object]") return asString;
    return "unknown error";
  }

  if (err === null || err === undefined) return "unknown error";

  return String(err).trim() || "unknown error";
}
