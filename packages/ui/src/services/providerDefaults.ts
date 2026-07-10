/**
 * Central app registrations for OAuth sync providers (sync-provider plan 2026-07-04).
 *
 * Both are PUBLIC client identifiers (not secrets — safe to ship in the binary).
 * These are Plainva's official app registrations (plan items M-A/M-B, filled
 * 2026-07-06). When set, the settings form pre-fills them and hides the plumbing;
 * a user can still override with their own id (BYO-style, like Google Drive).
 *
 * - OneDrive: Entra app registration, platform "Mobile and desktop applications",
 *   redirect URI `http://localhost` (matches any loopback port).
 * - Dropbox: scoped app, FULL Dropbox access, redirect URI EXACTLY
 *   `http://127.0.0.1:41953` (DROPBOX_REDIRECT_URI in @plainva/core).
 */
export const PLAINVA_ONEDRIVE_CLIENT_ID = "2b90185b-d713-45ad-8ba0-4344d79429e1";
export const PLAINVA_DROPBOX_APP_KEY = "v21xhqs8g6o8tww";
