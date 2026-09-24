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
