import { connectionFailureCode, isRequestSendFailure } from "@plainva/core";
import { classifyAuthError, isApiNotEnabled } from "./authErrors";
import { serviceConnectionFailure, type ConnectionTranslate } from "./serviceConnection";

/**
 * A calendar account's provider by its name (finding 2026-10-30): the phone
 * showed the raw id in capitals ("GOOGLE"), the desktop its name. One answer
 * for both shells.
 */
export function pimProviderName(provider: string, t: ConnectionTranslate): string {
  if (provider === "caldav") return "CalDAV";
  if (provider === "google") return "Google";
  if (provider === "microsoft") return "Microsoft";
  // "device" never reaches a desktop (EventKit plan E3) — named anyway.
  if (provider === "device") return t("cloudAccounts.familyDevice");
  return provider;
}

/** What a calendar account's failure says, in the parts both shells draw. */
export interface PimAccountFailureView {
  /** Who failed — "No connection", "Google refused", "Not completed" (`serviceConnectionFailure`). */
  title: string | null;
  /** The sentence for the person, in the calendar's own words. */
  text: string;
  /** The background of the sentence, behind an info button, where there is one. */
  info?: string;
  /** The failure's own words, shown small: a diagnosis needs them, a person reads past them. */
  raw: string;
  /** Signing in again is what helps (an expired grant cannot be retried into working). */
  signIn: boolean;
}

/**
 * The failure of a calendar account as the settings show it (finding
 * 2026-10-30). The phone drew the sentence and the raw code ("HTTP_NETWORK_ERROR")
 * as two loose lines under the account; the desktop a banner with the words as
 * a paragraph. Both now draw these parts: the sender in bold, the sentence,
 * the words small — the grammar of the connect assistant's failures.
 *
 * The sentence stays the calendar's: "The account could not be reached" says
 * more about an account that has worked before than the assistant's sentences,
 * which are about a first sign-in.
 */
export function pimAccountFailure(message: string, provider: string, t: ConnectionTranslate): PimAccountFailureView {
  // The desktop's HTTP stack words a request that never got an answer as "error
  // sending request for url (…)"; that is no connection too — unless a
  // certificate is the reason, which `connectionFailureCode` names.
  const sendFailure = isRequestSendFailure(message) && !connectionFailureCode(message)?.startsWith("TLS_");
  const kind = sendFailure ? "network" : classifyAuthError(message);
  const apiOff = isApiNotEnabled(message);
  // Checked before the kind: the registration is right here, the API is simply off in the person's own project.
  const text = apiOff
    ? t("pim.authApiDisabled")
    : kind === "expired"
      ? provider === "google" ? t("pim.authExpiredGoogleShort") : t("pim.authExpired")
      : kind === "config"
        ? t("pim.authConfig")
        : kind === "network"
          ? t("pim.authNetwork")
          : t("pim.accountFailed");
  // A BYO Google client whose consent screen is in "testing" expires every grant after seven days.
  const info = !apiOff && kind === "expired" && provider === "google" ? t("pim.authExpiredGoogle") : undefined;
  const sender = serviceConnectionFailure(message, t, { provider: pimProviderName(provider, t) });
  return {
    title: kind === "network" ? t("connectRun.noConnection") : sender.title,
    text,
    ...(info ? { info } : {}),
    raw: message,
    signIn: kind === "expired",
  };
}
