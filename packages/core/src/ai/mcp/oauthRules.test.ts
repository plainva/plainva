import { describe, expect, it } from "vitest";
import type { McpOAuthRedirect } from "./native.js";
import { mcpResourceCovers } from "./oauth.js";
import {
  checkMcpOAuthRedirect,
  mcpAuthorizationUrl,
  mcpClientDocument,
  MCP_OAUTH_CLIENT_DOCUMENT,
  MCP_OAUTH_LOOPBACK_PORT,
  MCP_OAUTH_REDIRECT_URIS,
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
} from "./oauthRules.js";

/**
 * The lists below are the contract of every shell's native side of a
 * sign-in. The Rust module (apps/desktop/src-tauri/src/mcp_client/oauth.rs),
 * Android's `AiMcpOAuthRulesTest` and iOS's `AiMcpOAuthRulesTests` run the
 * same cases: one added here is added there.
 */

/** [the server's registered address, an address it names for its sign-in, whether that may be asked] */
export const MCP_OAUTH_ADDRESS_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["https://mcp.example.com/mcp", "https://auth.example.org/.well-known/oauth-authorization-server", true],
  // The server's own host is the one the user confirmed: any port of it.
  ["https://mcp.example.com/mcp", "https://mcp.example.com:8443/token", true],
  // Everywhere else: a public name, https, the default port.
  ["https://mcp.example.com/mcp", "https://auth.example.org:8443/token", false],
  ["https://mcp.example.com/mcp", "http://auth.example.org/token", false],
  ["https://mcp.example.com/mcp", "https://192.168.1.1/token", false],
  ["https://mcp.example.com/mcp", "https://router.lan/token", false],
  ["https://mcp.example.com/mcp", "https://localhost/token", false],
  ["https://mcp.example.com/mcp", "https://user:pw@auth.example.org/token", false],
  ["https://mcp.example.com/mcp", "https://auth.example.org/token#x", false],
  ["https://mcp.example.com/mcp", "javascript:alert(1)", false],
  ["https://mcp.example.com/mcp", "", false],
  // A server at home: its own address, and no other one of the home network.
  ["https://192.168.1.20/mcp", "https://192.168.1.20/oauth/token", true],
  ["https://192.168.1.20/mcp", "https://192.168.1.21/oauth/token", false],
  // A server on this device: what it names on this device follows its own rule.
  ["http://localhost:3000/mcp", "http://localhost:9000/token", true],
  ["http://localhost:3000/mcp", "http://127.0.0.1:9000/token", false],
  ["http://localhost:3000/mcp", "https://auth.example.org/token", true],
];

/** [an authorization server's name, the address its metadata is asked at, whether it may be read from there] */
export const MCP_OAUTH_ISSUER_URL_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["https://auth.example.org", "https://auth.example.org/.well-known/oauth-authorization-server", true],
  ["https://auth.example.org/tenant1", "https://auth.example.org/.well-known/oauth-authorization-server/tenant1", true],
  ["https://auth.example.org/tenant1", "https://auth.example.org/tenant1/.well-known/openid-configuration", true],
  ["http://localhost:9000", "http://localhost:9000/.well-known/oauth-authorization-server", true],
  // Not the place nobody else can write to.
  ["https://auth.example.org", "https://auth.example.org/metadata.json", false],
  // Another origin: another host, another port, another scheme.
  ["https://auth.example.org", "https://evil.example.net/.well-known/oauth-authorization-server", false],
  ["https://auth.example.org", "https://auth.example.org:8443/.well-known/oauth-authorization-server", false],
  ["https://auth.example.org", "http://auth.example.org/.well-known/oauth-authorization-server", false],
  // A name of an authorization server has no query and nothing after a `#`.
  ["https://auth.example.org?x=1", "https://auth.example.org/.well-known/oauth-authorization-server", false],
  ["https://auth.example.org#x", "https://auth.example.org/.well-known/oauth-authorization-server", false],
];

