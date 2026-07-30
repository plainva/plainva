import { refreshOneDriveAccessToken } from "@plainva/core";
import type { MailAccountConfig } from "./mailAccounts";
import { getMailRefreshToken, saveMailRefreshToken } from "./mailAccounts";
import { mailHttp } from "./transport";
import type { MailboxInfo, MailEnvelope, MailEnvelopePage, MailMessage, MailAttachmentInfo, MailFolderRole } from "./types";
import type { MailAttachment } from "./mailOut";

/**
 * Microsoft Graph mail backend (direct login, no app password / IMAP / SMTP).
 * Reuses the OneDrive PKCE cores and the OAuth loopback listener 1:1 — only the
 * SCOPES differ (delegated Mail.ReadWrite + Mail.Send on the SAME central Entra
 * app as the OneDrive sync). Everything runs over plain HTTP through the
 * injected MailHttp ports, so this file is platform-neutral: the desktop
 * passes the Tauri http plugin, mobile the native bridge. Message ids are
 * opaque Graph strings; folders
 * are addressed by their displayName (mapped to the Graph id per account) OR by
 * a role name, which resolves to Graph's language-independent well-known folder.
 */

export const GRAPH_MAIL_SCOPES = "User.Read Mail.ReadWrite Mail.Send offline_access";
const GRAPH = "https://graph.microsoft.com/v1.0";

/* The consent flow itself is shell-specific (desktop: loopback listener,
   mobile: custom-scheme redirect) and therefore NOT here — see
   `apps/desktop/src/services/mail/graphMailAuth.ts`. */

// ---- Per-account runtime (token cache + folder id map) -------------------

interface GraphMailRuntime {
  getAccessToken(force?: boolean): Promise<string>;
  /** Cached displayName -> Graph folder id (populated by listFolders). */
  folderIds: Map<string, string>;
  /** Cached Graph folder id -> special-use role (well-known lookup). */
  roleByFolderId?: Map<string, MailFolderRole>;
}

const runtimes = new Map<string, GraphMailRuntime>();

/** Access-token provider with single-flight refresh + rotated-token persistence
 * (mirrors buildPimAuthProvider — Microsoft rotates the refresh token). */
/**
 * Set by the shell (cloud accounts stage B): resolves the account broker's
 * access-token provider for the mail service of a vault, or undefined when the
 * account still holds its own refresh token. Injected rather than imported,
 * because the broker wiring is platform code and this module is not.
 */
export type MailTokenResolver = (vaultPath: string) => Promise<((force: boolean) => Promise<string>) | undefined>;
let mailTokenResolver: MailTokenResolver | null = null;
export function setMailTokenResolver(resolver: MailTokenResolver | null): void {
  mailTokenResolver = resolver;
}

function buildRuntime(
  vaultPath: string,
  account: MailAccountConfig,
  initialRefreshToken: string,
  viaBroker?: (force: boolean) => Promise<string>
): GraphMailRuntime {
  const clientId = account.clientId ?? "";
  let accessToken: string | null = null;
  let expiresAt = 0;
  let currentRefreshToken = initialRefreshToken;
  let inFlight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    const res = await refreshOneDriveAccessToken({ clientId, refreshToken: currentRefreshToken, scope: GRAPH_MAIL_SCOPES }, mailHttp().token);
    accessToken = res.accessToken;
    expiresAt = Date.now() + Math.max(60, (res.expiresIn ?? 3600) - 60) * 1000;
    if (res.refreshToken && res.refreshToken !== currentRefreshToken) {
      currentRefreshToken = res.refreshToken;
      await saveMailRefreshToken(vaultPath, account.id, res.refreshToken);
    }
    return accessToken;
  };

  return {
    folderIds: new Map(),
    async getAccessToken(force?: boolean): Promise<string> {
      // The broker caches and single-flights across every service of the
      // account, so nothing is cached a second time here.
      if (viaBroker) return viaBroker(force ?? false);
      if (!force && accessToken && Date.now() < expiresAt) return accessToken;
      if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

async function runtimeFor(vaultPath: string, account: MailAccountConfig): Promise<GraphMailRuntime> {
  const existing = runtimes.get(account.id);
  if (existing) return existing;
  const refreshToken = await getMailRefreshToken(vaultPath, account.id);
  // A broker-backed account carries no mail-side refresh token by design.
  const viaBroker = mailTokenResolver ? await mailTokenResolver(vaultPath).catch(() => undefined) : undefined;
  if (!refreshToken && !viaBroker) throw new Error("missing Microsoft mail credentials");
  const rt = buildRuntime(vaultPath, account, refreshToken ?? "", viaBroker);
  runtimes.set(account.id, rt);
  return rt;
}

/** Drops the cached runtime (token + folder map) when an account is removed. */
export function forgetGraphMailRuntime(accountId: string): void {
  runtimes.delete(accountId);
}

// ---- Request helper (JSON, 401 retry, throttling) ------------------------

/**
 * Graph enforces a MailboxConcurrency limit (a handful of simultaneous
 * requests per mailbox) and answers 429 "ApplicationThrottled" when a client
 * exceeds it. A screen that opens folders and messages at once trips that
 * easily, so requests pass through a small gate AND back off when Graph asks
 * them to. Reported from a device on 2026-07-26; the desktop had the same
 * exposure and inherits the fix.
 */
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds Graph asks us to wait, capped so a bad header cannot hang the UI. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get("Retry-After"));
  const seconds = Number.isFinite(header) && header > 0 ? Math.min(header, 30) : 2 ** attempt;
  return seconds * 1000;
}

