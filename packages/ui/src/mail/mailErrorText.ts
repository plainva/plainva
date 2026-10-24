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
  if (errorText(err).includes("MAIL_BULK_UNSUPPORTED")) return t("mail.bulkReason.unsupported");
  if (isMailCredentialsMissing(err)) {
    return t("mail.credentialsMissing", {
      defaultValue: "No password is stored for this mailbox on this device.",
    });
  }
  // A size refusal has an action too — take a file off and send again — and a
  // message that was refused comes back for exactly that (`heldSend.ts`).
  if (isMailTooLarge(err)) return t("mail.sendTooLarge");
  return errorText(err);
}

/**
 * A refusal for SIZE, however the backend words it: an SMTP server answers
 * with the enhanced status 5.3.4 ("message too big for system") or 5.2.3
 * ("message length exceeds administrative limit"), or says so in words; Graph
 * answers a request it finds too large with HTTP 413, Exchange a message with
 * `ErrorMessageSizeExceeded`.
 *
 * Deliberately narrow. A bare 552 also means "the recipient's mailbox is
 * full", and that one must keep its own words.
 */
export function isMailTooLarge(err: unknown): boolean {
  const text = errorText(err);
  return (
    // An enhanced status stands on its own: after the reply code, never inside
    // a longer number (an address in the server's text).
    /(?:^|[\s(:-])5\.(?:3\.4|2\.3)(?=\s|$)/.test(text) ||
    /\bfailed: 413\b/.test(text) ||
    /ErrorMessageSizeExceeded|RequestEntityTooLarge|RequestBodyTooLarge/i.test(text) ||
    /message (?:size|length) (?:exceed|is too|too)|message size limit|message (?:is )?too (?:large|big)/i.test(text)
  );
}
