import { errorText } from "../lib/errorText";
import { isMailCredentialsMissing } from "./credentialsError";
import { GRAPH_UPLOAD_FAILED } from "./graphMail";

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
  // A file that did not get through an upload session (Microsoft, over
  // 2.8 MB): sending again tries again, and the message is back for that.
  const upload = new RegExp(`${GRAPH_UPLOAD_FAILED} for "(.*?)":`).exec(errorText(err));
  if (upload) return t("mail.sendUploadFailed", { name: upload[1] });
  return mailFailureWords(errorText(err), t);
}

/**
 * A transport's own words for a failure, as a person reads them (Sammelplan
 * § 3.95 Nr. 6). A file that did not come along, and every other mail failure
 * without a sentence of its own, stood there as the transport wrote it — for a
 * Microsoft mailbox Graph's whole answer as JSON ("Graph mail GET … failed: 503
 * {…}"). Now a service that is busy or down for a moment says so in our words,
 * with what to do: try again shortly. Anything else keeps the server's words,
 * but of a JSON answer only its message.
 */
export function mailFailureWords(text: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (isMailServiceBusy(text)) return t("mail.serviceBusy");
  const json = /^(.*?failed: (\d{3}))\s+(\{[\s\S]*\})\s*$/.exec(text);
  if (!json) return text;
  try {
    const body = JSON.parse(json[3]) as { error?: { message?: unknown; code?: unknown } } | null;
    const said = body?.error?.message ?? body?.error?.code;
    return typeof said === "string" && said.trim() ? `${said.trim()} (${json[2]})` : text;
  } catch {
    return text;
  }
}

/**
 * A service that does not answer FOR NOW: HTTP 429, 502, 503 or 504 from Graph
 * or Gmail, Exchange's own names for the same, or an SMTP or IMAP server's
 * temporary refusal for load (421, 4.3.2). Waiting and trying again is the
 * answer to each of them.
 */
export function isMailServiceBusy(text: string): boolean {
  return (
    /\bfailed: (?:429|502|503|504)\b/.test(text) ||
    /\b(?:ServiceUnavailable|TooManyRequests|ApplicationThrottled|ErrorServerBusy|MailboxConcurrency)\b/i.test(text) ||
    /(?:^|[\s(:-])4\.3\.2(?=\s|$)/.test(text) ||
    /smtp error \(421\)|^421[ -]/im.test(text)
  );
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