const ISSUER = "https://auth.example.org";
const SERVER = "https://mcp.example.com/mcp";

/** [what the case is about, the metadata as it was served, "ok" or why it does not count] — asked as `ISSUER` for `SERVER`. */
export const MCP_OAUTH_ISSUER_DOC_CASES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "complete",
    '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","response_types_supported":["code"],"code_challenge_methods_supported":["S256","plain"],"registration_endpoint":"https://auth.example.org/register","client_id_metadata_document_supported":true,"authorization_response_iss_parameter_supported":true,"scopes_supported":["read","write"]}',
    "ok",
  ],
  [
    "the token endpoint on another public host",
    '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://tokens.example.net/token","code_challenge_methods_supported":["S256"]}',
    "ok",
  ],
  [
    "another issuer, by one character",
    '{"issuer":"https://auth.example.org/","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"]}',
    "oauth-issuer",
  ],
  ["no issuer", '{"authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"]}', "oauth-issuer"],
  ["it does not say it does PKCE", '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token"}', "oauth-no-pkce"],
  [
    "PKCE without SHA-256",
    '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["plain"]}',
    "oauth-no-pkce",
  ],
  [
    "the token endpoint in the local network",
    '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://router.lan/token","code_challenge_methods_supported":["S256"]}',
    "oauth-endpoints",
  ],
  ["no authorization endpoint", '{"issuer":"https://auth.example.org","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"]}', "oauth-endpoints"],
  [
    "no code flow",
    '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","response_types_supported":["token"],"code_challenge_methods_supported":["S256"]}',
    "oauth-endpoints",
  ],
  ["a page, not a document", "<html><body>Not found</body></html>", "oauth-no-metadata"],
  ["a list, not a document", "[]", "oauth-no-metadata"],
];

/** [what a server names as itself, its registered address, whether a token may be asked for that name] */
export const MCP_OAUTH_RESOURCE_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["https://mcp.example.com/mcp", "https://mcp.example.com/mcp", true],
  ["https://mcp.example.com", "https://mcp.example.com/mcp", true],
  ["https://mcp.example.com/", "https://mcp.example.com/mcp", true],
  ["https://mcp.example.com/mcp", "https://mcp.example.com/mcp/v1?x=1", true],
  ["https://MCP.Example.com/mcp", "https://mcp.example.com/mcp", true],
  ["http://localhost:3000/mcp", "http://localhost:3000/mcp", true],
  // A part of a path ends where a segment ends.
  ["https://mcp.example.com/mc", "https://mcp.example.com/mcp", false],
  // More than the address is somebody else.
  ["https://mcp.example.com/mcp/v1", "https://mcp.example.com/mcp", false],
  ["https://other.example.com/mcp", "https://mcp.example.com/mcp", false],
  ["https://mcp.example.com:8443/mcp", "https://mcp.example.com/mcp", false],
  ["http://mcp.example.com/mcp", "https://mcp.example.com/mcp", false],
  ["https://mcp.example.com/mcp?x=1", "https://mcp.example.com/mcp", false],
  ["https://mcp.example.com/mcp#x", "https://mcp.example.com/mcp", false],
  ["", "https://mcp.example.com/mcp", false],
];

/** [whether the authorization server promised to name itself, what the browser came back with, "ok" or the problem] — begun with state `s1` at `ISSUER`. */
export const MCP_OAUTH_REDIRECT_CASES: ReadonlyArray<readonly [boolean, McpOAuthRedirect, string]> = [
  [false, { state: "s1", code: "c" }, "ok"],
  [true, { state: "s1", code: "c", iss: "https://auth.example.org" }, "ok"],
  // Named without a promise: checked all the same.
  [false, { state: "s1", code: "c", iss: "https://auth.example.org" }, "ok"],
  [true, { state: "s1", code: "c" }, "oauth-issuer"],
  [false, { state: "s1", code: "c", iss: "https://auth.example.org/" }, "oauth-issuer"],
  // Somebody else's error is not shown either.
  [true, { state: "s1", error: "access_denied", iss: "https://evil.example.net" }, "oauth-issuer"],
  [false, { state: "s2", code: "c" }, "oauth-no-flow"],
  [false, { state: "", code: "c" }, "oauth-no-flow"],
  [false, { state: "s1", error: "access_denied" }, "oauth-denied"],
  [false, { state: "s1", error: "server_error" }, "oauth-failed"],
  [false, { state: "s1" }, "oauth-failed"],
  [false, { state: "s1", code: "" }, "oauth-failed"],
];

