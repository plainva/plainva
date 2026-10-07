import { describe, expect, it } from "vitest";
import { EMPTY_MCP_GRANT, McpError, scriptedMcpOAuth, type EgressChunk, type ScriptedOAuthOptions } from "@plainva/core";
import { CONFIRM } from "./mcpTestHost";
import { SEARCH, TRACKER_URL, answering, body, mcpSession, results, tracker, turn, viaDispatch } from "./mcpSessionHarness";

/**
 * A remote server that wants a sign-in (plan KI-Harness P4.5), through the
 * whole session: the real protocol client and the real session, a scripted
 * authorization server, and the scripted NATIVE side between them — the one
 * place a token exists.
 *
 * What these tests hold: the user signs in in a browser and nothing of what
 * came of it is on this side of the native boundary — not in the session's
 * state, not in a file of the app, not in a request to a model; a token that
 * ran out is renewed without the user; and where that cannot be done, a call
 * is not made and the model is told so in Plainva's words.
 */

async function withSignIn(script: EgressChunk[][], options: Partial<ScriptedOAuthOptions> = {}) {
  const oauth = scriptedMcpOAuth({ serverUrl: TRACKER_URL, dynamic: true, described: { scopes: ["issues:read"] }, ...options });
  const server = tracker();
  server.accepts = (token) => oauth.accepts(token);
  server.challenge = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"';
  const t = await mcpSession(script, { server, oauth });
  if (!(await t.s.mcp.addHttp("Tracker", TRACKER_URL, "", CONFIRM)).ok) throw new Error("the tracker was not added");
  return { ...t, oauth };
}

/** The line the server refused the look with. */
async function refusal(t: Awaited<ReturnType<typeof withSignIn>>): Promise<string | undefined> {
  const refused = (await t.s.mcp.inspect("tracker").catch((error: unknown) => error)) as McpError;
  expect(refused).toBeInstanceOf(McpError);
  expect(refused.failure).toMatchObject({ kind: "auth", status: 401 });
  return refused.failure.kind === "auth" ? refused.failure.challenge : undefined;
}

async function signIn(t: Awaited<ReturnType<typeof withSignIn>>): Promise<void> {
  const made = await t.s.mcp.signInPlan("tracker", await refusal(t));
  if (!made.ok) throw new Error(`no plan: ${made.problem}`);
  expect(await t.s.mcp.signIn("tracker", made.plan)).toEqual({ ok: true });
}

/** Signed in, approved as it lists itself, and used by this vault. */
async function connected(script: EgressChunk[][], options: Partial<ScriptedOAuthOptions> = {}) {
  const t = await withSignIn(script, options);
  await signIn(t);
  const look = await t.s.mcp.inspect("tracker");
  expect(await t.s.mcp.approve("tracker", look.listing)).toBe(true);
  await t.s.mcp.setVault("tracker", { enabled: true, grant: { ...EMPTY_MCP_GRANT, tools: ["search_issues"] } });
  return t;
}

/** Everything on the web view's side of the native boundary that could carry a credential. */
const thisSide = (t: Awaited<ReturnType<typeof withSignIn>>) => JSON.stringify([t.s.getState(), [...t.files.files.entries()], t.fake.sent, t.oauth.opened]);

