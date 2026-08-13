import { invoke } from "@tauri-apps/api/core";
import i18n from "@plainva/ui/i18n";

/**
 * The loopback that catches the OAuth redirect, and what to say when it does
 * not arrive (N1/S1).
 *
 * Two things were missing around a wait that can run for three minutes. There
 * was no way to STOP it — the abort flag existed in Rust, but only
 * `oauth_loopback_start` could reach it, so closing the consent tab left the
 * dialog spinning with nothing to offer. And when the wait finally gave up, the
 * form printed the raw `oauth loopback timed out`: an English sentence about an
 * internal mechanism, in front of someone who simply closed a browser tab.
 *
 * The freeze itself was fixed earlier (the wait runs on a worker thread, the
 * window stays alive). What is fixed here is that the app now ANSWERS.
 */

/** Aborts a pending wait. Safe to call when there is none. */
export async function cancelOAuthLoopback(): Promise<void> {
  await invoke("oauth_loopback_cancel").catch(() => {
    /* nothing pending, or the wait already returned — either way there is
       nothing left to stop, and a cancel must never itself become an error */
  });
}

/**
 * Turns a loopback failure into a sentence about what the person did.
 *
 * Matched on the marker strings the Rust side returns, deliberately narrow:
 * anything else keeps its own text, because a provider's real error message
 * ("access_denied: the app is not verified") says far more than a generic
 * replacement would.
 */
export function oauthErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (raw.includes("oauth loopback cancelled")) return i18n.t("settings.oauthCancelled");
  if (raw.includes("oauth loopback timed out")) return i18n.t("settings.oauthTimedOut");
  if (raw.includes("oauth error in redirect")) {
    // The provider said why; keep its words and only frame them.
    const detail = raw.split("oauth error in redirect:").pop()?.trim();
    return detail ? i18n.t("settings.oauthProviderError", { detail }) : i18n.t("settings.oauthCancelled");
  }
  return raw;
}