/** [HTTP status, the token endpoint's answer, "ok" or the problem] */
export const MCP_OAUTH_TOKEN_CASES: ReadonlyArray<readonly [number, string, string]> = [
  [200, '{"access_token":"at","token_type":"Bearer","expires_in":3600,"refresh_token":"rt","scope":"read write"}', "ok"],
  [200, '{"access_token":"at","token_type":"bearer"}', "ok"],
  [200, '{"access_token":"at","token_type":"mac"}', "oauth-token"],
  [200, '{"access_token":"","token_type":"Bearer"}', "oauth-token"],
  // A token has no space: it would end the header it travels in.
  [200, '{"access_token":"a b","token_type":"Bearer"}', "oauth-token"],
  [200, '{"token_type":"Bearer"}', "oauth-token"],
  [200, '{"access_token":"at","token_type":"Bearer","refresh_token":7}', "oauth-token"],
  [200, "not json", "oauth-token"],
  // Refused for good: the sign-in is over.
  [400, '{"error":"invalid_grant"}', "oauth-grant"],
  [400, '{"error":"invalid_client"}', "oauth-token"],
  [401, '{"error":"invalid_grant"}', "oauth-token"],
  [500, "", "oauth-token"],
];

/** [HTTP status, a registration's answer, how the client proves itself — or null where the answer is none] */
export const MCP_OAUTH_REGISTRATION_CASES: ReadonlyArray<readonly [number, string, string | null]> = [
  [201, '{"client_id":"abc","token_endpoint_auth_method":"none"}', "none"],
  [200, '{"client_id":"abc"}', "none"],
  [201, '{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"client_secret_post"}', "post"],
  [201, '{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"client_secret_basic"}', "basic"],
  [201, '{"client_id":"abc","client_secret":"s3"}', "basic"],
  // A secret that came with "none" is not used.
  [201, '{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"none"}', "none"],
  // A secret is demanded and none was handed out; a way to prove itself Plainva does not have.
  [201, '{"client_id":"abc","token_endpoint_auth_method":"client_secret_post"}', null],
  [201, '{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"private_key_jwt"}', null],
  [201, '{"client_secret":"s3"}', null],
  [400, '{"error":"invalid_redirect_uri"}', null],
  [201, "nope", null],
];

/** The example of RFC 7636, appendix B: [verifier, challenge]. */
export const MCP_OAUTH_PKCE_CASE = ["dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"] as const;

describe("an address a server names for its sign-in", () => {
  it("is on the server's own host, or public like a page", () => {
    for (const [server, named, accepted] of MCP_OAUTH_ADDRESS_CASES) expect(mcpOAuthAddress(named, server) !== null, `${server} -> ${named}`).toBe(accepted);
  });

  it("is asked in one form", () => {
    expect(mcpOAuthAddress(" https://AUTH.example.org/token ", SERVER)).toBe("https://auth.example.org/token");
    expect(mcpOAuthAddress("https://mcp.example.com:8443/token", SERVER)).toBe("https://mcp.example.com:8443/token");
  });
});

