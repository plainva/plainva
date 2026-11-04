import { checkMcpAddress, mcpOAuthProblem, type McpOAuthClientChoice, type McpOAuthHost, type McpOAuthProblem, type McpOAuthRedirect } from "./native.js";

/**
 * Signing in to a remote MCP server (plan §17.2, P4.5): what the web view
 * does of it. OAuth 2.1 with PKCE, as the protocol's authorization chapter
 * asks for — the server says where its sign-in lives (RFC 9728), that
 * authorization server says how it works (RFC 8414), and the token that
 * comes of it is made for this one server (RFC 8707).
 *
 * Nothing in this file touches a secret. It reads what a server answered,
 * decides which addresses to ask, and walks the steps; the verifier, the
 * exchange and the tokens are the native side's (`McpOAuthHost`), and the
 * rules that side keeps are written down once more in `oauthRules.ts`.
 */

/** What a server's `WWW-Authenticate` line says about signing in. */
export interface McpBearerChallenge {
  /** Where the server describes its sign-in. */
  resourceMetadata?: string;
  /** What the request would have needed. */
  scopes: string[];
  error?: string;
}

const CHALLENGE_LIMIT = 2000;
const MAX_SCOPES = 50;
/** A scope as RFC 6749 spells one: visible ASCII without the quote and the backslash. */
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]{1,200}$/;

/** The scopes of a space-separated list that are scopes, in order, each once. */
export function readMcpScopes(raw: unknown): string[] {
  const parts = typeof raw === "string" ? raw.split(" ") : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === "string" && SCOPE.test(part) && !out.includes(part) && out.length < MAX_SCOPES) out.push(part);
  }
  return out;
}

function challengeParam(text: string, name: string): string | undefined {
  const found = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^\\s,"]+))`, "i").exec(text);
  if (!found) return undefined;
  return found[1] !== undefined ? found[1].replace(/\\(.)/g, "$1") : found[2];
}

/**
 * Reads the `Bearer` challenge out of a `WWW-Authenticate` line; null where
 * there is none. The line is a stranger's text: everything taken from it is
 * cut, and an address in it is only ever a place to ASK, under the native
 * address rules.
 */
export function readMcpBearerChallenge(header: string | undefined): McpBearerChallenge | null {
  if (!header) return null;
  const text = header.slice(0, CHALLENGE_LIMIT);
  const start = /(?:^|,)\s*Bearer(?=\s|,|$)/i.exec(text);
  if (!start) return null;
  let rest = text.slice(start.index + start[0].length);
  // Another scheme after this one ("…, Basic realm=…"): its parameters are not this challenge's.
  const next = /,\s*[A-Za-z][\w-]*\s+[A-Za-z_][\w-]*\s*=/.exec(rest);
  if (next) rest = rest.slice(0, next.index);
  const resourceMetadata = challengeParam(rest, "resource_metadata");
  const error = challengeParam(rest, "error");
  return {
    ...(resourceMetadata && resourceMetadata.length <= 2048 ? { resourceMetadata } : {}),
    scopes: readMcpScopes(challengeParam(rest, "scope")),
    ...(error && /^[a-z_]{1,64}$/.test(error) ? { error } : {}),
  };
}

/** An address as a server may have one, with nothing after a `#`: the form of every address in this chapter. */
function address(raw: string): URL | null {
  if (raw.includes("#")) return null;
  const checked = checkMcpAddress(raw);
  return checked.ok ? new URL(checked.url) : null;
}

/** A path without the slashes at its end. */
export function mcpPathStem(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
  return path.slice(0, end);
}
const withoutSlashes = mcpPathStem;

/**
 * Where a server's description of its sign-in may be found, in the order to
 * try: the address the server named itself, then the well-known place for
 * its path, then the one for its host (RFC 9728 §3.1).
 */
export function mcpResourceMetadataUrls(serverUrl: string, hint?: string): string[] {
  const server = address(serverUrl.split("#")[0]!);
  if (!server) return [];
  const out: string[] = [];
  const add = (url: string | undefined) => {
    if (url && !out.includes(url)) out.push(url);
  };
  if (hint) add(address(hint)?.toString());
  const path = withoutSlashes(server.pathname);
  if (path) add(`${server.origin}/.well-known/oauth-protected-resource${path}${server.search}`);
  add(`${server.origin}/.well-known/oauth-protected-resource`);
  return out;
}

/**
 * Does what a server names as itself cover its address? The same scheme,
 * host and port, and a path that is the address's own or a part of it that
 * ends where a segment ends — `https://mcp.example.com` and
 * `https://mcp.example.com/mcp` both cover `https://mcp.example.com/mcp/v1`,
 * `https://mcp.example.com/mc` does not. A token is asked for exactly this
 * name, so a server cannot have one made out to somebody else.
 */
export function mcpResourceCovers(resource: string, serverUrl: string): boolean {
  const named = address(resource);
  const server = address(serverUrl.split("#")[0]!);
  if (!named || !server || named.search) return false;
  if (named.protocol !== server.protocol || named.host !== server.host) return false;
  const part = withoutSlashes(named.pathname);
  const whole = withoutSlashes(server.pathname);
  return whole === part || whole.startsWith(`${part}/`);
}

