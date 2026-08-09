import type { MailboxInfo } from "./types";
import type { RawImapEnvelope, RawImapEnvelopePage, RawImapMessage } from "./types";

/**
 * The ONE seam between the shared mail client and the platform (mail feinplan
 * G0.1). Everything above this interface — account model, IMAP/Graph branching,
 * folder logic, MIME/reply building, sanitising — is platform-neutral and lives
 * in `packages/ui/src/mail`. Below it sit two implementations:
 *
 *   desktop: `apps/desktop/src/services/mail/tauriMailTransport.ts` — a thin
 *            passthrough to the Rust commands in `mail_imap.rs`/`mail_smtp.rs`
 *   mobile:  a Capacitor plugin (feinplan G2), same operations, same shapes
 *
 * The interface deliberately mirrors the Rust command surface 1:1, including
 * the numeric IMAP UIDs: the uid ↔ string-id mapping stays in `mailClient` so
 * both platforms inherit it (and its tests) instead of re-implementing it.
 *
 * Credentials are passed per call and never held by the transport — the same
 * contract the Rust side has always had (fresh connection per command).
 */

export interface ImapCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface ImapAttachment {
  name: string;
  mime: string;
  contentBase64: string;
}

export interface SmtpSendArgs {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: ImapAttachment[];
  /** iCalendar payload for iMIP invitations (`text/calendar` alternative). */
  calendar?: string;
  calendarMethod?: string;
  cc?: string;
  bcc?: string;
}

export interface AppendDraftArgs {
  mailbox: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: ImapAttachment[];
  cc?: string;
  bcc?: string;
}

export interface MailTransport {
  checkLogin(creds: ImapCreds): Promise<MailboxInfo[]>;
  listEnvelopes(creds: ImapCreds, args: { mailbox: string; offset: number; limit: number; beforeUid?: number }): Promise<RawImapEnvelopePage>;
  fetchMessage(creds: ImapCreds, args: { mailbox: string; uid: number }): Promise<RawImapMessage>;
  fetchRaw(creds: ImapCreds, args: { mailbox: string; uid: number }): Promise<string>;
  fetchAttachment(creds: ImapCreds, args: { mailbox: string; uid: number; index: number }): Promise<string>;
  appendDraft(creds: ImapCreds, args: AppendDraftArgs): Promise<void>;
  setSeen(creds: ImapCreds, args: { mailbox: string; uid: number; seen: boolean }): Promise<void>;
  setFlagged(creds: ImapCreds, args: { mailbox: string; uid: number; flagged: boolean }): Promise<void>;
  moveMessage(creds: ImapCreds, args: { mailbox: string; uid: number; target: string }): Promise<void>;
  /**
   * Sets or clears the `$Junk` keyword (S12). Optional twice over: a backend
   * without custom keywords leaves it out, and a server that rejects them makes
   * it throw. Callers treat both as "not trained", never as a failed action.
   */
  setJunk?(creds: ImapCreds, args: { mailbox: string; uid: number; junk: boolean }): Promise<void>;
  /** Creates a mailbox — used when an account has no junk folder at all.
   * Optional: backends with fixed well-known folders have nothing to create. */
  createMailbox?(creds: ImapCreds, args: { name: string }): Promise<void>;
  deleteMessage(creds: ImapCreds, args: { mailbox: string; uid: number }): Promise<void>;
  searchEnvelopes(creds: ImapCreds, args: { mailbox: string; query: string; limit: number }): Promise<RawImapEnvelope[]>;
  listFlaggedEnvelopes(creds: ImapCreds, args: { mailbox: string; limit: number }): Promise<RawImapEnvelope[]>;
  send(args: SmtpSendArgs): Promise<void>;
  /**
   * Releases pooled IMAP connections — one account when `user` is given, all of
   * them otherwise. Optional: a transport that opens a connection per operation
   * has nothing to release, and callers must not depend on it having happened.
   */
  releaseSessions?(user?: string): Promise<void>;
}

/** Fire-and-forget release: a transport without a pool simply has nothing to do. */
export async function releaseMailSessions(user?: string): Promise<void> {
  const transport = current?.transport;
  if (!transport?.releaseSessions) return;
  try {
    await transport.releaseSessions(user);
  } catch {
    // Releasing is housekeeping — a failure must never surface as a mail error.
  }
}

/**
 * HTTP for the Microsoft Graph backend. Two functions because the desktop needs
 * them to differ: token POSTs must carry no `Origin` header (AADSTS90023), so
 * they go through a Rust relay while API calls use the Tauri http plugin. On
 * mobile the native bridge sends no Origin either — there both are the same
 * function.
 */
export interface MailHttp {
  api: typeof fetch;
  token: typeof fetch;
}

export interface MailPlatform {
  transport: MailTransport;
  http: MailHttp;
}

let current: MailPlatform | null = null;

/** Called once by the app shell before any mail screen is opened. */
export function setMailPlatform(platform: MailPlatform): void {
  current = platform;
}

export function hasMailPlatform(): boolean {
  return current !== null;
}

export function getMailPlatform(): MailPlatform {
  if (!current) {
    throw new Error("MailPlatform not registered — the app shell must call setMailPlatform() before using mail");
  }
  return current;
}

export function mailTransport(): MailTransport {
  return getMailPlatform().transport;
}

export function mailHttp(): MailHttp {
  return getMailPlatform().http;
}