describe("an authorization server's metadata", () => {
  it("is read from its own origin, under /.well-known/, and from nowhere else", () => {
    for (const [issuer, url, accepted] of MCP_OAUTH_ISSUER_URL_CASES) expect(mcpIssuerDocumentUrlOk(issuer, url), `${issuer} at ${url}`).toBe(accepted);
  });

  it("counts when it names the issuer that was asked, usable endpoints and PKCE with SHA-256", () => {
    for (const [about, body, expected] of MCP_OAUTH_ISSUER_DOC_CASES) {
      const read = readMcpIssuerDocument(body, ISSUER, SERVER);
      expect(read.ok ? "ok" : read.problem, about).toBe(expected);
    }
  });

  it("is kept with its endpoints, and told to the web view without them", () => {
    const read = readMcpIssuerDocument(MCP_OAUTH_ISSUER_DOC_CASES[0]![1], ISSUER, SERVER);
    if (!read.ok) throw new Error(read.problem);
    expect(read.value).toEqual({
      issuer: ISSUER,
      authorization: "https://auth.example.org/authorize",
      token: "https://auth.example.org/token",
      registration: "https://auth.example.org/register",
      document: true,
      iss: true,
      scopes: ["read", "write"],
    });
    expect(mcpIssuerInfo(read.value)).toEqual({ issuer: ISSUER, document: true, dynamic: true, iss: true, scopes: ["read", "write"] });
    expect(JSON.stringify(mcpIssuerInfo(read.value))).not.toContain("/token");
    // A registration endpoint that may not be asked is none; the rest still counts.
    const plain = readMcpIssuerDocument(
      '{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"],"registration_endpoint":"http://auth.example.org/register"}',
      ISSUER,
      SERVER,
    );
    expect(plain.ok && mcpIssuerInfo(plain.value)).toEqual({ issuer: ISSUER, document: false, dynamic: false, iss: false, scopes: [] });
  });
});

describe("who a token is for", () => {
  it("is the server's address or a part of it the server names as itself", () => {
    for (const [resource, server, covers] of MCP_OAUTH_RESOURCE_CASES) {
      expect(mcpResourceCovers(resource, server), `${resource} for ${server}`).toBe(covers);
      expect(mcpOAuthResource(resource, server), `${resource} for ${server}`).toBe(covers ? resource : null);
    }
  });
});

describe("the way back from the browser", () => {
  it("is a port on this computer or the app's own address", () => {
    expect(mcpOAuthRedirectUri({ port: 43117 })).toBe("http://127.0.0.1:43117/callback");
    expect(mcpOAuthRedirectUri({ port: 80 })).toBeNull();
    expect(mcpOAuthRedirectUri({ port: 70000 })).toBeNull();
    expect(mcpOAuthRedirectUri({ port: 1024.5 })).toBeNull();
    expect(mcpOAuthRedirectUri({ appId: "com.plainva.app" })).toBe("com.plainva.app://mcp/oauth");
    expect(mcpOAuthRedirectUri({ appId: "com.plainva.app.labs" })).toBe("com.plainva.app.labs://mcp/oauth");
    expect(mcpOAuthRedirectUri({ appId: "https" })).toBeNull();
    expect(mcpOAuthRedirectUri({ appId: "" })).toBeNull();
  });

  it("is taken when its state is the one that was sent and who answered is who was asked", () => {
    for (const [promised, redirect, expected] of MCP_OAUTH_REDIRECT_CASES) {
      const checked = checkMcpOAuthRedirect({ state: "s1", issuer: ISSUER, iss: promised }, redirect);
      expect(checked.ok ? "ok" : checked.problem, JSON.stringify(redirect)).toBe(expected);
    }
    expect(checkMcpOAuthRedirect(null, { state: "s1", code: "c" })).toEqual({ ok: false, problem: "oauth-no-flow" });
    expect(checkMcpOAuthRedirect({ state: "s1", issuer: ISSUER, iss: false }, { state: "s1", code: "c" })).toEqual({ ok: true, code: "c" });
  });
});