async function graphJson<T>(rt: GraphMailRuntime, method: string, path: string, body?: unknown): Promise<T> {
  const call = async (token: string): Promise<Response> =>
    mailHttp().api(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(path.includes("$search") || path.includes("$count") ? { ConsistencyLevel: "eventual" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return gate(async () => {
    let res = await call(await rt.getAccessToken());
    if (res.status === 401) res = await call(await rt.getAccessToken(true));
    for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
      await sleep(retryDelayMs(res, attempt));
      res = await call(await rt.getAccessToken());
    }
    if (!res.ok) throw new Error(`Graph mail ${method} ${path} failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  });
}

// ---- Folder id resolution ------------------------------------------------

/**
 * Graph's WELL-KNOWN folder names are valid folder identifiers on their own
 * (`/me/mailFolders/inbox/messages`) and — unlike displayName — language
 * independent. A German mailbox calls the inbox "Posteingang", so resolving
 * the app's IMAP-flavored role names by display name could never work
 * (maintainer finding 2026-07-20: "Graph mail folder not found: INBOX").
 * Everything that is a role name resolves to the well-known name WITHOUT a
 * request; real folder names still go through the display-name lookup.
 */
const WELL_KNOWN_BY_ROLE: Record<MailFolderRole, string> = {
  inbox: "inbox",
  drafts: "drafts",
  sent: "sentitems",
  trash: "deleteditems",
  junk: "junkemail",
  archive: "archive",
};

/** Role of an app-side mailbox name, for the well-known shortcut above. */
function roleOfName(name: string): MailFolderRole | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n === "inbox") return "inbox";
  if (n === "drafts" || n === "draft") return "drafts";
  if (n === "sent" || n === "sentitems" || n === "sent items") return "sent";
  if (n === "trash" || n === "deleteditems" || n === "deleted items") return "trash";
  if (n === "junk" || n === "spam" || n === "junkemail") return "junk";
  if (n === "archive") return "archive";
  return null;
}

async function resolveFolderId(rt: GraphMailRuntime, displayName: string): Promise<string> {
  if (rt.folderIds.has(displayName)) return rt.folderIds.get(displayName) as string;
  const role = roleOfName(displayName);
  if (role) return WELL_KNOWN_BY_ROLE[role]; // usable as-is, no lookup needed
  await listFoldersInternal(rt); // populate the map
  const id = rt.folderIds.get(displayName);
  if (!id) throw new Error(`Graph mail folder not found: ${displayName}`);
  return id;
}

interface GraphFolder {
  id: string;
  displayName: string;
}

interface GraphFolderRaw extends GraphFolder {
  childFolderCount?: number;
}

/** Follows @odata.nextLink to collect every page (Graph caps a page at ~100;
 * a mailbox with more folders would otherwise silently lose the rest). */
async function graphCollect(rt: GraphMailRuntime, firstPath: string): Promise<GraphFolderRaw[]> {
  const out: GraphFolderRaw[] = [];
  let path: string | null = firstPath;
  while (path) {
    const page: { value?: GraphFolderRaw[]; "@odata.nextLink"?: string } = await graphJson(rt, "GET", path);
    out.push(...(page.value ?? []));
    const next = page["@odata.nextLink"];
    // The nextLink is an absolute URL; graphJson prefixes GRAPH, so strip it.
    path = next ? next.replace(GRAPH, "") : null;
  }
  return out;
}

async function listFoldersInternal(rt: GraphMailRuntime): Promise<GraphFolder[]> {
  const select = "$select=id,displayName,childFolderCount&$top=100";
  const roots = await graphCollect(rt, `/me/mailFolders?${select}`);
  // Descend into child folders (Graph's top-level list omits them) so a nested
  // "Projekte/Kunde A" is reachable. Bounded breadth-first; the label shows the
  // last segment, the full path stays the folder identity.
  const all: GraphFolder[] = [];
  let frontier: { folder: GraphFolderRaw; path: string }[] = roots.map((f) => ({ folder: f, path: f.displayName }));
  let depth = 0;
  while (frontier.length && depth < 6) {
    const next: typeof frontier = [];
    for (const { folder, path } of frontier) {
      all.push({ id: folder.id, displayName: path });
      if (folder.childFolderCount && folder.childFolderCount > 0) {
        const kids = await graphCollect(rt, `/me/mailFolders/${folder.id}/childFolders?${select}`);
        for (const kid of kids) next.push({ folder: kid, path: `${path}/${kid.displayName}` });
      }
    }
    frontier = next;
    depth++;
  }
  rt.folderIds.clear();
  for (const f of all) rt.folderIds.set(f.displayName, f.id);
  return all;
}

/**
 * Maps the well-known folders to their (localized) ids so the UI can label
 * roles without guessing names. One cheap request per role, all in parallel,
 * cached per runtime; a missing folder is simply skipped.
 */
async function wellKnownRoles(rt: GraphMailRuntime): Promise<Map<string, MailFolderRole>> {
  if (rt.roleByFolderId) return rt.roleByFolderId;
  const roles = Object.keys(WELL_KNOWN_BY_ROLE) as MailFolderRole[];
  const found = new Map<string, MailFolderRole>();
  await Promise.all(
    roles.map(async (role) => {
      try {
        const f = await graphJson<{ id?: string }>(rt, "GET", `/me/mailFolders/${WELL_KNOWN_BY_ROLE[role]}?$select=id`);
        if (f?.id) found.set(f.id, role);
      } catch {
        /* a mailbox without this special folder is fine */
      }
    })
  );
  rt.roleByFolderId = found;
  return found;
}

// ---- Public backend (matches the mailClient function shapes) -------------

export async function graphListFolders(vaultPath: string, account: MailAccountConfig): Promise<MailboxInfo[]> {
  const rt = await runtimeFor(vaultPath, account);
  const [folders, roles] = await Promise.all([listFoldersInternal(rt), wellKnownRoles(rt)]);
  // Graph nests folders with "/" (via displayName paths); state it so the UI
  // splits labels at that separator instead of guessing "." vs "/".
  return folders.map((f) => ({ name: f.displayName, role: roles.get(f.id), delimiter: "/" }));
}

/**
 * One attachment's bytes, base64 (mail feinplan G3). The index is the position
 * in the list `graphFetchMessage` reported, so the reader can name what it is
 * asking for without carrying Graph's opaque attachment ids around.
 */
export async function graphFetchAttachment(
  vaultPath: string,
  account: MailAccountConfig,
  _mailbox: string,
  id: string,
  index: number
): Promise<string> {
  const rt = await runtimeFor(vaultPath, account);
  const list = await graphJson<{ value?: Array<{ id?: string; contentBytes?: string }> }>(
    rt,
    "GET",
    `/me/messages/${encodeURIComponent(id)}/attachments?$select=id`
  );
  const item = (list.value ?? [])[index];
  if (!item?.id) throw new Error("attachment not found");
  const full = await graphJson<{ contentBytes?: string }>(
    rt,
    "GET",
    `/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(item.id)}`
  );
  if (!full.contentBytes) throw new Error("this attachment has no downloadable content");
  return full.contentBytes;
}

/** The account's primary address (Graph /me) for the display label; also a
 * cheap validation call after connecting (a login that cannot read /me is a
 * failed login). */
export async function graphMailAddress(vaultPath: string, account: MailAccountConfig): Promise<string> {
  const rt = await runtimeFor(vaultPath, account);
  const me = await graphJson<{ userPrincipalName?: string; mail?: string; displayName?: string }>(
    rt,
    "GET",
    "/me?$select=userPrincipalName,mail,displayName"
  );
  return me.mail || me.userPrincipalName || me.displayName || "Microsoft";
}

interface GraphMessageEnvelope {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  /** Graph's own one-line summary of the body - free of charge in the same
   *  request, which is what makes the mobile list's third line cheap (B3). */
  bodyPreview?: string;
  /**
   * Graph's own conversation grouping (findings P9.1). Free in the same request
   * and better than anything we could reconstruct: Exchange has already decided
   * what belongs together, including replies whose References header a client
   * dropped. IMAP has no equivalent, hence the RFC chain there.
   */
  conversationId?: string;
}

function addressLabel(who: GraphMessageEnvelope["from"]): string {
  const ea = who?.emailAddress;
  if (!ea) return "";
  const addr = ea.address ?? "";
  const name = ea.name && ea.name !== addr ? ea.name : "";
  return name ? `${name} <${addr}>` : addr;
}

export async function graphListEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  offset: number,
  limit: number
): Promise<MailEnvelopePage> {
  const rt = await runtimeFor(vaultPath, account);
  const folderId = await resolveFolderId(rt, mailbox);
  const q =
    `/me/mailFolders/${encodeURIComponent(folderId)}/messages` +
    `?$select=id,subject,from,receivedDateTime,isRead,flag,bodyPreview,conversationId&$orderby=receivedDateTime desc` +
    `&$top=${limit}&$skip=${offset}&$count=true`;
  const data = await graphJson<{ value: GraphMessageEnvelope[]; "@odata.count"?: number }>(rt, "GET", q);
  const messages = (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject ?? "",
    from: addressLabel(m.from),
    dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
    seen: m.isRead === true,
    flagged: m.flag?.flagStatus === "flagged",
    preview: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim(),
    threadId: m.conversationId ?? undefined,
  }));
  // The folder carries its own unread count (no need to page every message).
  const folder = await graphJson<{ unreadItemCount?: number }>(rt, "GET", `/me/mailFolders/${encodeURIComponent(folderId)}?$select=unreadItemCount`);
  return { total: data["@odata.count"] ?? messages.length + offset, unseen: folder.unreadItemCount ?? 0, messages };
}

interface GraphMessageFull {
  id: string;
  subject?: string;
  from?: GraphMessageEnvelope["from"];
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  internetMessageId?: string;
}

export async function graphFetchMessage(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string): Promise<MailMessage> {
  const rt = await runtimeFor(vaultPath, account);
  const m = await graphJson<GraphMessageFull>(
    rt,
    "GET",
    `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,receivedDateTime,body,hasAttachments,internetMessageId`
  );
  const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
  const content = m.body?.content ?? "";
  let attachments: MailAttachmentInfo[] = [];
  if (m.hasAttachments) {
    const list = await graphJson<{ value: Array<{ name?: string; contentType?: string; size?: number }> }>(
      rt,
      "GET",
      `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size`
    );
    attachments = (list.value ?? []).map((a, i) => ({ index: i, name: a.name ?? `attachment-${i}`, mime: a.contentType ?? "application/octet-stream", size: a.size ?? 0 }));
  }
  const to = (m.toRecipients ?? []).map((r) => addressLabel({ emailAddress: r.emailAddress })).filter(Boolean).join(", ");
  return {
    id: m.id,
    subject: m.subject ?? "",
    from: addressLabel(m.from),
    to,
    dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
    text: isHtml ? null : content,
    html: isHtml ? content : null,
    attachments,
    providerMessageId: m.internetMessageId,
  };
}

/** Raw MIME (.eml) of a message, base64 — the "+ .eml beilegen" capture. */
export async function graphFetchRaw(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string): Promise<string> {
  const rt = await runtimeFor(vaultPath, account);
  const res = await mailHttp().api(`${GRAPH}/me/messages/${encodeURIComponent(id)}/$value`, {
    headers: { Authorization: `Bearer ${await rt.getAccessToken()}` },
  });
  if (!res.ok) throw new Error(`Graph mail raw fetch failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function graphSetSeen(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string, seen: boolean): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  await graphJson(rt, "PATCH", `/me/messages/${encodeURIComponent(id)}`, { isRead: seen });
}

export async function graphSetFlagged(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string, flagged: boolean): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  await graphJson(rt, "PATCH", `/me/messages/${encodeURIComponent(id)}`, {
    flag: { flagStatus: flagged ? "flagged" : "notFlagged" },
  });
}

export async function graphDeleteMessage(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  await graphJson(rt, "DELETE", `/me/messages/${encodeURIComponent(id)}`);
}

export async function graphMove(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string, targetDisplayName: string): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const destinationId = await resolveFolderId(rt, targetDisplayName);
  await graphJson(rt, "POST", `/me/messages/${encodeURIComponent(id)}/move`, { destinationId });
}

/** Searches a folder and returns matching ENVELOPES (not just ids), so hits
 * outside the loaded page still appear. Graph's $search cannot combine with
 * $orderby, so we sort client-side. */
export async function graphSearchEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  query: string
): Promise<MailEnvelope[]> {
  const rt = await runtimeFor(vaultPath, account);
  const folderId = await resolveFolderId(rt, mailbox);
  const q =
    `/me/mailFolders/${encodeURIComponent(folderId)}/messages` +
    `?$search="${encodeURIComponent(query)}"&$select=id,subject,from,receivedDateTime,isRead,flag,bodyPreview,conversationId&$top=50`;
  const data = await graphJson<{ value: GraphMessageEnvelope[] }>(rt, "GET", q);
  return (data.value ?? [])
    .map((m) => ({
      id: m.id,
      subject: m.subject ?? "",
      from: addressLabel(m.from),
      dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
      seen: m.isRead === true,
      flagged: m.flag?.flagStatus === "flagged",
      preview: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim(),
    threadId: m.conversationId ?? undefined,
    }))
    .sort((a, b) => b.dateTs - a.dateTs);
}

/** Server-side list of flagged messages in one folder. */
export async function graphListFlaggedEnvelopes(
  vaultPath: string,
  account: MailAccountConfig,
  mailbox: string,
  limit = 200
): Promise<MailEnvelope[]> {
  const rt = await runtimeFor(vaultPath, account);
  const folderId = await resolveFolderId(rt, mailbox);
  const q =
    `/me/mailFolders/${encodeURIComponent(folderId)}/messages` +
    `?$filter=flag/flagStatus eq 'flagged'&$select=id,subject,from,receivedDateTime,isRead,flag,bodyPreview,conversationId&$top=${Math.min(limit, 500)}`;
  const data = await graphJson<{ value: GraphMessageEnvelope[] }>(rt, "GET", q);
  return (data.value ?? [])
    .map((m) => ({
      id: m.id,
      subject: m.subject ?? "",
      from: addressLabel(m.from),
      dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
      seen: m.isRead === true,
      flagged: m.flag?.flagStatus === "flagged",
      preview: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim(),
    threadId: m.conversationId ?? undefined,
    }))
    .sort((a, b) => b.dateTs - a.dateTs);
}

// ---- Outgoing (compose send / draft) -------------------------------------

export function toRecipients(to: string): Array<{ emailAddress: { address: string } }> {
  return to
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/<([^>]+)>/);
      return { emailAddress: { address: (m ? m[1] : raw).trim() } };
    });
}