describe("a server that wants a sign-in", () => {
  it("lists nothing until the user signed in — and then what it lists is reviewed like any other server's", async () => {
    const t = await withSignIn([]);
    const challenge = await refusal(t);
    expect(challenge).toContain("resource_metadata=");
    expect(await t.s.mcp.signInStatus("tracker")).toBeNull();

    const made = await t.s.mcp.signInPlan("tracker", challenge);
    expect(made).toEqual({ ok: true, plan: { issuer: "https://auth.example.com", host: "auth.example.com", scopes: ["issues:read"], resource: TRACKER_URL, client: "dynamic" } });
    if (!made.ok) return;
    expect(await t.s.mcp.signIn("tracker", made.plan)).toEqual({ ok: true });
    expect(await t.s.mcp.signInStatus("tracker")).toMatchObject({ issuer: "https://auth.example.com", scopes: ["issues:read"], signedIn: true, renewable: true });

    const look = await t.s.mcp.inspect("tracker");
    expect(look.listing.tools.map((tool) => tool.name)).toEqual(["search_issues", "close_issue"]);
    // Signed in is not approved: the sign-in opens the door, the review still decides what comes through it.
    expect(look.review.status).toBe("new");
    expect(await t.s.mcp.offeredNames()).toEqual([]);
  });

  it("keeps everything a token is or could be had with on the native side", async () => {
    const t = await connected([turn({ calls: [viaDispatch("c1", SEARCH, { query: "login" })] }), turn({ text: "Two issues." })]);
    answering(t.s, () => "once");
    expect(await t.s.send("Which issues mention the login?")).toEqual({ kind: "answered" });
    expect(t.server.calls).toEqual([{ name: "search_issues", args: { query: "login" } }]);

    const token = t.oauth.bearer("tracker")!;
    const verifier = t.oauth.tokenRequests[0]!.code_verifier!;
    const seen = thisSide(t);
    for (const secret of [token, "rt-1", verifier]) expect(seen).not.toContain(secret);
    // What the browser was opened at carries the challenge, never the verifier it was made of.
    expect(t.oauth.opened[0]).toContain("code_challenge=");
    // The requests this side wrote to the server name no credential at all.
    for (const port of t.native.ports.values()) {
      if ("requests" in port) for (const { request } of port.requests) expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain("authorization");
    }
  });

  it("asks for a token that is made out to this server, at the authorization server it named", async () => {
    const t = await withSignIn([]);
    await signIn(t);
    const asked = new URL(t.oauth.opened[0]!);
    expect(asked.origin + asked.pathname).toBe("https://auth.example.com/authorize");
    expect(asked.searchParams.get("resource")).toBe(TRACKER_URL);
    expect(asked.searchParams.get("scope")).toBe("issues:read");
    expect(asked.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43117/callback");
    expect(t.oauth.tokenRequests[0]).toMatchObject({ grant_type: "authorization_code", resource: TRACKER_URL, client_id: "dyn-1" });
    expect(t.oauth.registrations[0]).toMatchObject({ client_name: "Plainva", application_type: "native", token_endpoint_auth_method: "none" });
  });
});

describe("a sign-in that runs out", () => {
  it("renews itself: the call goes through, and the user is asked about the call and about nothing else", async () => {
    const t = await connected([turn({ calls: [viaDispatch("c1", SEARCH, { query: "login" })] }), turn({ text: "Two issues." })]);
    const first = t.oauth.bearer("tracker");
    t.oauth.expire();
    const questions = answering(t.s, () => "once");
    expect(await t.s.send("Which issues mention the login?")).toEqual({ kind: "answered" });
    expect(questions.map((question) => question.kind)).toEqual(["mcp"]);
    expect(t.server.calls).toEqual([{ name: "search_issues", args: { query: "login" } }]);
    expect(t.oauth.bearer("tracker")).not.toBe(first);
    expect(t.oauth.tokenRequests.map((request) => request.grant_type)).toEqual(["authorization_code", "refresh_token"]);
    expect(t.oauth.opened).toHaveLength(1);
    expect(thisSide(t)).not.toContain(t.oauth.bearer("tracker")!);
  });

  it("ends where nothing can renew it: the call is not made, the model is told so in Plainva's words, and the settings ask for a new sign-in", async () => {
    const t = await connected([turn({ calls: [viaDispatch("c1", SEARCH, { query: "login" })] }), turn({ text: "I could not reach the tracker." })]);
    t.oauth.revoke();
    const questions = answering(t.s, () => "once");
    expect(await t.s.send("Which issues mention the login?")).toEqual({ kind: "answered" });
    // Nothing was asked: a call that cannot be made is not offered for approval.
    expect(questions).toEqual([]);
    expect(t.server.calls).toEqual([]);
    const [result] = results(t.s.getState().active!);
    expect(result).toMatchObject({ isError: true, content: "The server wants a sign-in. The call was not made." });
    expect(body(t.fake.sent[1])).toContain("The server wants a sign-in.");
    expect(await t.s.mcp.signInStatus("tracker")).toMatchObject({ signedIn: false, renewable: false, client: true });
    // The approval stands: a new sign-in is all it takes.
    expect(t.s.getState().mcp.servers[0]!.review.status).toBe("approved");
    await signIn(t);
    expect(t.oauth.registrations).toHaveLength(1);
    expect((await t.s.mcp.check("tracker")).ok).toBe(true);
  });
});

describe("one credential per server", () => {
  it("a stored token ends the sign-in, a sign-in removes the stored token, and removing the server forgets both", async () => {
    const t = await withSignIn([]);
    await signIn(t);
    await t.s.mcp.setSecret("tracker", null, "personal-token");
    expect(await t.s.mcp.signInStatus("tracker")).toBeNull();
    expect(t.native.secrets.get("tracker")).toBe("personal-token");

    await signIn(t);
    expect(t.native.secrets.has("tracker")).toBe(false);
    expect(await t.s.mcp.signInStatus("tracker")).toMatchObject({ signedIn: true });

    await t.s.mcp.remove("tracker");
    expect(t.s.getState().mcp.servers).toEqual([]);
    await t.s.mcp.addHttp("Tracker", TRACKER_URL, "", CONFIRM);
    // The same name and the same address again: a new server, without the old one's sign-in.
    expect(await t.s.mcp.signInStatus("tracker")).toBeNull();
    await refusal(t);
  });

  it("signing out forgets the tokens and who Plainva was to the authorization server", async () => {
    const t = await withSignIn([]);
    await signIn(t);
    await t.s.mcp.signOut("tracker");
    expect(await t.s.mcp.signInStatus("tracker")).toBeNull();
    await refusal(t);
    await signIn(t);
    expect(t.oauth.registrations).toHaveLength(2);
  });
});

describe("a sign-in that does not happen", () => {
  it("says why: the user said no, the server offers none, or its sign-in is one Plainva does not do", async () => {
    const denied = await withSignIn([]);
    denied.oauth.consent = "deny";
    const made = await denied.s.mcp.signInPlan("tracker", await refusal(denied));
    if (!made.ok) throw new Error(made.problem);
    expect(await denied.s.mcp.signIn("tracker", made.plan)).toEqual({ ok: false, problem: "declined" });
    expect(await denied.s.mcp.signInStatus("tracker")).toBeNull();

    const none = await withSignIn([], { described: null });
    none.oauth.documents.clear();
    expect(await none.s.mcp.signInPlan("tracker", undefined)).toEqual({ ok: false, problem: "not-offered" });

    const weak = await withSignIn([], { pkce: false });
    expect(await weak.s.mcp.signInPlan("tracker", undefined)).toEqual({ ok: false, problem: "unsupported" });
  });

  it("is stopped by the user: nothing is kept, and an answer that comes late finds nothing", async () => {
    const t = await withSignIn([]);
    t.oauth.consent = "never";
    const made = await t.s.mcp.signInPlan("tracker", undefined);
    if (!made.ok) throw new Error(made.problem);
    const stop = new AbortController();
    const waiting = t.s.mcp.signIn("tracker", made.plan, undefined, stop.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort();
    expect(await waiting).toEqual({ ok: false, problem: "cancelled" });
    const state = new URL(t.oauth.opened[0]!).searchParams.get("state")!;
    expect(await t.s.mcp.finishSignIn({ state, code: "late" })).toBeNull();
    expect(await t.s.mcp.signInStatus("tracker")).toBeNull();
  });

  it("is ended by whoever gets the way back when nobody waited — a phone that was ended while the browser was open", async () => {
    const t = await withSignIn([]);
    t.oauth.consent = "never";
    const made = await t.s.mcp.signInPlan("tracker", undefined);
    if (!made.ok) throw new Error(made.problem);
    // The native side began; the app that waited is gone. What it kept is enough.
    const url = new URL(await t.native.native.oauth.begin("tracker", { issuer: made.plan.issuer, scopes: made.plan.scopes, resource: made.plan.resource, client: { kind: "dynamic" }, clientName: "Plainva", redirectPort: 43117 }));
    t.oauth.consent = "allow";
    await t.oauth.browser.open(url.toString());
    const came = await t.oauth.browser.wait();
    expect(await t.s.mcp.finishSignIn(came)).toBe("Tracker");
    expect(await t.s.mcp.signInStatus("tracker")).toMatchObject({ signedIn: true });
    expect((await t.s.mcp.inspect("tracker")).listing.tools).toHaveLength(2);
  });
});
