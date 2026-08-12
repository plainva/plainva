import { errorText } from "../lib/errorText";
import { isMailCredentialsMissing } from "./credentialsError";

/**
 * The sentence a mail failure gets on screen.
 *
 * The core throws error OBJECTS and keeps its messages English — they are log
 * lines. This is the other half: the surface turns the conditions it can name
 * into a translated sentence, and everything else into the raw text, which is
 * still better than nothing.
 *
 * Only conditions with an ACTION belong here. "No password on this device" has
 * one — sign in — and it reached German surfaces as `missing mail credentials`
 * twice, from two separate rounds. A timeout or a server's own refusal has no
 * such answer, so it keeps its own words rather than being flattened into a
 * friendly sentence that says less.
 */
export function mailErrorText(err: unknown, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (isMailCredentialsMissing(err)) {
    return t("mail.credentialsMissing", {
      defaultValue: "No password is stored for this mailbox on this device.",
    });
  }
  return errorText(err);
}
