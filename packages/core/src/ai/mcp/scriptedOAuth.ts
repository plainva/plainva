import type { McpOAuthHost, McpOAuthProblem, McpOAuthRedirect } from "./native.js";
import { mcpPathStem, type McpOAuthBrowser } from "./oauth.js";
import {
  checkMcpOAuthRedirect,
  mcpAuthorizationUrl,
  mcpIssuerDocumentUrlOk,
  mcpIssuerInfo,
  mcpOAuthAddress,
  mcpOAuthClientId,
  mcpOAuthRandom,
  mcpOAuthRedirectUri,
  mcpOAuthResource,
  mcpPkceChallenge,
  mcpRegistrationBody,
  mcpTokenForm,
  readMcpIssuerDocument,
  readMcpRegistration,
  readMcpTokenResponse,
  MCP_OAUTH_LOOPBACK_PORT,
  type McpIssuerEndpoints,
  type McpOAuthClient,
} from "./oauthRules.js";

/**
 * A sign-in in a script — the other end of `oauth.ts`, for tests in every
 * package: an authorization server that hands out codes and tokens and
 * checks what a real one checks (the client, the way back, the PKCE
 * verifier, who the token is for), a browser with a user in it, and the
 * NATIVE side of the app between them.
 *
 * That native side is built from `oauthRules.ts`, the reference the three
 * real ones are checked against. It holds what they hold — the verifier, the
 * tokens — and hands out what they hand out, so a test that reads a token
 * from the web view's side of this file is a test that found a hole.
 */

export interface ScriptedOAuthOptions {
  /** The MCP server's registered address. */
  serverUrl: string;
  issuer?: string;
  /**
   * What the server's description of its sign-in says. Null: it describes
   * nothing, as a server of an earlier revision — its own origin is the
   * authorization server then.
   */
  described?: { resource?: string; scopes?: string[]; issuers?: string[] } | null;
  /** The metadata names PKCE with SHA-256. */
  pkce?: boolean;
  /** It takes the address of a client's description as its id. */
  document?: boolean;
  /** It lets clients register: as public ones, or with a secret it insists on. */
  dynamic?: boolean | "secret-post" | "secret-basic";
  /** It names itself on the way back (RFC 9207). */
  iss?: boolean;
  scopes?: string[];
  /** It hands out a token to get the next one with. */
  refresh?: boolean;
  /** Client ids it knows without a registration. */
  clients?: string[];
  /** The way back of a phone: the app's own address. Left out: a port on this computer. */
  appId?: string;
  /** The time, in milliseconds. */
  now?: () => number;
}

export interface ScriptedOAuth {
  /** The native side of the app. */
  host: McpOAuthHost;
  browser: McpOAuthBrowser;
  /** What the user does in the browser: allow, deny, close it without a word — or come back with something of their own. */
  consent: "allow" | "deny" | "never" | ((asked: URL) => McpOAuthRedirect);
  /** Nothing answers: no document, no token endpoint. */
  offline: boolean;
  /** The documents that are served, by address; change one to script a server that lies. */
  readonly documents: Map<string, { status: number; body: string }>;
  /** Every address a document was asked at, in order. */
  readonly asked: string[];
  /** Every address a browser was opened at. */
  readonly opened: string[];
  readonly registrations: Record<string, unknown>[];
  /** Every token request, as its fields. */
  readonly tokenRequests: Record<string, string>[];
  /** What the native side would put into a request to this server; the web view has no way to ask. */
  bearer(serverId: string): string | undefined;
  /** Whether the MCP server takes this credential now. */
  accepts(token: string | undefined): boolean;
  /** The access token stops being taken; the one for the next still works. */
  expire(): void;
  /** The token for the next stops being taken as well: only a new sign-in helps. */
  revoke(): void;
}

interface Link {
  issuer: string;
  token: string;
  client: McpOAuthClient;
  kind: "document" | "dynamic" | "manual";
  redirectUri: string;
  resource: string;
  scopes: string[];
  access: string | null;
  refresh: string | null;
  expiresAt: number | null;
}

interface Pending {
  serverId: string;
  endpoints: McpIssuerEndpoints;
  client: McpOAuthClient;
  kind: Link["kind"];
  verifier: string;
  state: string;
  redirectUri: string;
  scopes: string[];
  resource: string;
}

interface Grant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  scopes: string[];
}

