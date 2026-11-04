import { describe, expect, it } from "vitest";
import { createMcpClient } from "./client.js";
import { createMcpHttpWire } from "./httpWire.js";
import { mcpOAuthProblem, readMcpOAuthIssuer, readMcpOAuthStatus, MCP_OAUTH_PROBLEMS } from "./native.js";
import {
  mcpIssuerMetadataUrls,
  mcpResourceMetadataUrls,
  mcpResourceOf,
  mcpSignInProblem,
  mcpSignInScopes,
  planMcpSignIn,
  readMcpBearerChallenge,
  readMcpProtectedResource,
  readMcpScopes,
  runMcpSignIn,
  type McpSignInPlan,
} from "./oauth.js";
import { createScriptedMcpServer, scriptedMcpHttpPort } from "./scripted.js";
import { scriptedMcpOAuth, type ScriptedOAuthOptions } from "./scriptedOAuth.js";
import { McpError } from "./wire.js";

const SERVER = { id: "tracker", url: "https://mcp.example.com/mcp" };
const DOCUMENT = "https://plainva.com/oauth/client.json";
const NAME = { clientName: "Plainva", documentUrl: DOCUMENT };

const setup = (options: Partial<ScriptedOAuthOptions> = {}) => scriptedMcpOAuth({ serverUrl: SERVER.url, ...options });

async function plan(oauth: ReturnType<typeof setup>, challenge?: string, documentUrl: string | null = DOCUMENT): Promise<McpSignInPlan> {
  const made = await planMcpSignIn(oauth.host, SERVER, challenge, documentUrl);
  if (!made.ok) throw new Error(`no plan: ${made.problem}`);
  return made.plan;
}

describe("what a server says when it wants a sign-in", () => {
  it("is read out of its WWW-Authenticate line", () => {
    expect(readMcpBearerChallenge('Bearer realm="mcp", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="read write", error="invalid_token"')).toEqual({
      resourceMetadata: "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      scopes: ["read", "write"],
      error: "invalid_token",
    });
    expect(readMcpBearerChallenge("Bearer")).toEqual({ scopes: [] });
    expect(readMcpBearerChallenge("bearer scope=read")).toEqual({ scopes: ["read"] });
    expect(readMcpBearerChallenge('Bearer error_description="a \\"quoted\\" word", scope="a"')).toEqual({ scopes: ["a"] });
  });

  it("is none where the line asks for something else, and takes nothing of another scheme's", () => {
    expect(readMcpBearerChallenge(undefined)).toBeNull();
    expect(readMcpBearerChallenge("")).toBeNull();
    expect(readMcpBearerChallenge('Basic realm="x"')).toBeNull();
    expect(readMcpBearerChallenge('BearerToken realm="x"')).toBeNull();
    expect(readMcpBearerChallenge('Basic realm="x", Bearer scope="a"')).toEqual({ scopes: ["a"] });
    expect(readMcpBearerChallenge('Bearer scope="a", Basic realm="x", scope="b"')).toEqual({ scopes: ["a"] });
  });

  it("keeps only what can be a scope or an address", () => {
    expect(readMcpScopes('read  wri"te read ok')).toEqual(["read", "ok"]);
    expect(readMcpScopes(["a", 7, "a", "b"])).toEqual(["a", "b"]);
    expect(readMcpScopes(Array.from({ length: 80 }, (_, i) => `s${i}`).join(" "))).toHaveLength(50);
    expect(readMcpBearerChallenge(`Bearer resource_metadata="https://mcp.example.com/${"a".repeat(2100)}"`)).toEqual({ scopes: [] });
    expect(readMcpBearerChallenge('Bearer error="<script>"')).toEqual({ scopes: [] });
  });
});

