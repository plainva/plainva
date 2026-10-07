import { sha256Bytes, toBase64, utf8Encode } from "../../workspace/encoding.js";
import { checkWebUrl } from "../web/rules.js";
import { checkMcpAddress, type McpOAuthIssuer, type McpOAuthProblem, type McpOAuthRedirect } from "./native.js";
import { mcpResourceCovers, readMcpScopes } from "./oauth.js";

/**
 * The rules the native side of a sign-in keeps (plan §17.2, P4.5), written
 * down once in TypeScript. `src-tauri/src/mcp_client/oauth.rs`, Android's
 * `AiMcpOAuthRules` and iOS's `AiMcpOAuthRules` decide the same, and all four
 * run the lists of `oauthRules.test.ts`: a case added there is added in each.
 *
 * Nothing here runs in the app — the web view is not where these decisions
 * are made. It is the reference the three native sides are checked against,
 * and the scripted native side of the tests (`scriptedOAuth.ts`) is built
 * from it, so what the session tests of both shells sign in to behaves like
 * the real thing.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The address of Plainva's own description as a client (a Client ID Metadata
 * Document): an authorization server that takes such an address as a client
 * id reads from it who asks and which ways back are Plainva's. The document
 * is part of the website (`public/oauth/client.json` there); what it lists is
 * pinned in `oauthRules.test.ts`.
 */
export const MCP_OAUTH_CLIENT_DOCUMENT = "https://plainva.com/oauth/client.json";
/** The preferred port for the way back on a computer: authorization servers that compare addresses literally know it from Plainva's description. */
export const MCP_OAUTH_LOOPBACK_PORT = 43117;
/** The ways back that Plainva's description lists: the port above, any port (RFC 8252 §7.3), and the two apps' own addresses. */
export const MCP_OAUTH_REDIRECT_URIS: readonly string[] = [
  `http://127.0.0.1:${MCP_OAUTH_LOOPBACK_PORT}/callback`,
  "http://127.0.0.1/callback",
  "com.plainva.app://mcp/oauth",
  "com.plainva.app.labs://mcp/oauth",
];

/** Plainva's description as a client, as the website serves it. */
export function mcpClientDocument(): Record<string, unknown> {
  return {
    client_id: MCP_OAUTH_CLIENT_DOCUMENT,
    client_name: "Plainva",
    client_uri: "https://plainva.com",
    logo_uri: "https://plainva.com/plainva.png",
    redirect_uris: [...MCP_OAUTH_REDIRECT_URIS],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  };
}
/** The longest a begun sign-in waits for its browser. */
export const MCP_OAUTH_PENDING_MS = 10 * 60_000;
/** A token is visible ASCII without a space, and no longer than this. */
export const MCP_OAUTH_TOKEN_MAX = 16_384;
const TOKEN = /^[\x21-\x7e]+$/;

/**
 * An address a server names for its sign-in — a document, an endpoint — as
 * it may be asked, or null. On the server's own host it follows the rules
 * the server's address followed when the user confirmed it (https, or http
 * to this device); everywhere else it is a public https address on the
 * default port, like a page the assistant reads. Nothing after a `#`.
 */
export function mcpOAuthAddress(raw: string, serverUrl: string): string | null {
  if (raw.includes("#")) return null;
  const own = checkMcpAddress(serverUrl);
  const named = checkMcpAddress(raw);
  if (!own.ok || !named.ok) return null;
  if (new URL(named.url).hostname === new URL(own.url).hostname) return named.url;
  const web = checkWebUrl(raw);
  return web.ok ? web.target.url : null;
}

/**
 * May an authorization server's metadata be read from this address? Only
 * from its own origin, under `/.well-known/` — where nobody but the one who
 * runs that origin puts a document. That, and the `issuer` inside, ties the
 * endpoints to the name.
 */
export function mcpIssuerDocumentUrlOk(issuer: string, url: string): boolean {
  if (issuer.includes("#") || issuer.includes("?")) return false;
  const named = checkMcpAddress(issuer);
  const asked = checkMcpAddress(url);
  if (!named.ok || !asked.ok || url.includes("#")) return false;
  const at = new URL(asked.url);
  return at.origin === new URL(named.url).origin && at.pathname.includes("/.well-known/");
}

/** An authorization server as the native side keeps it for a sign-in. */
export interface McpIssuerEndpoints {
  issuer: string;
  authorization: string;
  token: string;
  registration: string | null;
  document: boolean;
  iss: boolean;
  scopes: string[];
}

export type McpIssuerDocumentProblem = Extract<McpOAuthProblem, "oauth-no-metadata" | "oauth-issuer" | "oauth-no-pkce" | "oauth-endpoints">;

/**
 * Reads an authorization server's metadata (RFC 8414). It counts only when
 * it names the issuer it was asked as, letter for letter; its endpoints are
 * addresses under the rule above; and it says it does PKCE with SHA-256 — a
 * server that does not say so is not signed in with.
 */
