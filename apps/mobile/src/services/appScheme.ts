/**
 * The app's own URL scheme: its application id (Android) and bundle id (iOS).
 *
 * Deep links, OAuth redirects, launcher shortcuts and widget taps all ride it.
 * A literal "com.plainva.app" would send every one of them from the Labs build
 * (com.plainva.app.labs, docs/engineering/Labs_Channel.md) to the store app
 * installed next to it. labs-mobile.yml builds with VITE_PLAINVA_APP_ID; every
 * other build is the store app.
 */
const configured: unknown = import.meta.env.VITE_PLAINVA_APP_ID;

export const APP_ID: string =
  typeof configured === "string" && /^com\.plainva\.app(?:\.[a-z]+)?$/.test(configured) ? configured : "com.plainva.app";

/** `com.plainva.app://` — the prefix of every URL the app hands itself. */
export const APP_URL = `${APP_ID}://`;

/**
 * The address an answer on the app's scheme was sent to: without its query
 * and fragment, and without the slash of an empty path. Microsoft sends a
 * sign-in back to `com.plainva.app://oauth/?code=…` when asked for
 * `com.plainva.app://oauth` - the same address, and both sign-in handlers
 * compared it character for character, so every Microsoft sign-in on Android
 * was set aside as somebody else's (device finding 2026-10-28). Compared
 * through this, the two spellings are one address.
 */
export function redirectAddress(url: string): string {
  const address = url.split(/[?#]/)[0];
  return address.endsWith("/") && !/:\/*$/.test(address) ? address.slice(0, -1) : address;
}
