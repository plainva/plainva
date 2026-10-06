import { inertLine, type IDatabaseAdapter, type QuarantinedText, type ToolManifest, type ToolOutcome } from "@plainva/core";
import { listMailAccounts, mailAccountKind } from "../mail/mailAccounts";
import { cachedEnvelopes, cachedMessage } from "../mail/mailCache";
import { fetchMessage, listEnvelopes, listMailboxesFor, searchEnvelopes } from "../mail/mailClient";
import type { MailEnvelope, MailMessage } from "../mail/types";
import { readableBody } from "./quarantineText";

/**
 * The assistant's two mail tools (plan KI-Harness P4-4, ADR 0019), one
 * implementation for both shells on the mail client both share.
 *
 * A message is the text of a stranger who may have written it for exactly
 * this reader, and it is private as well. So the two halves of a message go
 * two ways:
 *
 * - the head — date, sender, subject, whether it is unread or carries a file —
 *   goes to the model that holds the tools, as one capped line without a live
 *   address, inside a data fence like every result;
 * - the body goes to no model that has a tool. `read_mail` hands it over as
 *   `quarantine`: a reader without tools reports on it (a model on this
 *   device where one is set up), and only its checked report comes back.
 *
 * Nothing here changes a mailbox: reading is EXAMINE and BODY.PEEK on IMAP
 * and a GET on Graph, so a message the assistant read stays unread, and the
 * mail client's offline copy is read but never written.
 */

export interface MailSourceAccount {
  id: string;
  /** The name the user gave the account, or its address. */
  label: string;
  address: string;
  /** The folder new mail arrives in. */
  inbox: string;
  /** Message ids are IMAP UIDs (numbers) — or opaque strings, for an account read through an API. */
  numericIds: boolean;
}

/** What the tools need of the vault's mail: the shell hands in `vaultMailSource`, a test its own. */
export interface MailSource {
  accounts(): Promise<MailSourceAccount[]>;
  /** The account's folder names as the account writes them. */
  folders(account: MailSourceAccount): Promise<string[]>;
  /** The newest messages of a folder; `offline` when they are this device's copy because the account did not answer. */
  newest(account: MailSourceAccount, folder: string, limit: number): Promise<{ messages: MailEnvelope[]; offline: boolean }>;
  /** Messages of a folder that match, newest first — the account's own search. */
  search(account: MailSourceAccount, folder: string, query: string): Promise<MailEnvelope[]>;
  message(account: MailSourceAccount, folder: string, id: string): Promise<MailMessage | null>;
}

/** The inbox by the name every IMAP server gives it; the Graph client maps it to its well-known folder. */
const INBOX = "INBOX";

/** The vault's mail accounts through the shared mail client. `vaultKey` is what the shell stores them under. */
export function vaultMailSource(vaultKey: string, db: () => IDatabaseAdapter | null | undefined): MailSource {
  const config = async (id: string) => (await listMailAccounts(vaultKey)).find((account) => account.id === id) ?? null;
  return {
    async accounts() {
      return (await listMailAccounts(vaultKey)).map((account) => ({
        id: account.id,
        label: account.label.trim() || account.user,
        address: account.user,
        inbox: INBOX,
        numericIds: mailAccountKind(account) !== "microsoft",
      }));
    },
    async folders(account) {
      const stored = await config(account.id);
      return stored ? (await listMailboxesFor(vaultKey, stored)).map((box) => box.name) : [];
    },
    async newest(account, folder, limit) {
      const stored = await config(account.id);
      if (!stored) return { messages: [], offline: false };
      try {
        return { messages: (await listEnvelopes(vaultKey, stored, folder, 0, limit)).messages, offline: false };
      } catch (error) {
        // No connection: what this device last showed of the folder, said as such.
        const copy = await cachedEnvelopes(db(), stored.id, folder, limit).catch(() => []);
        if (copy.length) return { messages: copy, offline: true };
        throw error;
      }
    },
    async search(account, folder, query) {
      const stored = await config(account.id);
      return stored ? searchEnvelopes(vaultKey, stored, folder, query) : [];
    },
    async message(account, folder, id) {
      const stored = await config(account.id);
      if (!stored) return null;
      const copy = await cachedMessage(db(), stored.id, folder, id).catch(() => null);
      return copy ?? fetchMessage(vaultKey, stored, folder, id);
    },
  };
}