export function graphAttachments(attachments: MailAttachment[]): Array<Record<string, unknown>> {
  return attachments.map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.name,
    contentType: a.mime,
    contentBytes: a.contentBase64,
  }));
}

/** Sends an outgoing message via Graph /me/sendMail (saved to Sent Items). */
export async function graphSendMail(
  vaultPath: string,
  account: MailAccountConfig,
  to: string,
  subject: string,
  html: string,
  attachments: MailAttachment[] = [],
  cc = "",
  bcc = "",
  /** Chosen sender address; only sent when it differs from the account itself,
   * because Graph rejects a `from` the mailbox has no SendAs right for. */
  from = ""
): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toRecipients(to),
  };
  const sender = pickSender(from, account);
  if (sender) message.from = { emailAddress: { address: sender } };
  if (cc.trim()) message.ccRecipients = toRecipients(cc);
  if (bcc.trim()) message.bccRecipients = toRecipients(bcc);
  if (attachments.length) message.attachments = graphAttachments(attachments);
  await graphJson(rt, "POST", "/me/sendMail", { message, saveToSentItems: true });
}

/** The bare address to put in `from`, or "" when it is the account's own
 * (the common case — sending it back would only invite a SendAs rejection). */
function pickSender(from: string, account: MailAccountConfig): string {
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  if (!addr || addr.toLowerCase() === account.user.trim().toLowerCase()) return "";
  return addr;
}

/** Creates a \Draft message in the mailbox (Graph POST /me/messages). */
export async function graphAppendDraft(
  vaultPath: string,
  account: MailAccountConfig,
  to: string,
  subject: string,
  html: string,
  attachments: MailAttachment[] = [],
  cc = "",
  bcc = ""
): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const body: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toRecipients(to),
  };
  if (cc.trim()) body.ccRecipients = toRecipients(cc);
  if (bcc.trim()) body.bccRecipients = toRecipients(bcc);
  if (attachments.length) body.attachments = graphAttachments(attachments);
  await graphJson(rt, "POST", "/me/messages", body);
}