/** A server's address as the name a token is made out to, where the server names none itself. */
export function mcpResourceOf(serverUrl: string): string | null {
  const server = address(serverUrl.split("#")[0]!);
  return server ? `${server.origin}${withoutSlashes(server.pathname)}` : null;
}

/** An authorization server's name: an address without a query and without anything after a `#` (RFC 8414 §2). */
function issuerUrl(issuer: string): URL | null {
  const url = address(issuer);
  return url && !url.search && !issuer.includes("?") ? url : null;
}

/**
 * Where an authorization server's own metadata may be found, in the order to
 * try (RFC 8414 §3 and OpenID Connect Discovery, as the protocol lists them).
 * Every one of them is on the issuer's own origin — the native side asks no
 * other.
 */
export function mcpIssuerMetadataUrls(issuer: string): string[] {
  const url = issuerUrl(issuer);
  if (!url) return [];
  const path = withoutSlashes(url.pathname);
  return path
    ? [`${url.origin}/.well-known/oauth-authorization-server${path}`, `${url.origin}/.well-known/openid-configuration${path}`, `${url.origin}${path}/.well-known/openid-configuration`]
    : [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
}

/** A server's description of its sign-in, as far as a client needs it. */
export interface McpProtectedResource {
  /** What the server names as itself; a token is asked for this. */
  resource: string;
  /** The authorization servers it accepts tokens of. */
  issuers: string[];
  scopes: string[];
}

export type McpResourceProblem = "not-json" | "resource" | "no-issuer";

const MAX_ISSUERS = 5;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a server's description of its sign-in. It is only used when it is
 * about this server: a document that names another resource is somebody
 * else's (RFC 9728 §3.3), whoever served it.
 */
export function readMcpProtectedResource(body: string, serverUrl: string): { ok: true; value: McpProtectedResource } | { ok: false; problem: McpResourceProblem } {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    return { ok: false, problem: "not-json" };
  }
  if (!isRecord(raw)) return { ok: false, problem: "not-json" };
  if (typeof raw.resource !== "string" || !mcpResourceCovers(raw.resource, serverUrl)) return { ok: false, problem: "resource" };
  const issuers: string[] = [];
  for (const entry of Array.isArray(raw.authorization_servers) ? raw.authorization_servers : []) {
    if (typeof entry === "string" && issuerUrl(entry) && !issuers.includes(entry) && issuers.length < MAX_ISSUERS) issuers.push(entry);
  }
  if (issuers.length === 0) return { ok: false, problem: "no-issuer" };
  return { ok: true, value: { resource: raw.resource, issuers, scopes: readMcpScopes(raw.scopes_supported) } };
}

/**
 * The scopes a sign-in asks for: what the server said the refused request
 * needed, else what its description offers, else none — never more than was
 * named.
 */
export function mcpSignInScopes(challenge: McpBearerChallenge | null, resource: McpProtectedResource | null): string[] {
  if (challenge && challenge.scopes.length > 0) return challenge.scopes;
  return resource?.scopes ?? [];
}

/** The browser, and the way back from it — each shell's own. */
export interface McpOAuthBrowser {
  /** Gets ready for the way back, and says what the native side needs to name it: a port on a computer, nothing on a phone. */
  prepare(): Promise<{ redirectPort?: number }>;
  open(url: string): Promise<void>;
  /** What the browser came back with. Rejects when the wait was called off or nothing came. */
  wait(signal?: AbortSignal): Promise<McpOAuthRedirect>;
}

/** A sign-in that can be made, as the user is told about it before a browser opens. */
export interface McpSignInPlan {
  issuer: string;
  /** The host the browser will show. */
  host: string;
  scopes: string[];
  resource: string;
  /** Who Plainva will be to this authorization server; "manual" needs an id from the user first. */
  client: McpOAuthClientChoice["kind"];
}

export type McpSignInProblem =
  /** The server names no place to sign in. */
  | "not-offered"
  | "unreachable"
  /** A sign-in Plainva does not do: no PKCE, endpoints it may not use, an authorization server that is not who the server named. */
  | "unsupported"
  /** The authorization server did not take Plainva as a client. */
  | "client"
  /** The user said no in the browser. */
  | "declined"
  | "cancelled"
  | "failed";

const UNSUPPORTED: ReadonlySet<McpOAuthProblem> = new Set(["oauth-issuer", "oauth-no-pkce", "oauth-endpoints", "oauth-address", "oauth-resource"]);

export function mcpSignInProblem(error: unknown): McpSignInProblem {
  const word = mcpOAuthProblem(error);
  if (word === "oauth-unreachable") return "unreachable";
  if (word === "oauth-denied") return "declined";
  if (word === "oauth-client" || word === "oauth-registration") return "client";
  if (word === "oauth-no-flow") return "cancelled";
  return UNSUPPORTED.has(word) ? "unsupported" : "failed";
}

export interface McpSignInTarget {
  id: string;
  url: string;
}