export function readMcpIssuerDocument(body: string, issuer: string, serverUrl: string): { ok: true; value: McpIssuerEndpoints } | { ok: false; problem: McpIssuerDocumentProblem } {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    return { ok: false, problem: "oauth-no-metadata" };
  }
  if (!isRecord(raw)) return { ok: false, problem: "oauth-no-metadata" };
  if (raw.issuer !== issuer) return { ok: false, problem: "oauth-issuer" };
  const endpoint = (value: unknown): string | null => (typeof value === "string" ? mcpOAuthAddress(value, serverUrl) : null);
  const authorization = endpoint(raw.authorization_endpoint);
  const token = endpoint(raw.token_endpoint);
  if (!authorization || !token) return { ok: false, problem: "oauth-endpoints" };
  if (Array.isArray(raw.response_types_supported) && !raw.response_types_supported.includes("code")) return { ok: false, problem: "oauth-endpoints" };
  if (!Array.isArray(raw.code_challenge_methods_supported) || !raw.code_challenge_methods_supported.includes("S256")) return { ok: false, problem: "oauth-no-pkce" };
  return {
    ok: true,
    value: {
      issuer,
      authorization,
      token,
      registration: endpoint(raw.registration_endpoint),
      document: raw.client_id_metadata_document_supported === true,
      iss: raw.authorization_response_iss_parameter_supported === true,
      scopes: readMcpScopes(raw.scopes_supported),
    },
  };
}

/** What the web view is told about an authorization server: what it offers, not where its endpoints are. */
export function mcpIssuerInfo(endpoints: McpIssuerEndpoints): McpOAuthIssuer {
  return { issuer: endpoints.issuer, document: endpoints.document, dynamic: endpoints.registration !== null, iss: endpoints.iss, scopes: endpoints.scopes };
}

/** The name a token is made out to, as the native side accepts it: one that covers the registered address. */
export function mcpOAuthResource(resource: string, serverUrl: string): string | null {
  return mcpResourceCovers(resource, serverUrl) ? resource : null;
}

/** Where the browser comes back to: a port on this computer, or the app's own address on a phone. */
export function mcpOAuthRedirectUri(way: { port: number } | { appId: string }): string | null {
  if ("port" in way) return Number.isInteger(way.port) && way.port >= 1024 && way.port <= 65535 ? `http://127.0.0.1:${way.port}/callback` : null;
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(way.appId) ? `${way.appId}://mcp/oauth` : null;
}

/**
 * A client id: printable ASCII, at most 512 characters. Where it is the
 * address of Plainva's own description, it is a public https address with a
 * path (the form such an id must have).
 */
export function mcpOAuthClientId(kind: "document" | "manual", id: string): string | null {
  const text = id.trim();
  if (!text || text.length > 512 || !/^[\x20-\x7e]+$/.test(text)) return null;
  if (kind === "manual") return text;
  const web = checkWebUrl(text);
  return web.ok && !text.includes("#") && new URL(web.target.url).pathname !== "/" ? text : null;
}

export interface McpAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  /** The PKCE challenge: the SHA-256 of the verifier, base64url without padding. */
  challenge: string;
  state: string;
  scopes: readonly string[];
  resource: string;
}