describe("where a sign-in is described", () => {
  it("is asked at the address the server named, then at the well-known places for its path and its host", () => {
    expect(mcpResourceMetadataUrls("https://mcp.example.com/mcp")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
    expect(mcpResourceMetadataUrls("https://mcp.example.com/mcp/?toolsets=issues", "https://meta.example.org/mcp.json")).toEqual([
      "https://meta.example.org/mcp.json",
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp?toolsets=issues",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
    expect(mcpResourceMetadataUrls("https://mcp.example.com/")).toEqual(["https://mcp.example.com/.well-known/oauth-protected-resource"]);
    expect(mcpResourceMetadataUrls("http://localhost:3000/mcp")).toEqual([
      "http://localhost:3000/.well-known/oauth-protected-resource/mcp",
      "http://localhost:3000/.well-known/oauth-protected-resource",
    ]);
    // A named address that is none is left out; the others are still asked.
    expect(mcpResourceMetadataUrls("https://mcp.example.com/mcp", "javascript:alert(1)")).toHaveLength(2);
    expect(mcpResourceMetadataUrls("not an address")).toEqual([]);
  });

  it("counts only when it is about this server and names an authorization server", () => {
    const good = '{"resource":"https://mcp.example.com/mcp","authorization_servers":["https://auth.example.org","https://auth.example.org","ftp://x","https://b.example.org?x=1"],"scopes_supported":["read","write"]}';
    expect(readMcpProtectedResource(good, SERVER.url)).toEqual({ ok: true, value: { resource: "https://mcp.example.com/mcp", issuers: ["https://auth.example.org"], scopes: ["read", "write"] } });
    expect(readMcpProtectedResource('{"resource":"https://mcp.example.com","authorization_servers":["https://auth.example.org"]}', SERVER.url).ok).toBe(true);
    expect(readMcpProtectedResource('{"resource":"https://other.example.com/mcp","authorization_servers":["https://auth.example.org"]}', SERVER.url)).toEqual({ ok: false, problem: "resource" });
    expect(readMcpProtectedResource('{"authorization_servers":["https://auth.example.org"]}', SERVER.url)).toEqual({ ok: false, problem: "resource" });
    expect(readMcpProtectedResource('{"resource":"https://mcp.example.com/mcp","authorization_servers":[]}', SERVER.url)).toEqual({ ok: false, problem: "no-issuer" });
    expect(readMcpProtectedResource('{"resource":"https://mcp.example.com/mcp"}', SERVER.url)).toEqual({ ok: false, problem: "no-issuer" });
    expect(readMcpProtectedResource("<html>", SERVER.url)).toEqual({ ok: false, problem: "not-json" });
    expect(readMcpProtectedResource("[]", SERVER.url)).toEqual({ ok: false, problem: "not-json" });
  });

  it("names the server itself where the server names nothing", () => {
    expect(mcpResourceOf("https://MCP.example.com/mcp/?x=1#top")).toBe("https://mcp.example.com/mcp");
    expect(mcpResourceOf("https://mcp.example.com/")).toBe("https://mcp.example.com");
    expect(mcpResourceOf("nope")).toBeNull();
  });
});

describe("where an authorization server describes itself", () => {
  it("is on its own origin, at the places the protocol lists, in order", () => {
    expect(mcpIssuerMetadataUrls("https://auth.example.org")).toEqual(["https://auth.example.org/.well-known/oauth-authorization-server", "https://auth.example.org/.well-known/openid-configuration"]);
    expect(mcpIssuerMetadataUrls("https://auth.example.org/")).toEqual(["https://auth.example.org/.well-known/oauth-authorization-server", "https://auth.example.org/.well-known/openid-configuration"]);
    expect(mcpIssuerMetadataUrls("https://auth.example.org/tenant1")).toEqual([
      "https://auth.example.org/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.org/.well-known/openid-configuration/tenant1",
      "https://auth.example.org/tenant1/.well-known/openid-configuration",
    ]);
    expect(mcpIssuerMetadataUrls("https://auth.example.org?x=1")).toEqual([]);
    expect(mcpIssuerMetadataUrls("https://auth.example.org#x")).toEqual([]);
    expect(mcpIssuerMetadataUrls("http://auth.example.org")).toEqual([]);
  });
});

describe("the scopes of a sign-in", () => {
  it("are what the refused request needed, else what the server offers, else none", () => {
    const described = { resource: "r", issuers: ["i"], scopes: ["read", "write", "admin"] };
    expect(mcpSignInScopes({ scopes: ["read"] }, described)).toEqual(["read"]);
    expect(mcpSignInScopes({ scopes: [] }, described)).toEqual(["read", "write", "admin"]);
    expect(mcpSignInScopes(null, described)).toEqual(["read", "write", "admin"]);
    expect(mcpSignInScopes(null, null)).toEqual([]);
  });
});

describe("planning a sign-in", () => {
  it("follows the server's description to its authorization server", async () => {
    const oauth = setup({ document: true, dynamic: true, described: { scopes: ["read", "write"] } });
    expect(await plan(oauth)).toEqual({ issuer: "https://auth.example.com", host: "auth.example.com", scopes: ["read", "write"], resource: "https://mcp.example.com/mcp", client: "document" });
    expect(oauth.asked).toEqual(["https://mcp.example.com/.well-known/oauth-protected-resource/mcp", "https://auth.example.com/.well-known/oauth-authorization-server"]);
  });

  it("asks the address the server named first, and for what the server said it needs", async () => {
    const oauth = setup({ described: { scopes: ["read", "write"] } });
    oauth.documents.set("https://mcp.example.com/meta.json", oauth.documents.get("https://mcp.example.com/.well-known/oauth-protected-resource/mcp")!);
    const made = await plan(oauth, 'Bearer resource_metadata="https://mcp.example.com/meta.json", scope="read"');
    expect(oauth.asked[0]).toBe("https://mcp.example.com/meta.json");
    expect(made.scopes).toEqual(["read"]);
  });

  it("chooses who Plainva is: its description, a registration, or an id from the user", async () => {
    expect((await plan(setup({ document: true, dynamic: true }))).client).toBe("document");
    // An app without a description of its own registers where it can.
    expect((await plan(setup({ document: true, dynamic: true }), undefined, null)).client).toBe("dynamic");
    expect((await plan(setup({ dynamic: true }))).client).toBe("dynamic");
    expect((await plan(setup({}))).client).toBe("manual");
    expect((await plan(setup({ document: true }), undefined, null)).client).toBe("manual");
  });

  it("takes the server's own origin for a server that describes nothing", async () => {
    const oauth = setup({ described: null, dynamic: true });
    expect(await plan(oauth)).toEqual({ issuer: "https://mcp.example.com", host: "mcp.example.com", scopes: [], resource: "https://mcp.example.com/mcp", client: "dynamic" });
  });

  it("tries the next place where an authorization server keeps its description", async () => {
    const oauth = setup({ issuer: "https://auth.example.com/tenant1", dynamic: true });
    const first = "https://auth.example.com/.well-known/oauth-authorization-server/tenant1";
    const last = "https://auth.example.com/tenant1/.well-known/openid-configuration";
    oauth.documents.set(last, oauth.documents.get(first)!);
    oauth.documents.delete(first);
    expect((await plan(oauth)).issuer).toBe("https://auth.example.com/tenant1");
    expect(oauth.asked.slice(1)).toEqual([first, "https://auth.example.com/.well-known/openid-configuration/tenant1", last]);
  });

  it("says so when a server offers no sign-in, an unusable one, or cannot be reached", async () => {
    const none = setup({ described: null });
    none.documents.clear();
    expect(await planMcpSignIn(none.host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "not-offered" });

    expect(await planMcpSignIn(setup({ pkce: false }).host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "unsupported" });

    const lost = setup({});
    lost.documents.delete("https://auth.example.com/.well-known/oauth-authorization-server");
    expect(await planMcpSignIn(lost.host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "unsupported" });

    const offline = setup({});
    offline.offline = true;
    expect(await planMcpSignIn(offline.host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "unreachable" });
  });

  it("does not follow a description of another server, or one that names a place it may not ask", async () => {
    const other = setup({ described: { resource: "https://other.example.com/mcp" } });
    // The description is somebody else's: what is left is the server's own origin, and it has no sign-in.
    expect(await planMcpSignIn(other.host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "not-offered" });

    const local = setup({ described: { issuers: ["https://router.lan"] } });
    expect(await planMcpSignIn(local.host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "unsupported" });
    expect(local.asked.some((url) => url.includes("router.lan"))).toBe(false);
  });

  it("does not take an authorization server that is not who the server named", async () => {
    const oauth = setup({});
    const at = "https://auth.example.com/.well-known/oauth-authorization-server";
    oauth.documents.set(at, { status: 200, body: oauth.documents.get(at)!.body.replace('"issuer":"https://auth.example.com"', '"issuer":"https://evil.example.net"') });
    expect(await planMcpSignIn(oauth.host, SERVER, undefined, DOCUMENT)).toEqual({ ok: false, problem: "unsupported" });
  });
});

describe("signing in", () => {
  it("ends with a token the server takes — and none of it passes through the web view's side", async () => {
    const oauth = setup({ document: true, iss: true, described: { scopes: ["read"] } });
    const made = await plan(oauth);
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, made, NAME)).toEqual({ ok: true });
    expect(oauth.accepts(oauth.bearer(SERVER.id))).toBe(true);
    expect(await oauth.host.status(SERVER.id)).toMatchObject({ issuer: "https://auth.example.com", scopes: ["read"], signedIn: true, renewable: true, client: true });

    const asked = new URL(oauth.opened[0]!);
    expect(asked.origin + asked.pathname).toBe("https://auth.example.com/authorize");
    expect(asked.searchParams.get("client_id")).toBe(DOCUMENT);
    expect(asked.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43117/callback");
    expect(asked.searchParams.get("resource")).toBe("https://mcp.example.com/mcp");
    expect(asked.searchParams.get("code_challenge_method")).toBe("S256");
    // The token request carries the verifier; the address the browser saw does not.
    expect(oauth.tokenRequests[0]).toMatchObject({ grant_type: "authorization_code", client_id: DOCUMENT, resource: "https://mcp.example.com/mcp" });
    expect(oauth.opened[0]).not.toContain(oauth.tokenRequests[0]!.code_verifier!);
    // What the web view's side can ask says nothing a token could be made of.
    const visible = JSON.stringify([await oauth.host.status(SERVER.id), oauth.opened]);
    expect(visible).not.toContain(oauth.bearer(SERVER.id)!);
    expect(visible).not.toContain("rt-1");
  });

  it("comes back to the app's own address on a phone", async () => {
    const oauth = setup({ dynamic: true, appId: "com.plainva.app" });
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, await plan(oauth), NAME)).toEqual({ ok: true });
    expect(new URL(oauth.opened[0]!).searchParams.get("redirect_uri")).toBe("com.plainva.app://mcp/oauth");
    expect(oauth.registrations[0]).toMatchObject({ redirect_uris: ["com.plainva.app://mcp/oauth"], application_type: "native", token_endpoint_auth_method: "none" });
  });

  it("registers once, and is the same client the next time", async () => {
    const oauth = setup({ dynamic: true });
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, await plan(oauth), NAME)).toEqual({ ok: true });
    const again = await plan(oauth);
    expect(again.client).toBe("stored");
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, again, NAME)).toEqual({ ok: true });
    expect(oauth.registrations).toHaveLength(1);
    expect(new URL(oauth.opened[1]!).searchParams.get("client_id")).toBe("dyn-1");
  });

  it("proves itself with a secret where a registration handed one out — in the way it was told to", async () => {
    const post = setup({ dynamic: "secret-post" });
    expect(await runMcpSignIn(post.host, post.browser, SERVER.id, await plan(post), NAME)).toEqual({ ok: true });
    expect(post.tokenRequests[0]!.client_secret).toBe("secret-1");
    const basic = setup({ dynamic: "secret-basic" });
    expect(await runMcpSignIn(basic.host, basic.browser, SERVER.id, await plan(basic), NAME)).toEqual({ ok: true });
    expect(basic.tokenRequests[0]!.client_secret).toBeUndefined();
  });

  it("needs an id from the user where the authorization server offers no other way", async () => {
    const oauth = setup({ clients: ["plainva-at-acme"] });
    const made = await plan(oauth);
    expect(made.client).toBe("manual");
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, made, NAME)).toEqual({ ok: false, problem: "client" });
    expect(oauth.opened).toEqual([]);
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, made, { ...NAME, clientId: " plainva-at-acme " })).toEqual({ ok: true });
    expect(new URL(oauth.opened[0]!).searchParams.get("client_id")).toBe("plainva-at-acme");
  });

  it("is over when the user says no, closes the browser, or something else comes back", async () => {
    const denied = setup({ dynamic: true });
    denied.consent = "deny";
    expect(await runMcpSignIn(denied.host, denied.browser, SERVER.id, await plan(denied), NAME)).toEqual({ ok: false, problem: "declined" });
    expect(await denied.host.status(SERVER.id)).toBeNull();

    const closed = setup({ dynamic: true });
    closed.consent = "never";
    const stop = new AbortController();
    const waiting = runMcpSignIn(closed.host, closed.browser, SERVER.id, await plan(closed), { ...NAME, signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort();
    expect(await waiting).toEqual({ ok: false, problem: "cancelled" });
    // What was begun is forgotten: an answer that comes late finds nothing.
    await expect(closed.host.finish({ state: new URL(closed.opened[0]!).searchParams.get("state")!, code: "late" })).rejects.toThrow("oauth-no-flow");

    const forged = setup({ dynamic: true });
    forged.consent = () => ({ state: "not-the-one", code: "stolen" });
    expect(await runMcpSignIn(forged.host, forged.browser, SERVER.id, await plan(forged), NAME)).toEqual({ ok: false, problem: "cancelled" });
    expect(forged.tokenRequests).toEqual([]);
  });

  it("fails when who answered is not who was asked, before a code is used", async () => {
    const oauth = setup({ dynamic: true, iss: true });
    oauth.consent = (asked) => ({ state: asked.searchParams.get("state")!, code: "from-elsewhere", iss: "https://evil.example.net" });
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, await plan(oauth), NAME)).toEqual({ ok: false, problem: "failed" });
    oauth.consent = (asked) => ({ state: asked.searchParams.get("state")!, code: "unnamed" });
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, await plan(oauth), NAME)).toEqual({ ok: false, problem: "failed" });
    expect(oauth.tokenRequests).toEqual([]);
  });

  it("asks for a token for the name the server gave itself, and for no other", async () => {
    const oauth = setup({ dynamic: true, described: { resource: "https://mcp.example.com" } });
    const made = await plan(oauth);
    expect(made.resource).toBe("https://mcp.example.com");
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, made, NAME)).toEqual({ ok: true });
    // A plan that was tampered with on the way: the native side does not ask for somebody else's token.
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, { ...made, resource: "https://other.example.com" }, NAME)).toEqual({ ok: false, problem: "unsupported" });
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, { ...made, issuer: "https://evil.example.net" }, NAME)).toEqual({ ok: false, problem: "failed" });
  });

  it("gets a new token without the user while it can, and is over when it cannot", async () => {
    const oauth = setup({ dynamic: true });
    await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, await plan(oauth), NAME);
    const first = oauth.bearer(SERVER.id);
    oauth.expire();
    expect(oauth.accepts(first)).toBe(false);
    expect(await oauth.host.renew(SERVER.id)).toBe(true);
    expect(oauth.bearer(SERVER.id)).not.toBe(first);
    expect(oauth.accepts(oauth.bearer(SERVER.id))).toBe(true);
    expect(oauth.tokenRequests[1]).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1", resource: "https://mcp.example.com/mcp" });

    oauth.revoke();
    expect(await oauth.host.renew(SERVER.id)).toBe(false);
    expect(await oauth.host.status(SERVER.id)).toMatchObject({ signedIn: false, renewable: false, client: true });
    expect(oauth.bearer(SERVER.id)).toBeUndefined();
    expect(await oauth.host.renew("nobody")).toBe(false);

    await oauth.host.signOut(SERVER.id);
    expect(await oauth.host.status(SERVER.id)).toBeNull();
  });
});