describe("the request for a sign-in", () => {
  it("names the client, the way back, the challenge, the state and who the token is for", () => {
    const url = mcpAuthorizationUrl("https://auth.example.org/authorize?tenant=a", {
      clientId: "https://plainva.com/oauth/client.json",
      redirectUri: "http://127.0.0.1:43117/callback",
      challenge: MCP_OAUTH_PKCE_CASE[1],
      state: "s1",
      scopes: ["read", "write"],
      resource: "https://mcp.example.com/mcp",
    });
    expect(url.startsWith("https://auth.example.org/authorize?")).toBe(true);
    expect([...new URL(url).searchParams]).toEqual([
      ["tenant", "a"],
      ["response_type", "code"],
      ["client_id", "https://plainva.com/oauth/client.json"],
      ["redirect_uri", "http://127.0.0.1:43117/callback"],
      ["code_challenge", MCP_OAUTH_PKCE_CASE[1]],
      ["code_challenge_method", "S256"],
      ["state", "s1"],
      ["resource", "https://mcp.example.com/mcp"],
      ["scope", "read write"],
    ]);
    // Without scopes there is no scope: the server's default, not an empty one.
    expect(new URL(mcpAuthorizationUrl("https://auth.example.org/authorize", { clientId: "c", redirectUri: "r", challenge: "x", state: "s", scopes: [], resource: "q" })).searchParams.has("scope")).toBe(false);
  });

  it("derives the challenge from the verifier, and makes secrets that are long enough", () => {
    expect(mcpPkceChallenge(MCP_OAUTH_PKCE_CASE[0])).toBe(MCP_OAUTH_PKCE_CASE[1]);
    const verifier = mcpOAuthRandom(32);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mcpOAuthRandom(32)).not.toBe(verifier);
    expect(mcpOAuthRandom(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("takes a client id that is printable, and as the address of a description one that is public and has a path", () => {
    expect(mcpOAuthClientId("manual", " my-client 1 ")).toBe("my-client 1");
    expect(mcpOAuthClientId("manual", "")).toBeNull();
    expect(mcpOAuthClientId("manual", `a${String.fromCharCode(10)}b`)).toBeNull();
    expect(mcpOAuthClientId("manual", "a".repeat(513))).toBeNull();
    expect(mcpOAuthClientId("document", "https://plainva.com/oauth/client.json")).toBe("https://plainva.com/oauth/client.json");
    expect(mcpOAuthClientId("document", "https://plainva.com/")).toBeNull();
    expect(mcpOAuthClientId("document", "https://plainva.com")).toBeNull();
    expect(mcpOAuthClientId("document", "http://plainva.com/oauth/client.json")).toBeNull();
    expect(mcpOAuthClientId("document", "https://192.168.1.2/client.json")).toBeNull();
    expect(mcpOAuthClientId("document", "https://plainva.com/oauth/client.json#x")).toBeNull();
    expect(mcpOAuthClientId("document", "my-client")).toBeNull();
  });
});

describe("the token endpoint", () => {
  it("is asked with the fields of the grant, the client and who the token is for", () => {
    const open = { id: "abc", auth: "none", secret: null } as const;
    expect(mcpTokenForm({ kind: "code", code: "c1", verifier: "v1", redirectUri: "http://127.0.0.1:43117/callback" }, open, "https://mcp.example.com/mcp")).toEqual([
      ["grant_type", "authorization_code"],
      ["code", "c1"],
      ["redirect_uri", "http://127.0.0.1:43117/callback"],
      ["code_verifier", "v1"],
      ["client_id", "abc"],
      ["resource", "https://mcp.example.com/mcp"],
    ]);
    expect(mcpTokenForm({ kind: "refresh", token: "rt" }, { id: "abc", auth: "post", secret: "s3" }, "https://mcp.example.com")).toEqual([
      ["grant_type", "refresh_token"],
      ["refresh_token", "rt"],
      ["client_id", "abc"],
      ["resource", "https://mcp.example.com"],
      ["client_secret", "s3"],
    ]);
    // A secret that is the request's own credential is not in the body as well.
    expect(mcpTokenForm({ kind: "refresh", token: "rt" }, { id: "abc", auth: "basic", secret: "s3" }, "r").some(([name]) => name === "client_secret")).toBe(false);
  });

  it("answers with a bearer token, or says whether the sign-in is over", () => {
    for (const [status, body, expected] of MCP_OAUTH_TOKEN_CASES) {
      const read = readMcpTokenResponse(status, body);
      expect(read.ok ? "ok" : read.problem, `${status} ${body}`).toBe(expected);
    }
    expect(readMcpTokenResponse(200, MCP_OAUTH_TOKEN_CASES[0]![1])).toEqual({ ok: true, value: { access: "at", refresh: "rt", expiresIn: 3600, scopes: ["read", "write"] } });
    expect(readMcpTokenResponse(200, MCP_OAUTH_TOKEN_CASES[1]![1])).toEqual({ ok: true, value: { access: "at", refresh: null, expiresIn: null, scopes: null } });
    expect(readMcpTokenResponse(200, '{"access_token":"at","token_type":"Bearer","expires_in":-5,"refresh_token":null}')).toEqual({ ok: true, value: { access: "at", refresh: null, expiresIn: null, scopes: null } });
    // A lifetime no whole number holds is capped, not believed (the native sides would otherwise have to survive the conversion).
    expect(readMcpTokenResponse(200, '{"access_token":"at","token_type":"Bearer","expires_in":1e300}')).toMatchObject({ ok: true, value: { expiresIn: 10 * 365 * 24 * 3600 } });
    expect(readMcpTokenResponse(200, `{"access_token":"${"a".repeat(16_385)}","token_type":"Bearer"}`).ok).toBe(false);
  });
});

describe("Plainva's description as a client", () => {
  it("is what the website serves under the address that is the client's id", () => {
    // The file itself is part of the website repository (public/oauth/client.json): it says exactly this.
    expect(mcpClientDocument()).toEqual({
      client_id: "https://plainva.com/oauth/client.json",
      client_name: "Plainva",
      client_uri: "https://plainva.com",
      logo_uri: "https://plainva.com/plainva.png",
      redirect_uris: ["http://127.0.0.1:43117/callback", "http://127.0.0.1/callback", "com.plainva.app://mcp/oauth", "com.plainva.app.labs://mcp/oauth"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    });
    expect(mcpOAuthClientId("document", MCP_OAUTH_CLIENT_DOCUMENT)).toBe(MCP_OAUTH_CLIENT_DOCUMENT);
  });

  it("lists every way back a shell can name", () => {
    expect(MCP_OAUTH_REDIRECT_URIS).toContain(mcpOAuthRedirectUri({ port: MCP_OAUTH_LOOPBACK_PORT }));
    for (const appId of ["com.plainva.app", "com.plainva.app.labs"]) expect(MCP_OAUTH_REDIRECT_URIS).toContain(mcpOAuthRedirectUri({ appId }));
    // A port that was free instead of the preferred one is covered by the entry without a port (RFC 8252, section 7.3).
    expect(MCP_OAUTH_REDIRECT_URIS).toContain("http://127.0.0.1/callback");
  });
});

describe("a client that registers itself", () => {
  it("says it is a native app without a secret, for one way back", () => {
    expect(mcpRegistrationBody("Plainva", "http://127.0.0.1:43117/callback")).toEqual({
      client_name: "Plainva",
      redirect_uris: ["http://127.0.0.1:43117/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    });
  });

  it("takes the id it is given, and a secret only where the server insists on one", () => {
    for (const [status, body, expected] of MCP_OAUTH_REGISTRATION_CASES) expect(readMcpRegistration(status, body)?.auth ?? null, `${status} ${body}`).toBe(expected);
    expect(readMcpRegistration(201, MCP_OAUTH_REGISTRATION_CASES[2]![1])).toEqual({ id: "abc", auth: "post", secret: "s3" });
    expect(readMcpRegistration(201, MCP_OAUTH_REGISTRATION_CASES[5]![1])).toEqual({ id: "abc", auth: "none", secret: null });
  });
});
