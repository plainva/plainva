import { invoke } from "@tauri-apps/api/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import type {
  AppendDraftArgs,
  ImapCreds,
  MailTransport,
  MailboxInfo,
  RawImapEnvelope,
  RawImapEnvelopePage,
  RawImapMessage,
  SmtpSendArgs,
} from "@plainva/ui/mail";
import { setMailPlatform } from "@plainva/ui/mail";
import { microsoftAuthFetch } from "../authFetch";

/**
 * Desktop half of the mail seam (feinplan G0.1): a thin passthrough to the
 * Rust commands in `mail_imap.rs` / `mail_smtp.rs`. No logic lives here — the
 * command names, argument names and wire shapes are exactly what the Rust side
 * has always received, so this refactor is behaviour-neutral for the desktop.
 * Rust takes `null` for absent optionals, hence the `?? null` mapping.
 */
export const tauriMailTransport: MailTransport = {
  checkLogin: (creds: ImapCreds) => invoke<MailboxInfo[]>("mail_check_login", { ...creds }),

  listEnvelopes: (creds, args) =>
    invoke<RawImapEnvelopePage>("mail_list_envelopes", {
      ...creds,
      mailbox: args.mailbox,
      offset: args.offset,
      limit: args.limit,
      beforeUid: args.beforeUid,
    }),

  fetchMessage: (creds, args) => invoke<RawImapMessage>("mail_fetch_message", { ...creds, mailbox: args.mailbox, uid: args.uid }),

  fetchRaw: (creds, args) => invoke<string>("mail_fetch_raw", { ...creds, mailbox: args.mailbox, uid: args.uid }),

  fetchAttachment: (creds, args) =>
    invoke<string>("mail_fetch_attachment", { ...creds, mailbox: args.mailbox, uid: args.uid, index: args.index }),

  appendDraft: async (creds: ImapCreds, args: AppendDraftArgs) => {
    await invoke("mail_append_draft", {
      ...creds,
      mailbox: args.mailbox,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: args.attachments ?? null,
      cc: args.cc ?? null,
      bcc: args.bcc ?? null,
    });
  },

  setSeen: async (creds, args) => {
    await invoke("mail_set_seen", { ...creds, mailbox: args.mailbox, uid: args.uid, seen: args.seen });
  },

  setFlagged: async (creds, args) => {
    await invoke("mail_set_flagged", { ...creds, mailbox: args.mailbox, uid: args.uid, flagged: args.flagged });
  },

  moveMessage: async (creds, args) => {
    await invoke("mail_move_message", { ...creds, mailbox: args.mailbox, uid: args.uid, target: args.target });
  },

  setJunk: async (creds, args) => {
    await invoke("mail_set_junk", { ...creds, mailbox: args.mailbox, uid: args.uid, junk: args.junk });
  },

  createMailbox: async (creds, args) => {
    await invoke("mail_create_mailbox", { ...creds, name: args.name });
  },

  sieveGet: async (creds, args) => {
    const [name, body, capabilities] = await invoke<[string, string, string[]]>("mail_sieve_get", {
      host: args.host,
      port: args.port,
      user: creds.user,
      pass: creds.pass,
    });
    return { name, body, capabilities };
  },

  sievePut: async (creds, args) => {
    await invoke("mail_sieve_put", { host: args.host, port: args.port, user: creds.user, pass: creds.pass, name: args.name, body: args.body });
  },

  deleteMessage: async (creds, args) => {
    await invoke("mail_delete_message", { ...creds, mailbox: args.mailbox, uid: args.uid });
  },

  searchEnvelopes: (creds, args) =>
    invoke<RawImapEnvelope[]>("mail_search_envelopes", { ...creds, mailbox: args.mailbox, query: args.query, limit: args.limit }),

  listFlaggedEnvelopes: (creds, args) =>
    invoke<RawImapEnvelope[]>("mail_list_flagged_envelopes", { ...creds, mailbox: args.mailbox, limit: args.limit }),

  send: async (args: SmtpSendArgs) => {
    await invoke("mail_send", {
      host: args.host,
      port: args.port,
      user: args.user,
      pass: args.pass,
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: args.attachments ?? null,
      calendar: args.calendar ?? null,
      calendarMethod: args.calendarMethod ?? null,
      cc: args.cc ?? null,
      bcc: args.bcc ?? null,
    });
  },

  // Findings round P7.2: the Rust side keeps one idle IMAP session per account,
  // so a burst of actions pays a single login. This hands it back when the
  // reason for holding it is gone (account switch, leaving mail).
  releaseSessions: async (user?: string) => {
    await invoke("mail_release_sessions", { user: user ?? null });
  },
};

/**
 * Registers the desktop mail platform. `api` is the Tauri http plugin; `token`
 * is the Origin-free Rust relay — Entra rejects a token POST that carries the
 * WebView origin (AADSTS90023, maintainer finding 2026-07-20).
 */
export function registerDesktopMailPlatform(): void {
  setMailPlatform({ transport: tauriMailTransport, http: { api: httpFetch as typeof fetch, token: microsoftAuthFetch } });
}