/** The address the browser is sent to. What the endpoint already carries in its query stays. */
export function mcpAuthorizationUrl(endpoint: string, request: McpAuthorizationRequest): string {
  const url = new URL(endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("code_challenge", request.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", request.state);
  url.searchParams.set("resource", request.resource);
  if (request.scopes.length > 0) url.searchParams.set("scope", request.scopes.join(" "));
  return url.toString();
}

function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** The challenge of a verifier (RFC 7636 §4.2). */
export function mcpPkceChallenge(verifier: string): string {
  return base64Url(sha256Bytes(utf8Encode(verifier)));
}

/** A fresh secret of `bytes` random bytes, base64url: a verifier (32) or a state (16). */
export function mcpOAuthRandom(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export interface McpOAuthPending {
  state: string;
  issuer: string;
  /** The authorization server said it names itself on the way back. */
  iss: boolean;
}

export type McpRedirectProblem = Extract<McpOAuthProblem, "oauth-no-flow" | "oauth-issuer" | "oauth-denied" | "oauth-failed">;

/**
 * What the browser came back with, against what was begun. The state must
 * be the one that was sent; who answered must be who was asked (RFC 9207) —
 * a name that differs, or one that is missing where it was promised, ends
 * the sign-in before anything of the answer is used, an error text included.
 */
export function checkMcpOAuthRedirect(pending: McpOAuthPending | null, redirect: McpOAuthRedirect): { ok: true; code: string } | { ok: false; problem: McpRedirectProblem } {
  if (!pending || !redirect.state || redirect.state !== pending.state) return { ok: false, problem: "oauth-no-flow" };
  if (redirect.iss !== undefined ? redirect.iss !== pending.issuer : pending.iss) return { ok: false, problem: "oauth-issuer" };
  if (redirect.error !== undefined) return { ok: false, problem: redirect.error === "access_denied" ? "oauth-denied" : "oauth-failed" };
  if (!redirect.code) return { ok: false, problem: "oauth-failed" };
  return { ok: true, code: redirect.code };
}

/** How a client proves who it is at the token endpoint: not at all (a public client), or with a secret a registration handed out. */
export type McpClientAuth = "none" | "post" | "basic";

export interface McpOAuthClient {
  id: string;
  auth: McpClientAuth;
  secret: string | null;
}

/** The fields of a token request, in order. A secret travels in the body only where the registration said so. */
export function mcpTokenForm(
  grant: { kind: "code"; code: string; verifier: string; redirectUri: string } | { kind: "refresh"; token: string },
  client: McpOAuthClient,
  resource: string,
): [string, string][] {
  const fields: [string, string][] =
    grant.kind === "code"
      ? [
          ["grant_type", "authorization_code"],
          ["code", grant.code],
          ["redirect_uri", grant.redirectUri],
          ["code_verifier", grant.verifier],
        ]
      : [
          ["grant_type", "refresh_token"],
          ["refresh_token", grant.token],
        ];
  fields.push(["client_id", client.id], ["resource", resource]);
  if (client.auth === "post" && client.secret) fields.push(["client_secret", client.secret]);
  return fields;
}

export interface McpOAuthTokens {
  access: string;
  refresh: string | null;
  /** Seconds from now; null where the server did not say. */
  expiresIn: number | null;
  /** Null where the server did not say: then what was asked for was granted. */
  scopes: string[] | null;
}

const okToken = (value: unknown): value is string => typeof value === "string" && value.length <= MCP_OAUTH_TOKEN_MAX && TOKEN.test(value);

/**
 * Reads a token endpoint's answer. Only a bearer token is one; a refresh
 * token that was refused for good (`invalid_grant`) says so, so that the
 * sign-in is forgotten and asked for again.
 */
export function readMcpTokenResponse(status: number, body: string): { ok: true; value: McpOAuthTokens } | { ok: false; problem: Extract<McpOAuthProblem, "oauth-token" | "oauth-grant"> } {
  let raw: unknown = null;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    // Left as null: no answer of a token endpoint.
  }
  if (!isRecord(raw)) return { ok: false, problem: "oauth-token" };
  if (status !== 200) return { ok: false, problem: status === 400 && raw.error === "invalid_grant" ? "oauth-grant" : "oauth-token" };
  if (typeof raw.token_type !== "string" || raw.token_type.toLowerCase() !== "bearer" || !okToken(raw.access_token)) return { ok: false, problem: "oauth-token" };
  if (raw.refresh_token !== undefined && raw.refresh_token !== null && !okToken(raw.refresh_token)) return { ok: false, problem: "oauth-token" };
  const seconds = typeof raw.expires_in === "number" && Number.isFinite(raw.expires_in) && raw.expires_in >= 1 ? Math.min(Math.floor(raw.expires_in), 10 * 365 * 24 * 3600) : null;
  return {
    ok: true,
    value: {
      access: raw.access_token,
      refresh: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
      expiresIn: seconds,
      scopes: typeof raw.scope === "string" ? readMcpScopes(raw.scope) : null,
    },
  };
}

/** What a client that registers itself says about itself (RFC 7591): a native app, without a secret. */
export function mcpRegistrationBody(clientName: string, redirectUri: string): Record<string, unknown> {
  return {
    client_name: clientName.slice(0, 80),
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  };
}

/** Reads a registration's answer: the id, and a secret where the server insists on one. */
export function readMcpRegistration(status: number, body: string): McpOAuthClient | null {
  let raw: unknown = null;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    // Left as null.
  }
  if ((status !== 200 && status !== 201) || !isRecord(raw)) return null;
  const id = typeof raw.client_id === "string" ? mcpOAuthClientId("manual", raw.client_id) : null;
  if (!id) return null;
  const secret = raw.client_secret === undefined || raw.client_secret === null ? null : okToken(raw.client_secret) ? raw.client_secret : undefined;
  if (secret === undefined) return null;
  const method: unknown = raw.token_endpoint_auth_method ?? undefined;
  if (secret === null) return method === undefined || method === "none" ? { id, auth: "none", secret: null } : null;
  if (method === "client_secret_post") return { id, auth: "post", secret };
  // The default of a client with a secret (RFC 7591 §2).
  if (method === undefined || method === "client_secret_basic") return { id, auth: "basic", secret };
  // A secret that came with "none" is not used: the client stays a public one.
  return method === "none" ? { id, auth: "none", secret: null } : null;
}
