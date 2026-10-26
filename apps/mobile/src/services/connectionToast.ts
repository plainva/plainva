import { getPlatformServices, googleClientGuideUrl, isGoogleAuthorizationCancelled, isGoogleClientProblem, serviceConnectionMessage, toast, type ToastAction } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { wasSignInAnnounced } from "./signInNotice";
import { devicePlatform } from "./devicePlatform";

/**
 * The sentence and, where it helps, the way on for a failed connection on the
 * phone: the shared sentence (lib/serviceConnection.ts) for this device's
 * platform, and for a Google client of the wrong type (issue 142) the guide's
 * section on the phone's client as the toast's button.
 */
export function connectionFailureToast(error: unknown): [message: string, action?: ToastAction] {
  const platform = devicePlatform();
  const message = serviceConnectionMessage(error, (key, options) => i18n.t(key, options ?? {}), { platform });
  if (!isGoogleClientProblem(error)) return [message];
  return [message, {
    label: i18n.t("cloudAccounts.providerHelp", { provider: "Google" }),
    run: () => void getPlatformServices().openExternal(googleClientGuideUrl(platform)).catch(() => undefined),
  }];
}

/**
 * The toast of a sign-in that did not complete — one rule for every place that
 * starts one from a button outside a form.
 *
 * These places printed the raw error: a provider's wording, or a code where a
 * sentence belonged. And a sheet the user closed was an error in red. A cancel
 * is now a neutral note; everything else is the shared connection sentence
 * (lib/serviceConnection.ts), which names the cause.
 */
export function toastConnectionFailure(error: unknown): void {
  // The card already says it (`signInNotice`).
  if (wasSignInAnnounced(error)) return;
  if (isGoogleAuthorizationCancelled(error)) {
    toast.info(i18n.t("settings.oauthCancelled"));
    return;
  }
  toast.error(...connectionFailureToast(error));
}