describe("a request to a server that wants a sign-in", () => {
  const tools = [{ name: "search", description: "Searches.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }];

  function wired(renew: boolean) {
    const oauth = setup({ dynamic: true });
    const server = createScriptedMcpServer({ tools });
    server.accepts = (token) => oauth.accepts(token);
    server.challenge = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"';
    const port = scriptedMcpHttpPort(server, { bearer: () => oauth.bearer(SERVER.id) });
    let ids = 0;
    let renewals = 0;
    const client = createMcpClient(
      createMcpHttpWire(port, {
        client: { name: "Plainva", version: "1" },
        newRequestId: () => `r${++ids}`,
        ...(renew
          ? {
              renew: () => {
                renewals++;
                return oauth.host.renew(SERVER.id);
              },
            }
          : {}),
      }),
    );
    return { oauth, server, port, client, renewals: () => renewals };
  }

  it("is refused with the line that says where to sign in", async () => {
    const { client } = wired(true);
    const refused = await client.open().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(McpError);
    expect((refused as McpError).failure).toEqual({ kind: "auth", status: 401, challenge: 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' });
  });

  it("goes through after the sign-in, and again after the token ran out — renewed once, asked twice", async () => {
    const { oauth, server, port, client, renewals } = wired(true);
    const refused = (await client.open().catch((error: unknown) => error)) as McpError;
    const challenge = refused.failure.kind === "auth" ? refused.failure.challenge : undefined;
    const made = await planMcpSignIn(oauth.host, SERVER, challenge, DOCUMENT);
    if (!made.ok) throw new Error(made.problem);
    expect(await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, made.plan, NAME)).toEqual({ ok: true });
    expect((await client.listing()).listing.tools.map((tool) => tool.name)).toEqual(["search"]);

    oauth.expire();
    const before = port.requests.length;
    await client.callTool("search", { query: "login" }, { inputSchema: tools[0]!.inputSchema });
    expect(server.calls).toEqual([{ name: "search", args: { query: "login" } }]);
    expect(port.requests.length - before).toBe(2);
    expect(renewals()).toBe(2);
    // No credential is among the headers the web view's side wrote.
    for (const { request } of port.requests) expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain("authorization");
  });

  it("stays refused where nothing can be renewed", async () => {
    const { oauth, client, renewals } = wired(true);
    await runMcpSignIn(oauth.host, oauth.browser, SERVER.id, await plan(oauth), NAME);
    await client.open();
    oauth.revoke();
    const refused = (await client.callTool("search", {}, { inputSchema: tools[0]!.inputSchema }).catch((error: unknown) => error)) as McpError;
    expect(refused.failure).toMatchObject({ kind: "auth", status: 401 });
    expect(renewals()).toBe(1);

    const plain = wired(false);
    await runMcpSignIn(plain.oauth.host, plain.oauth.browser, SERVER.id, await plan(plain.oauth), NAME);
    await plain.client.open();
    plain.oauth.expire();
    const again = (await plain.client.callTool("search", {}, { inputSchema: tools[0]!.inputSchema }).catch((error: unknown) => error)) as McpError;
    expect(again.failure).toMatchObject({ kind: "auth", status: 401 });
  });
});

describe("what the native side answers", () => {
  it("is read as far as it is what was expected", () => {
    expect(readMcpOAuthIssuer({ issuer: "https://auth.example.org", document: true, dynamic: 1, iss: false, scopes: ["a", 2], token: "x" })).toEqual({ issuer: "https://auth.example.org", document: true, dynamic: false, iss: false, scopes: ["a"] });
    expect(readMcpOAuthIssuer(null)).toBeNull();
    expect(readMcpOAuthStatus({ issuer: "i", scopes: ["a"], expiresAt: 1_900_000_000, signedIn: true, renewable: true, client: true })).toEqual({ issuer: "i", scopes: ["a"], expiresAt: 1_900_000_000, signedIn: true, renewable: true, client: true });
    expect(readMcpOAuthStatus({ issuer: "i" })).toEqual({ issuer: "i", scopes: [], expiresAt: null, signedIn: false, renewable: false, client: false });
    expect(readMcpOAuthStatus(undefined)).toBeNull();
  });

  it("names a problem in one of its fixed words, and anything else is a failed sign-in", () => {
    for (const word of MCP_OAUTH_PROBLEMS) expect(mcpOAuthProblem(new Error(word))).toBe(word);
    expect(mcpOAuthProblem(new Error("connection reset by peer"))).toBe("oauth-failed");
    expect(mcpOAuthProblem("oauth-denied")).toBe("oauth-denied");
    expect(mcpSignInProblem(new Error("oauth-unreachable"))).toBe("unreachable");
    expect(mcpSignInProblem(new Error("oauth-no-pkce"))).toBe("unsupported");
    expect(mcpSignInProblem(new Error("oauth-registration"))).toBe("client");
    expect(mcpSignInProblem(new Error("oauth-denied"))).toBe("declined");
    expect(mcpSignInProblem(new Error("oauth-token"))).toBe("failed");
  });
});
