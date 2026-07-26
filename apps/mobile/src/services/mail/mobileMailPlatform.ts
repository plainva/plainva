import { createSocketMailTransport, setMailPlatform, setMailSocket } from "@plainva/ui/mail";
import type { MailTransport } from "@plainva/ui/mail";
import { webdavFetch } from "../../adapters/webdavHttp";
import { hasNativeMailSocket, nativeMailSocket } from "../../adapters/mailNet";

/**
 * Thrown by IMAP/SMTP where no raw socket exists — that is only the web dev
 * server now that the native plugin has landed (G2). The UI checks for this
 * via `isImapUnavailable` and says so instead of showing a stack trace.
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

/** Used where there is no socket (web dev server): every operation refuses. */
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
 *
 * IMAP/SMTP run on the native raw socket (G2) through the shared protocol
 * client. On the web dev server there is no socket, so that half refuses —
 * Microsoft accounts keep working there because Graph is plain HTTPS.
 */
export function registerMobileMailPlatform(): void {
  const native = hasNativeMailSocket();
  if (native) setMailSocket(nativeMailSocket);
  setMailPlatform({
    transport: native ? createSocketMailTransport() : unavailableImapTransport,
    http: { api: webdavFetch, token: webdavFetch },
  });
}