const ACCOUNTS_MAX = 6;
const FOLDERS_LISTED = 40;
const FOLDER_MAX = 200;
const SENDER_MAX = 120;
const SUBJECT_MAX = 160;
const ATTACHMENTS_LISTED = 10;
/** What a reader takes of one message; a longer one is read from its beginning. */
export const MAIL_TEXT_MAX = 40_000;

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return "undated";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Built at run time: a control character is never written into a source file as itself.
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`);

/** A folder name a model gave: a short line without a control character — it reaches a mail server. */
function plainName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= FOLDER_MAX && !CONTROL.test(name) ? name : null;
}

/**
 * A message's handle: enough to find it again in a later turn without any
 * state — the account (by the start of its id), the folder, the message id.
 * It is the model's to copy, so each part is checked when it comes back.
 */
export function mailHandle(account: Pick<MailSourceAccount, "id">, folder: string, id: string): string {
  return [account.id.slice(0, 8), encodeURIComponent(folder), encodeURIComponent(id)].join("/");
}

export function parseMailHandle(handle: string, accounts: readonly MailSourceAccount[]): { account: MailSourceAccount; folder: string; id: string } | null {
  const parts = handle.trim().split("/");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  // Exactly one account: a handle that fits two addresses none.
  const matching = accounts.filter((account) => account.id.slice(0, 8) === parts[0]);
  if (matching.length !== 1) return null;
  const account = matching[0]!;
  let folder: string | null;
  let id: string;
  try {
    folder = plainName(decodeURIComponent(parts[1]!));
    id = decodeURIComponent(parts[2]!);
  } catch {
    return null;
  }
  if (!folder) return null;
  const idFits = account.numericIds ? /^[1-9]\d{0,9}$/.test(id) : /^[A-Za-z0-9+/=_-]{1,512}$/.test(id);
  return idFits ? { account, folder, id } : null;
}

/**
 * A message as a reader takes it. What the user sees is what is read: the
 * HTML part where there is one — as a reader would take a page down, without
 * what the markup hides —, otherwise the plain text. A plain part the mail
 * program never shows beside an HTML one is not read: it is the cheapest
 * place to put words only a model would find.
 */
export function mailDocument(message: MailMessage): { title: string; text: string; links: { text: string; url: string }[]; truncated: boolean } {
  const body = readableBody(message, MAIL_TEXT_MAX);
  const head = [`From: ${message.from}`, message.to ? `To: ${message.to}` : "", `Date: ${stamp(message.dateTs)}`, `Subject: ${message.subject}`].filter(Boolean).join("\n");
  return { title: message.subject, text: `${head}\n\n${body.text || "(The message has no text.)"}`, links: body.links, truncated: body.truncated };
}

function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The head of one message as the model with the tools reads it: capped lines, no live address. */
function headLines(message: MailMessage, account: MailSourceAccount, folder: string): string[] {
  const lines = [`Message: ${inertLine(message.subject, SUBJECT_MAX) || "(no subject)"}`, `From: ${inertLine(message.from, SENDER_MAX) || "(unknown)"}`];
  const to = inertLine(message.to, 200);
  if (to) lines.push(`To: ${to}`);
  lines.push(`Date: ${stamp(message.dateTs)}`, `Account: ${inertLine(account.label, 80)}, folder ${inertLine(folder, 80)}`);
  if (message.attachments.length) {
    const listed = message.attachments.slice(0, ATTACHMENTS_LISTED).map((file) => {
      const detail = [inertLine(file.mime, 60), size(file.size)].filter(Boolean).join(", ");
      return `${inertLine(file.name, 80) || "(unnamed)"}${detail ? ` (${detail})` : ""}`;
    });
    const more = message.attachments.length - listed.length;
    lines.push(`Attachments, not read: ${listed.join("; ")}${more > 0 ? `; and ${more} more` : ""}`);
  }
  return lines;
}

const NO_ACCOUNT = "No mail account is connected in this vault.";
const NO_MESSAGE = "No message with this handle. search_mail lists messages with their handles.";

async function searchMail(source: MailSource, a: Record<string, unknown>): Promise<ToolOutcome> {
  const all = await source.accounts();
  if (!all.length) return { content: NO_ACCOUNT };
  const wanted = typeof a.account === "string" ? a.account.trim().toLowerCase() : "";
  const accounts = (wanted ? all.filter((account) => account.label.toLowerCase().includes(wanted) || account.address.toLowerCase().includes(wanted)) : all).slice(0, ACCOUNTS_MAX);
  if (!accounts.length) return { content: `No mail account matches "${inertLine(a.account, 80)}". Accounts: ${all.map((account) => inertLine(account.label, 80)).join("; ")}.`, isError: true };
  const query = typeof a.query === "string" ? a.query.replace(/\s+/g, " ").trim() : "";
  const limit = Number(a.limit) || 10;
  const named = a.folder === undefined || a.folder === "" ? null : plainName(a.folder);
  if (a.folder !== undefined && a.folder !== "" && !named) return { content: "Give the folder by its name.", isError: true };

  const rows: { account: MailSourceAccount; folder: string; envelope: MailEnvelope }[] = [];
  const notes: string[] = [];
  for (const account of accounts) {
    let folder = account.inbox;
    try {
      if (named && named.toLowerCase() !== account.inbox.toLowerCase()) {
        // Only a folder the account lists is asked for: the name reaches the server as the account wrote it, never as a model did.
        const folders = await source.folders(account);
        const exact = folders.find((name) => name.toLowerCase() === named.toLowerCase());
        if (!exact) {
          notes.push(`${inertLine(account.label, 80)} has no folder "${inertLine(named, 80)}". Its folders: ${folders.slice(0, FOLDERS_LISTED).map((name) => inertLine(name, 80)).join("; ") || "none"}.`);
          continue;
        }
        folder = exact;
      }
      if (query) {
        for (const envelope of await source.search(account, folder, query)) rows.push({ account, folder, envelope });
      } else {
        const page = await source.newest(account, folder, limit);
        for (const envelope of page.messages) rows.push({ account, folder, envelope });
        if (page.offline) notes.push(`${inertLine(account.label, 80)} could not be reached: these are the messages this device saw last.`);
      }
    } catch {
      // The reason may quote a server's words or an address: the model is told that, not why.
      notes.push(`${inertLine(account.label, 80)} could not be reached.`);
    }
  }
  rows.sort((x, y) => y.envelope.dateTs - x.envelope.dateTs);
  const shown = rows.slice(0, limit);
  const several = accounts.length > 1;
  const lines = shown.map(({ account, folder, envelope }) => {
    const marks = [envelope.seen ? "" : "unread", envelope.flagged ? "flagged" : "", envelope.hasAttachments ? "attachment" : ""].filter(Boolean).join(", ");
    const where = several ? ` · ${inertLine(account.label, 40)}` : "";
    return `- ${stamp(envelope.dateTs)} · ${inertLine(envelope.from, SENDER_MAX) || "(unknown)"} · ${inertLine(envelope.subject, SUBJECT_MAX) || "(no subject)"}${marks ? ` · ${marks}` : ""}${where} (message "${mailHandle(account, folder, envelope.id)}")`;
  });
  const what = query ? `matching "${inertLine(query, 120)}"` : "newest first";
  const head = `Mail in ${named ? `the folder "${inertLine(named, 80)}"` : "the inbox"}, ${what}:`;
  const more = rows.length > shown.length ? `\n\n${rows.length - shown.length} more match; narrow the search, or ask for more with a higher limit.` : "";
  const body = lines.length ? `${head}\n${lines.join("\n")}${more}` : query ? "No message matches." : "No messages.";
  const failedAll = !lines.length && notes.length === accounts.length;
  return { content: [body, ...notes].join("\n\n"), origin: { kind: "mail" }, ...(failedAll ? { isError: true } : {}) };
}

async function readMail(source: MailSource, a: Record<string, unknown>): Promise<ToolOutcome> {
  const accounts = await source.accounts();
  if (!accounts.length) return { content: NO_ACCOUNT };
  const at = typeof a.message === "string" ? parseMailHandle(a.message, accounts) : null;
  if (!at) return { content: NO_MESSAGE, isError: true };
  let message: MailMessage | null;
  try {
    message = await source.message(at.account, at.folder, at.id);
  } catch {
    message = null;
  }
  if (!message) return { content: "The message could not be read: it may have been moved or deleted, or its account cannot be reached.", isError: true };
  const document = mailDocument(message);
  const origin = { kind: "mail" as const, account: inertLine(at.account.label, 80) };
  const quarantine: QuarantinedText = {
    title: document.title,
    text: document.text,
    links: document.links,
    question: typeof a.question === "string" ? a.question : "",
    origin,
    ...(document.truncated ? { truncated: true } : {}),
  };
  return { content: headLines(message, at.account, at.folder).join("\n"), origin, quarantine };
}

/** Runs one of the two mail tools; `null` for any other tool. A shell without mail answers that there is none. */
export async function mailToolOutcome(source: MailSource | undefined, tool: ToolManifest, args: unknown): Promise<ToolOutcome | null> {
  if (tool.name !== "search_mail" && tool.name !== "read_mail") return null;
  if (!source) return { content: NO_ACCOUNT };
  const a = (args ?? {}) as Record<string, unknown>;
  return tool.name === "search_mail" ? searchMail(source, a) : readMail(source, a);
}
