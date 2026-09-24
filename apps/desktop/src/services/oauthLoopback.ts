import { invoke } from "@tauri-apps/api/core";
import i18n from "@plainva/ui/i18n";
import { serviceConnectionMessage } from "@plainva/ui";

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
 * The desktop's name for the ONE shared translation of a failed connection
 * (`serviceConnectionMessage`, finding 2026-09-24).
 *
 * This used to be its own, narrower rule: the loopback markers became
 * sentences and everything else went through unchanged — which is how the
 * wizard printed "storageFailed" where a sentence belonged, while the phone
 * said something readable about the same failure. The loopback markers now
 * live in the shared rule; a provider's own answer still reaches the screen
 * word for word, framed as the provider's answer.
 */
export function oauthErrorText(err: unknown): string {
  return serviceConnectionMessage(err, (key, options) => i18n.t(key, options ?? {}));
}
