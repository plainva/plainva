/**
 * "This mailbox has no password on this device."
 *
 * It was `throw new Error("missing mail credentials")`, and that English
 * sentence reached German surfaces unchanged — twice reported, from two
 * different rounds. The obvious repair is to translate at the throw, and it is
 * the wrong one: the mail core has no locale, runs on both shells, and its
 * errors also go into logs and diagnostics, where an English sentence is what
 * a reader wants. A transport error stays an error OBJECT; the surface decides
 * the sentence.
 *
 * So the condition gets a NAME instead. The predicate matches the class or the
 * `code`, because an error can cross a bridge (Tauri, Capacitor) that keeps
 * only plain data — the same shape `MailImapUnavailableError` already uses on
 * the phone, for the same reason.
 *
 * The message is deliberately still English: it is the log line, not the label.
 */
export class MailCredentialsMissingError extends Error {
  readonly code = "mail-credentials-missing";
  constructor() {
    super("missing mail credentials");
    this.name = "MailCredentialsMissingError";
  }
}

export function isMailCredentialsMissing(err: unknown): boolean {
  return (
    err instanceof MailCredentialsMissingError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "mail-credentials-missing")
  );
}