/**
 * Finds out how to sign in to a server: where it says its sign-in lives, and
 * what that authorization server offers. `challenge` is the line the server
 * refused a request with, where there was one; `documentUrl` is the address
 * of Plainva's own description as a client, where the app has one.
 *
 * A server that describes nothing is asked the way servers of an earlier
 * revision worked: its own origin is the authorization server.
 */
export async function planMcpSignIn(
  oauth: McpOAuthHost,
  server: McpSignInTarget,
  challenge: string | undefined,
  documentUrl: string | null,
): Promise<{ ok: true; plan: McpSignInPlan } | { ok: false; problem: McpSignInProblem }> {
  const said = readMcpBearerChallenge(challenge);
  let described: McpProtectedResource | null = null;
  let reached = false;
  for (const url of mcpResourceMetadataUrls(server.url, said?.resourceMetadata)) {
    let answer: { status: number; body: string };
    try {
      answer = await oauth.document(server.id, url);
    } catch {
      continue;
    }
    reached = true;
    if (answer.status !== 200) continue;
    const read = readMcpProtectedResource(answer.body, server.url);
    if (read.ok) {
      described = read.value;
      break;
    }
  }
  const fallback = mcpResourceOf(server.url);
  const origin = address(server.url.split("#")[0]!)?.origin;
  const resource = described?.resource ?? fallback;
  const issuers = described?.issuers ?? (origin ? [origin] : []);
  if (!resource || issuers.length === 0) return { ok: false, problem: "not-offered" };

  let unreachable = false;
  let unsupported = false;
  for (const issuer of issuers) {
    for (const url of mcpIssuerMetadataUrls(issuer)) {
      try {
        const found = await oauth.issuer(server.id, issuer, url);
        const kept = await oauth.status(server.id).catch(() => null);
        const client: McpOAuthClientChoice["kind"] =
          kept && kept.client && kept.issuer === found.issuer ? "stored" : found.document && documentUrl ? "document" : found.dynamic ? "dynamic" : "manual";
        return { ok: true, plan: { issuer: found.issuer, host: new URL(found.issuer).host, scopes: mcpSignInScopes(said, described), resource, client } };
      } catch (error) {
        const word = mcpOAuthProblem(error);
        // No document at this address: the next one may have it.
        if (word === "oauth-no-metadata") continue;
        if (word === "oauth-unreachable") {
          unreachable = true;
          continue;
        }
        // Anything else is this authorization server's answer, and it is one Plainva does not sign in with.
        unsupported = true;
        break;
      }
    }
  }
  if (unsupported) return { ok: false, problem: "unsupported" };
  if (unreachable) return { ok: false, problem: "unreachable" };
  // A server that names an authorization server nobody can find describes a sign-in that cannot be made;
  // one that describes nothing and has none at its own origin offers none.
  return { ok: false, problem: described ? "unsupported" : reached ? "not-offered" : "unreachable" };
}

export interface McpSignInOptions {
  /** The name a registration carries. */
  clientName: string;
  documentUrl: string | null;
  /** The id the user got from the server's operator, where the plan needs one. */
  clientId?: string;
  signal?: AbortSignal;
}

/**
 * Makes the sign-in: the native side begins it, the browser shows it, and
 * the native side ends it with what the browser came back with. Nothing of
 * what makes a token passes through here.
 */
export async function runMcpSignIn(
  oauth: McpOAuthHost,
  browser: McpOAuthBrowser,
  serverId: string,
  plan: McpSignInPlan,
  options: McpSignInOptions,
): Promise<{ ok: true } | { ok: false; problem: McpSignInProblem }> {
  let client: McpOAuthClientChoice;
  if (plan.client === "document") {
    if (!options.documentUrl) return { ok: false, problem: "client" };
    client = { kind: "document", id: options.documentUrl };
  } else if (plan.client === "manual") {
    const id = options.clientId?.trim() ?? "";
    if (!id) return { ok: false, problem: "client" };
    client = { kind: "manual", id };
  } else {
    client = { kind: plan.client };
  }
  if (options.signal?.aborted) return { ok: false, problem: "cancelled" };
  let redirect: McpOAuthRedirect;
  try {
    const ready = await browser.prepare();
    const url = await oauth.begin(serverId, {
      issuer: plan.issuer,
      scopes: plan.scopes,
      resource: plan.resource,
      client,
      clientName: options.clientName,
      ...(ready.redirectPort !== undefined ? { redirectPort: ready.redirectPort } : {}),
    });
    await browser.open(url);
  } catch (error) {
    await oauth.cancel().catch(() => undefined);
    return { ok: false, problem: mcpSignInProblem(error) };
  }
  try {
    redirect = await browser.wait(options.signal);
  } catch {
    await oauth.cancel().catch(() => undefined);
    return { ok: false, problem: "cancelled" };
  }
  try {
    const signedIn = await oauth.finish(redirect);
    return signedIn === serverId ? { ok: true } : { ok: false, problem: "failed" };
  } catch (error) {
    // An answer of somebody else than who was asked is no kind of sign-in Plainva "does not do": it failed.
    return { ok: false, problem: mcpOAuthProblem(error) === "oauth-issuer" ? "failed" : mcpSignInProblem(error) };
  }
}
