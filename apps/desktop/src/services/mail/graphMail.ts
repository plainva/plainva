import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import {
  generatePkcePair,
  generateCodeVerifier,
  buildOneDriveAuthUrl,
  exchangeOneDriveCode,
  refreshOneDriveAccessToken,
} from "@plainva/core";
import type { MailAccountConfig } from "./mailAccounts";
import { getMailRefreshToken, saveMailRefreshToken } from "./mailAccounts";
import { microsoftAuthFetch } from "../authFetch";
import type { MailboxInfo, MailEnvelope, MailEnvelopePage, MailMessage, MailAttachmentInfo, MailFolderRole } from "./mailClient";
import type { MailAttachment } from "./mailOut";

/**
 * Microsoft Graph mail backend (direct login, no app password / IMAP / SMTP).
 * Reuses the OneDrive PKCE cores and the OAuth loopback listener 1:1 — only the
 * SCOPES differ (delegated Mail.ReadWrite + Mail.Send on the SAME central Entra
 * app as the OneDrive sync). Everything runs over the Tauri http bridge; there
 * is no Rust for Microsoft mail. Message ids are opaque Graph strings; folders
 * are addressed by their displayName (mapped to the Graph id per account) OR by
 * a role name, which resolves to Graph's language-independent well-known folder.
 */

export const GRAPH_MAIL_SCOPES = "User.Read Mail.ReadWrite Mail.Send offline_access";
const GRAPH = "https://graph.microsoft.com/v1.0";

// ---- OAuth ---------------------------------------------------------------

/** Runs the Microsoft consent flow for mail (loopback) and returns the refresh
 * token (not persisted — the account id does not exist yet at authorize time). */
export async function authorizeMicrosoftMail(opts: { clientId: string }): Promise<{ refreshToken: string }> {
  const port = await invoke<number>("oauth_loopback_start");
  const redirectUri = `http://localhost:${port}`;
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildOneDriveAuthUrl({ clientId: opts.clientId, redirectUri, codeChallenge, state, scope: GRAPH_MAIL_SCOPES });
  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", { timeoutSecs: 180 });
  if (redirect.state !== state) throw new Error("OAuth state mismatch — aborted.");
  // microsoftAuthFetch, NOT the raw webview fetch: the token POST must carry no
  // Origin header (AADSTS90023 — maintainer finding 2026-07-20).
  const tokens = await exchangeOneDriveCode(
    { clientId: opts.clientId, code: redirect.code, codeVerifier, redirectUri, scope: GRAPH_MAIL_SCOPES },
    microsoftAuthFetch
  );
  if (!tokens.refreshToken) throw new Error("Microsoft returned no refresh_token — connect again.");
  return { refreshToken: tokens.refreshToken };
}

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
function buildRuntime(vaultPath: string, account: MailAccountConfig, initialRefreshToken: string): GraphMailRuntime {
  const clientId = account.clientId ?? "";
  let accessToken: string | null = null;
  let expiresAt = 0;
  let currentRefreshToken = initialRefreshToken;
  let inFlight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    const res = await refreshOneDriveAccessToken({ clientId, refreshToken: currentRefreshToken, scope: GRAPH_MAIL_SCOPES }, microsoftAuthFetch);
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
  if (!refreshToken) throw new Error("missing Microsoft mail credentials");
  const rt = buildRuntime(vaultPath, account, refreshToken);
  runtimes.set(account.id, rt);
  return rt;
}

/** Drops the cached runtime (token + folder map) when an account is removed. */
export function forgetGraphMailRuntime(accountId: string): void {
  runtimes.delete(accountId);
}

// ---- Request helper (JSON, with one 401 retry) ---------------------------

async function graphJson<T>(rt: GraphMailRuntime, method: string, path: string, body?: unknown): Promise<T> {
  const call = async (token: string): Promise<Response> =>
    httpFetch(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(path.includes("$search") || path.includes("$count") ? { ConsistencyLevel: "eventual" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let res = await call(await rt.getAccessToken());
  if (res.status === 401) res = await call(await rt.getAccessToken(true));
  if (!res.ok) throw new Error(`Graph mail ${method} ${path} failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
    `?$select=id,subject,from,receivedDateTime,isRead,flag&$orderby=receivedDateTime desc` +
    `&$top=${limit}&$skip=${offset}&$count=true`;
  const data = await graphJson<{ value: GraphMessageEnvelope[]; "@odata.count"?: number }>(rt, "GET", q);
  const messages = (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject ?? "",
    from: addressLabel(m.from),
    dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
    seen: m.isRead === true,
    flagged: m.flag?.flagStatus === "flagged",
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
  const res = await httpFetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}/$value`, {
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
    `?$search="${encodeURIComponent(query)}"&$select=id,subject,from,receivedDateTime,isRead,flag&$top=50`;
  const data = await graphJson<{ value: GraphMessageEnvelope[] }>(rt, "GET", q);
  return (data.value ?? [])
    .map((m) => ({
      id: m.id,
      subject: m.subject ?? "",
      from: addressLabel(m.from),
      dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
      seen: m.isRead === true,
      flagged: m.flag?.flagStatus === "flagged",
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
    `?$filter=flag/flagStatus eq 'flagged'&$select=id,subject,from,receivedDateTime,isRead,flag&$top=${Math.min(limit, 500)}`;
  const data = await graphJson<{ value: GraphMessageEnvelope[] }>(rt, "GET", q);
  return (data.value ?? [])
    .map((m) => ({
      id: m.id,
      subject: m.subject ?? "",
      from: addressLabel(m.from),
      dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
      seen: m.isRead === true,
      flagged: m.flag?.flagStatus === "flagged",
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
  bcc = ""
): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toRecipients(to),
  };
  if (cc.trim()) message.ccRecipients = toRecipients(cc);
  if (bcc.trim()) message.bccRecipients = toRecipients(bcc);
  if (attachments.length) message.attachments = graphAttachments(attachments);
  await graphJson(rt, "POST", "/me/sendMail", { message, saveToSentItems: true });
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
