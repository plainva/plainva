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
import type { MailboxInfo, MailEnvelopePage, MailMessage, MailAttachmentInfo } from "./mailClient";
import type { MailAttachment } from "./mailOut";

/**
 * Microsoft Graph mail backend (direct login, no app password / IMAP / SMTP).
 * Reuses the OneDrive PKCE cores and the OAuth loopback listener 1:1 — only the
 * SCOPES differ (delegated Mail.ReadWrite + Mail.Send on the SAME central Entra
 * app as the OneDrive sync). Everything runs over the Tauri http bridge; there
 * is no Rust for Microsoft mail. Message ids are opaque Graph strings; folders
 * are addressed by their displayName (mapped to the Graph id per account).
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
  const tokens = await exchangeOneDriveCode(
    { clientId: opts.clientId, code: redirect.code, codeVerifier, redirectUri, scope: GRAPH_MAIL_SCOPES },
    httpFetch
  );
  if (!tokens.refreshToken) throw new Error("Microsoft returned no refresh_token — connect again.");
  return { refreshToken: tokens.refreshToken };
}

// ---- Per-account runtime (token cache + folder id map) -------------------

interface GraphMailRuntime {
  getAccessToken(force?: boolean): Promise<string>;
  /** Cached displayName -> Graph folder id (populated by listFolders). */
  folderIds: Map<string, string>;
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
    const res = await refreshOneDriveAccessToken({ clientId, refreshToken: currentRefreshToken, scope: GRAPH_MAIL_SCOPES }, httpFetch);
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

async function resolveFolderId(rt: GraphMailRuntime, displayName: string): Promise<string> {
  if (rt.folderIds.has(displayName)) return rt.folderIds.get(displayName) as string;
  await listFoldersInternal(rt); // populate the map
  const id = rt.folderIds.get(displayName);
  if (!id) throw new Error(`Graph mail folder not found: ${displayName}`);
  return id;
}

interface GraphFolder {
  id: string;
  displayName: string;
}

async function listFoldersInternal(rt: GraphMailRuntime): Promise<GraphFolder[]> {
  const data = await graphJson<{ value: GraphFolder[] }>(rt, "GET", "/me/mailFolders?$select=id,displayName&$top=100");
  const folders = data.value ?? [];
  rt.folderIds.clear();
  for (const f of folders) rt.folderIds.set(f.displayName, f.id);
  return folders;
}

// ---- Public backend (matches the mailClient function shapes) -------------

export async function graphListFolders(vaultPath: string, account: MailAccountConfig): Promise<MailboxInfo[]> {
  const rt = await runtimeFor(vaultPath, account);
  const folders = await listFoldersInternal(rt);
  return folders.map((f) => ({ name: f.displayName }));
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
    `?$select=id,subject,from,receivedDateTime,isRead&$orderby=receivedDateTime desc` +
    `&$top=${limit}&$skip=${offset}&$count=true`;
  const data = await graphJson<{ value: GraphMessageEnvelope[]; "@odata.count"?: number }>(rt, "GET", q);
  const messages = (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject ?? "",
    from: addressLabel(m.from),
    dateTs: m.receivedDateTime ? Date.parse(m.receivedDateTime) : 0,
    seen: m.isRead === true,
  }));
  return { total: data["@odata.count"] ?? messages.length + offset, messages };
}

interface GraphMessageFull {
  id: string;
  subject?: string;
  from?: GraphMessageEnvelope["from"];
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
}

export async function graphFetchMessage(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string): Promise<MailMessage> {
  const rt = await runtimeFor(vaultPath, account);
  const m = await graphJson<GraphMessageFull>(
    rt,
    "GET",
    `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,receivedDateTime,body,hasAttachments`
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

export async function graphMove(vaultPath: string, account: MailAccountConfig, _mailbox: string, id: string, targetDisplayName: string): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const destinationId = await resolveFolderId(rt, targetDisplayName);
  await graphJson(rt, "POST", `/me/messages/${encodeURIComponent(id)}/move`, { destinationId });
}

export async function graphSearch(vaultPath: string, account: MailAccountConfig, mailbox: string, query: string): Promise<string[]> {
  const rt = await runtimeFor(vaultPath, account);
  const folderId = await resolveFolderId(rt, mailbox);
  const q = `/me/mailFolders/${encodeURIComponent(folderId)}/messages?$search="${encodeURIComponent(query)}"&$select=id&$top=50`;
  const data = await graphJson<{ value: Array<{ id: string }> }>(rt, "GET", q);
  return (data.value ?? []).map((m) => m.id);
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
  attachments: MailAttachment[] = []
): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toRecipients(to),
  };
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
  attachments: MailAttachment[] = []
): Promise<void> {
  const rt = await runtimeFor(vaultPath, account);
  const body: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toRecipients(to),
  };
  if (attachments.length) body.attachments = graphAttachments(attachments);
  await graphJson(rt, "POST", "/me/messages", body);
}
