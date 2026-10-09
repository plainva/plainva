import { isGoogleAuthorizationCancelled, serviceConnectionMessage, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

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
  if (isGoogleAuthorizationCancelled(error)) {
    toast.info(i18n.t("settings.oauthCancelled"));
    return;
  }
  toast.error(serviceConnectionMessage(error, (key, options) => i18n.t(key, options ?? {})));
}