const fail = (word: McpOAuthProblem): never => {
  throw new Error(word);
};

export function scriptedMcpOAuth(options: ScriptedOAuthOptions): ScriptedOAuth {
  const server = new URL(options.serverUrl);
  const described = options.described === undefined ? {} : options.described;
  const issuer = options.issuer ?? (described === null ? server.origin : "https://auth.example.com");
  const now = options.now ?? (() => Date.now());
  const issuerUrl = new URL(issuer);
  const issuerPath = mcpPathStem(issuerUrl.pathname);
  const endpoint = (name: string) => `${issuerUrl.origin}${issuerPath}/${name}`;

  const documents = new Map<string, { status: number; body: string }>();
  const json = (value: unknown) => ({ status: 200, body: JSON.stringify(value) });
  if (described !== null) {
    const path = mcpPathStem(server.pathname);
    documents.set(
      `${server.origin}/.well-known/oauth-protected-resource${path}`,
      json({
        resource: described.resource ?? `${server.origin}${path}`,
        authorization_servers: described.issuers ?? [issuer],
        ...(described.scopes ? { scopes_supported: described.scopes } : {}),
      }),
    );
  }
  documents.set(
    issuerPath ? `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerPath}` : `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
    json({
      issuer,
      authorization_endpoint: endpoint("authorize"),
      token_endpoint: endpoint("token"),
      response_types_supported: ["code"],
      ...(options.pkce === false ? {} : { code_challenge_methods_supported: ["S256"] }),
      ...(options.dynamic ? { registration_endpoint: endpoint("register") } : {}),
      ...(options.document ? { client_id_metadata_document_supported: true } : {}),
      ...(options.iss ? { authorization_response_iss_parameter_supported: true } : {}),
      ...(options.scopes ? { scopes_supported: options.scopes } : {}),
    }),
  );

  // --- the authorization server
  const clients = new Map<string, McpOAuthClient>((options.clients ?? []).map((id): [string, McpOAuthClient] => [id, { id, auth: "none", secret: null }]));
  const grants = new Map<string, Grant>();
  const refreshes = new Map<string, Grant>();
  let issued = 0;
  let accepted: string | undefined;

  const answerToken = (grant: Grant): { status: number; body: string } => {
    issued++;
    accepted = `at-${issued}`;
    const refresh = options.refresh === false ? undefined : `rt-${issued}`;
    if (refresh) refreshes.set(refresh, grant);
    return json({ access_token: accepted, token_type: "Bearer", expires_in: 3600, ...(refresh ? { refresh_token: refresh } : {}), ...(grant.scopes.length ? { scope: grant.scopes.join(" ") } : {}) });
  };
  const refuse = (error: string) => ({ status: 400, body: JSON.stringify({ error }) });

  const token = (fields: [string, string][], client: McpOAuthClient): { status: number; body: string } => {
    const form = Object.fromEntries(fields);
    oauth.tokenRequests.push(form);
    const known = clients.get(form.client_id ?? "");
    if (known?.secret) {
      // A client with a secret proves it the way it was registered: in the body, or as the request's own credential.
      const proven = known.auth === "post" ? form.client_secret === known.secret : client.auth === "basic" && client.secret === known.secret && form.client_secret === undefined;
      if (!proven) return { status: 401, body: JSON.stringify({ error: "invalid_client" }) };
    }
    if (form.grant_type === "authorization_code") {
      const grant = grants.get(form.code ?? "");
      grants.delete(form.code ?? "");
      if (!grant || grant.clientId !== form.client_id || grant.redirectUri !== form.redirect_uri || grant.resource !== form.resource) return refuse("invalid_grant");
      if (mcpPkceChallenge(form.code_verifier ?? "") !== grant.challenge) return refuse("invalid_grant");
      return answerToken(grant);
    }
    if (form.grant_type === "refresh_token") {
      const grant = refreshes.get(form.refresh_token ?? "");
      refreshes.delete(form.refresh_token ?? "");
      if (!grant || grant.clientId !== form.client_id || grant.resource !== form.resource) return refuse("invalid_grant");
      return answerToken(grant);
    }
    return refuse("unsupported_grant_type");
  };

  const register = (body: Record<string, unknown>): { status: number; body: string } => {
    oauth.registrations.push(body);
    const id = `dyn-${oauth.registrations.length}`;
    const secret = options.dynamic === "secret-post" || options.dynamic === "secret-basic" ? `secret-${oauth.registrations.length}` : null;
    clients.set(id, { id, auth: options.dynamic === "secret-post" ? "post" : secret ? "basic" : "none", secret });
    return {
      status: 201,
      body: JSON.stringify({
        client_id: id,
        ...(secret ? { client_secret: secret, token_endpoint_auth_method: options.dynamic === "secret-post" ? "client_secret_post" : "client_secret_basic" } : { token_endpoint_auth_method: "none" }),
      }),
    };
  };

  /** The user said yes: a code for exactly what was asked. */
  const authorize = (asked: URL): McpOAuthRedirect => {
    const param = (name: string) => asked.searchParams.get(name) ?? "";
    const state = param("state");
    const named = options.iss ? { iss: issuer } : {};
    const clientId = param("client_id");
    const knownClient = clients.has(clientId) || (options.document === true && clientId.startsWith("https://"));
    if (param("response_type") !== "code" || param("code_challenge_method") !== "S256" || !param("code_challenge") || !knownClient) return { state, error: "invalid_request", ...named };
    const code = `code-${grants.size + issued + 1}`;
    grants.set(code, { clientId, redirectUri: param("redirect_uri"), challenge: param("code_challenge"), resource: param("resource"), scopes: param("scope") ? param("scope").split(" ") : [] });
    return { state, code, ...named };
  };

  // --- the native side of the app
  const links = new Map<string, Link>();
  const found = new Map<string, McpIssuerEndpoints>();
  let pending: Pending | null = null;
  let returned: McpOAuthRedirect | null = null;

  const fetched = (url: string): { status: number; body: string } => {
    if (oauth.offline) return fail("oauth-unreachable");
    oauth.asked.push(url);
    return documents.get(url) ?? { status: 404, body: "" };
  };

  const host: McpOAuthHost = {
    async document(_serverId, url) {
      return fetched(mcpOAuthAddress(url, options.serverUrl) ?? fail("oauth-address"));
    },
    async issuer(serverId, named, url) {
      if (!mcpIssuerDocumentUrlOk(named, url) || !mcpOAuthAddress(url, options.serverUrl)) fail("oauth-address");
      const answer = fetched(url);
      if (answer.status !== 200) fail("oauth-no-metadata");
      const read = readMcpIssuerDocument(answer.body, named, options.serverUrl);
      if (!read.ok) return fail(read.problem);
      found.set(serverId, read.value);
      return mcpIssuerInfo(read.value);
    },
    async begin(serverId, request) {
      const endpoints = found.get(serverId);
      if (!endpoints || endpoints.issuer !== request.issuer) return fail("oauth-no-metadata");
      const resource = mcpOAuthResource(request.resource, options.serverUrl) ?? fail("oauth-resource");
      const redirectUri = mcpOAuthRedirectUri(request.redirectPort !== undefined ? { port: request.redirectPort } : { appId: options.appId ?? "" }) ?? fail("oauth-address");
      const kept = links.get(serverId);
      const reusable = kept && kept.issuer === endpoints.issuer ? kept : null;
      let client: McpOAuthClient;
      let kind: Link["kind"];
      if (request.client.kind === "document") {
        if (!endpoints.document) return fail("oauth-client");
        client = { id: mcpOAuthClientId("document", request.client.id) ?? fail("oauth-client"), auth: "none", secret: null };
        kind = "document";
      } else if (request.client.kind === "manual") {
        client = { id: mcpOAuthClientId("manual", request.client.id) ?? fail("oauth-client"), auth: "none", secret: null };
        kind = "manual";
      } else if (reusable && (reusable.kind !== "dynamic" || reusable.redirectUri === redirectUri)) {
        client = reusable.client;
        kind = reusable.kind;
      } else if (request.client.kind === "stored" && !reusable) {
        return fail("oauth-client");
      } else {
        // A registration is for one way back: another one is another registration.
        if (!endpoints.registration) return fail("oauth-client");
        if (oauth.offline) return fail("oauth-unreachable");
        const answer = register(mcpRegistrationBody(request.clientName, redirectUri));
        client = readMcpRegistration(answer.status, answer.body) ?? fail("oauth-registration");
        kind = "dynamic";
      }
      const verifier = mcpOAuthRandom(32);
      const state = mcpOAuthRandom(16);
      pending = { serverId, endpoints, client, kind, verifier, state, redirectUri, scopes: [...request.scopes], resource };
      return mcpAuthorizationUrl(endpoints.authorization, { clientId: client.id, redirectUri, challenge: mcpPkceChallenge(verifier), state, scopes: request.scopes, resource });
    },
    async finish(redirect) {
      const flow = pending;
      const checked = checkMcpOAuthRedirect(flow && { state: flow.state, issuer: flow.endpoints.issuer, iss: flow.endpoints.iss }, redirect);
      // An answer to nothing that was begun leaves what was begun alone: the real one may still come.
      if (!checked.ok && checked.problem === "oauth-no-flow") return fail("oauth-no-flow");
      pending = null;
      if (!checked.ok || !flow) return fail(checked.ok ? "oauth-no-flow" : checked.problem);
      if (oauth.offline) return fail("oauth-unreachable");
      const answer = token(mcpTokenForm({ kind: "code", code: checked.code, verifier: flow.verifier, redirectUri: flow.redirectUri }, flow.client, flow.resource), flow.client);
      const read = readMcpTokenResponse(answer.status, answer.body);
      if (!read.ok) return fail(read.problem);
      links.set(flow.serverId, {
        issuer: flow.endpoints.issuer,
        token: flow.endpoints.token,
        client: flow.client,
        kind: flow.kind,
        redirectUri: flow.redirectUri,
        resource: flow.resource,
        scopes: read.value.scopes ?? flow.scopes,
        access: read.value.access,
        refresh: read.value.refresh,
        expiresAt: read.value.expiresIn === null ? null : Math.floor(now() / 1000) + read.value.expiresIn,
      });
      return flow.serverId;
    },
    cancel() {
      pending = null;
      return Promise.resolve();
    },
    async renew(serverId) {
      const link = links.get(serverId);
      if (!link?.refresh || oauth.offline) return false;
      const answer = token(mcpTokenForm({ kind: "refresh", token: link.refresh }, link.client, link.resource), link.client);
      const read = readMcpTokenResponse(answer.status, answer.body);
      if (!read.ok) {
        // Refused for good: the sign-in is over; who Plainva is to this authorization server stays.
        if (read.problem === "oauth-grant") Object.assign(link, { access: null, refresh: null, expiresAt: null });
        return false;
      }
      Object.assign(link, { access: read.value.access, refresh: read.value.refresh ?? link.refresh, expiresAt: read.value.expiresIn === null ? null : Math.floor(now() / 1000) + read.value.expiresIn });
      if (read.value.scopes) link.scopes = read.value.scopes;
      return true;
    },
    status(serverId) {
      const link = links.get(serverId);
      return Promise.resolve(link ? { issuer: link.issuer, scopes: [...link.scopes], expiresAt: link.expiresAt, signedIn: link.access !== null, renewable: link.refresh !== null, client: true } : null);
    },
    signOut(serverId) {
      links.delete(serverId);
      return Promise.resolve();
    },
  };

  const browser: McpOAuthBrowser = {
    prepare: () => Promise.resolve(options.appId ? {} : { redirectPort: MCP_OAUTH_LOOPBACK_PORT }),
    open(url) {
      oauth.opened.push(url);
      const asked = new URL(url);
      const state = asked.searchParams.get("state") ?? "";
      const named = options.iss ? { iss: issuer } : {};
      returned =
        typeof oauth.consent === "function" ? oauth.consent(asked) : oauth.consent === "allow" ? authorize(asked) : oauth.consent === "deny" ? { state, error: "access_denied", ...named } : null;
      return Promise.resolve();
    },
    wait(signal) {
      const came = returned;
      returned = null;
      if (came) return Promise.resolve(came);
      // The user closed the browser: nothing comes until somebody stops waiting.
      return new Promise<McpOAuthRedirect>((_, reject) => {
        if (signal?.aborted) reject(new Error("cancelled"));
        signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    },
  };

  const oauth: ScriptedOAuth = {
    host,
    browser,
    consent: "allow",
    offline: false,
    documents,
    asked: [],
    opened: [],
    registrations: [],
    tokenRequests: [],
    bearer: (serverId) => links.get(serverId)?.access ?? undefined,
    accepts: (sent) => sent !== undefined && sent === accepted,
    expire() {
      accepted = undefined;
    },
    revoke() {
      accepted = undefined;
      refreshes.clear();
    },
  };
  return oauth;
}
