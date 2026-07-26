import { setMailPlatform } from "@plainva/ui/mail";
import type { MailTransport } from "@plainva/ui/mail";
import { webdavFetch } from "../../adapters/webdavHttp";

/**
 * Thrown by every IMAP/SMTP operation on mobile until the native mail plugin
 * lands (mail feinplan G2). Mobile ships Graph-only first (G1), and the whole
 * point of the transport seam is that the shared client does not need to know
 * that — it calls the transport, and here the answer is an honest, catchable
 * "not on this platform yet" instead of a stack trace about a missing plugin.
 *
 * The UI checks for this via `isImapUnavailable` and offers the Microsoft
 * sign-in instead of a generic failure.
 */
export class MailImapUnavailableError extends Error {
  readonly code = "imap-unavailable";
  constructor() {
    super("IMAP/SMTP is not available on mobile yet — connect a Microsoft account, or use Plainva on the desktop.");
    this.name = "MailImapUnavailableError";
  }
}

export function isImapUnavailable(err: unknown): boolean {
  return err instanceof MailImapUnavailableError || (typeof err === "object" && err !== null && (err as { code?: string }).code === "imap-unavailable");
}

/**
 * The G1 transport: every operation refuses. Deliberately NOT a partial
 * implementation — a half-working IMAP client would silently lose mail. G2
 * replaces this object wholesale with the Capacitor plugin; nothing above the
 * seam changes.
 */
const unavailableImapTransport: MailTransport = {
  checkLogin: () => Promise.reject(new MailImapUnavailableError()),
  listEnvelopes: () => Promise.reject(new MailImapUnavailableError()),
  fetchMessage: () => Promise.reject(new MailImapUnavailableError()),
  fetchRaw: () => Promise.reject(new MailImapUnavailableError()),
  fetchAttachment: () => Promise.reject(new MailImapUnavailableError()),
  appendDraft: () => Promise.reject(new MailImapUnavailableError()),
  setSeen: () => Promise.reject(new MailImapUnavailableError()),
  setFlagged: () => Promise.reject(new MailImapUnavailableError()),
  moveMessage: () => Promise.reject(new MailImapUnavailableError()),
  deleteMessage: () => Promise.reject(new MailImapUnavailableError()),
  searchEnvelopes: () => Promise.reject(new MailImapUnavailableError()),
  listFlaggedEnvelopes: () => Promise.reject(new MailImapUnavailableError()),
  send: () => Promise.reject(new MailImapUnavailableError()),
};

/**
 * Mobile half of the mail seam. Both HTTP functions are the native bridge: it
 * sends no `Origin` header, so the desktop's Rust token relay (which exists
 * only to strip that header — AADSTS90023) has no mobile counterpart.
 * `graph.microsoft.com` and `login.microsoftonline.com` are already on the
 * native allowlist from the sync work, so no `allowHttpOrigin` call is needed.
 */
export function registerMobileMailPlatform(): void {
  setMailPlatform({ transport: unavailableImapTransport, http: { api: webdavFetch, token: webdavFetch } });
}
