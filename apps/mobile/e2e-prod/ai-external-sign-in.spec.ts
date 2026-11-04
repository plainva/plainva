import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Signing in to a remote MCP server on the phone (AI harness P4.5): a server
 * that takes nothing without a sign-in says so in its review; the user signs
 * in in the browser and comes back through the app's own address; and what
 * comes of it never reaches the page.
 *
 * The sign-in itself is native (`AiMcpAuth`), and so are the request to the
 * server (`AiMcp`) and the browser (`Browser`). This test stands in for the
 * three at the one seam Capacitor offers — the plugin headers a native shell
 * announces — and it answers what the plugin answers: a document, what an
 * authorization server offers, an address to open, the id of a server. So
 * everything above the seam is the app's own code: the bridge, the steps of
 * the sign-in, the way back through the app's URL routes, the sheet. What
 * the plugin itself decides is held by the rule tests of both platforms.
 */

const ADDRESS = "https://tracker.example.com/mcp";
const WAY_BACK = "com.plainva.app://mcp/oauth";

interface Seam {
  registry: { id: string; kind: string; url: string; args: string[]; env: string[]; sandbox: boolean; stored: string[] }[];
  asked: string[];
  begun: Record<string, unknown>[];
  opened: string[];
  finished: Record<string, unknown>[];
  /** The state of a sign-in the plugin began and kept. */
  pending: string | null;
  signedIn: boolean;
  client: boolean;
}
type SeamGlobals = typeof globalThis & { __seam: Seam; Capacitor: { Plugins: { App: { notifyListeners(event: string, data: unknown): Promise<void> } } } };

test("a server that wants a sign-in is signed in to in the browser, and comes back through the app's own address", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
    const seam: Seam = { registry: [], asked: [], begun: [], opened: [], finished: [], pending: null, signedIn: false, client: false };
    (globalThis as SeamGlobals).__seam = seam;
    const promise = (name: string) => ({ name, rtype: "promise" });
    const callback = (name: string) => ({ name, rtype: "callback" });
    (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
      PluginHeaders: [
        { name: "AiMcp", methods: [...["servers", "addServer", "removeServer", "setSecret", "hasSecret", "deleteSecret", "cancel"].map(promise), callback("request")] },
        { name: "AiMcpAuth", methods: ["document", "issuer", "begin", "finish", "cancel", "renew", "status", "signOut"].map(promise) },
        { name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint"].map(promise), callback("request")] },
        { name: "Browser", methods: [promise("open"), promise("close"), callback("addListener"), callback("removeListener"), promise("removeAllListeners")] },
      ],
      async nativePromise(plugin: string, method: string, options: Record<string, unknown>) {
        if (plugin === "AiNet") return method === "hasKey" ? { present: true } : method === "addEndpoint" ? { added: true } : {};
        if (plugin === "Browser") {
          if (method === "open") seam.opened.push(String(options.url));
          return {};
        }
        if (plugin === "AiMcpAuth") {
          // What the plugin answers: a document, what an authorization server offers, an address to open, a server's id — never a token.
          if (method === "status") return { status: seam.client ? { issuer: "https://auth.example.com", scopes: ["issues:read"], expiresAt: null, signedIn: seam.signedIn, renewable: seam.signedIn, client: true } : null };
          if (method === "renew") return { renewed: false };
          if (method === "document") {
            seam.asked.push(String(options.url));
            return { status: 200, body: JSON.stringify({ resource: "https://tracker.example.com/mcp", authorization_servers: ["https://auth.example.com"], scopes_supported: ["issues:read"] }) };
          }
          if (method === "issuer") {
            seam.asked.push(String(options.url));
            return { issuer: { issuer: options.issuer, document: false, dynamic: true, iss: false, scopes: [] } };
          }
          if (method === "begin") {
            seam.begun.push(options);
            seam.pending = "s1";
            return { url: "https://auth.example.com/authorize?response_type=code&state=s1&code_challenge=abc" };
          }
          if (method === "finish") {
            seam.finished.push(options);
            if (!seam.pending || options.state !== seam.pending || !options.code) throw new Error("oauth-no-flow");
            seam.pending = null;
            seam.signedIn = true;
            seam.client = true;
            return { serverId: "tracker" };
          }
          if (method === "cancel") seam.pending = null;
          if (method === "signOut") {
            seam.signedIn = false;
            seam.client = false;
          }
          return {};
        }
        if (method === "servers") return { servers: seam.registry };
        if (method === "addServer") {
          seam.registry.push({ id: String(options.serverId), kind: "http", url: String(options.url), args: [], env: [], sandbox: false, stored: [] });
          return { added: true };
        }
        if (method === "hasSecret") return { present: false };
        return {};
      },
      nativeCallback(plugin: string, _method: string, options: { body: unknown }, answer: (chunk: unknown) => void) {
        // The browser tells nobody that it closed: the way back is what ends the wait.
        if (plugin === "Browser") return Promise.resolve("listener");
        const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => answer(chunk)));
        if (plugin === "AiNet") {
          send([{ type: "failed", code: "network", message: "offline" }]);
          return Promise.resolve("ai");
        }
        // The server takes nothing without a sign-in, and says where its sign-in is described.
        if (!seam.signedIn) {
          send([{ type: "open", status: 401, contentType: "text/plain", challenge: 'Bearer resource_metadata="https://tracker.example.com/.well-known/oauth-protected-resource/mcp"' }, { type: "done" }]);
          return Promise.resolve("mcp");
        }
        const message = JSON.parse(String(options.body)) as { id: number; method: string };
        const result = (value: object) => send([{ type: "open", status: 200, contentType: "application/json" }, { type: "data", text: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resultType: "complete", ...value } }) }, { type: "done" }]);
        if (message.method === "server/discover") result({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "Tracker MCP", version: "1.2.0" } } });
        else if (message.method === "tools/list") result({ tools: [{ name: "search_issues", description: "Searches the tracker's issues.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] });
        else result({ prompts: [] });
        return Promise.resolve("mcp");
      },
    };
  });
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  /** The system hands the app a URL on its own scheme — as it does when the browser comes back. */
  const arrives = (url: string) => page.evaluate((address) => (globalThis as SeamGlobals).Capacitor.Plugins.App.notifyListeners("appUrlOpen", { url: address }), url);
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // 1. A server is added. Its review cannot show what it lists: the server wants a sign-in, and the review says so.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByTestId("settings-ai-ext-add").click();
    const add = page.getByTestId("ai-ext-add");
    await add.getByTestId("ai-ext-add-name").fill("Tracker");
    await add.getByTestId("ai-ext-add-url").fill(ADDRESS);
    await add.getByTestId("ai-ext-add-submit").click();
    const review = page.getByTestId("ai-ext-review");
    await expect(review.getByTestId("ai-ext-failure")).toHaveText("The server asks for a sign-in.");
    await expect(review.getByTestId("ai-ext-signin-status")).toHaveText("Not signed in");
    await expect(review.getByTestId("ai-ext-tool")).toHaveCount(0);

    // 2. Signing in: the app asks where the sign-in lives, the plugin begins, and the browser opens at the address the plugin built.
    await review.getByTestId("ai-ext-signin").click();
    await expect(review.getByTestId("ai-ext-signin-waiting")).toHaveText("Finish the sign-in in your browser, at auth.example.com. Plainva waits here.");
    await expect.poll(async () => (await seam()).opened.length).toBe(1);
    let now = await seam();
    expect(now.asked).toEqual(["https://tracker.example.com/.well-known/oauth-protected-resource/mcp", "https://auth.example.com/.well-known/oauth-authorization-server"]);
    // A phone names no port: the way back is the app's own address, and the plugin knows it.
    expect(now.begun).toEqual([{ serverId: "tracker", issuer: "https://auth.example.com", scopes: ["issues:read"], resource: ADDRESS, clientKind: "dynamic", clientId: "", clientName: "Plainva" }]);
    expect(now.opened).toEqual(["https://auth.example.com/authorize?response_type=code&state=s1&code_challenge=abc"]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-ext-signin-waiting-mobile.png") });

    // 3. A URL of the app that is none of the sign-in's changes nothing; the way back ends the wait.
    await arrives("com.plainva.app://mcp/other?code=c1&state=s1");
    await expect(review.getByTestId("ai-ext-signin-waiting")).toBeVisible();
    expect((await seam()).finished).toEqual([]);
    await arrives(`${WAY_BACK}?code=c1&state=s1`);
    await expect(review.getByTestId("ai-ext-tool")).toHaveCount(1);
    await expect(review.getByTestId("ai-ext-signin-status")).toHaveText("Signed in at auth.example.com");
    await expect(review.getByTestId("ai-ext-failure")).toHaveCount(0);
    now = await seam();
    expect(now.finished).toEqual([{ state: "s1", code: "c1" }]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-ext-signed-in-mobile.png") });

    // 4. Signing out: the server is asked again, and refuses.
    await review.getByTestId("ai-ext-signout").click();
    await expect(review.getByTestId("ai-ext-signin-status")).toHaveText("Not signed in");

    // 5. The way back arrives while nobody waits — the system ended the app while the browser was open. An answer to
    //    nothing that was begun is said to be none; one to what the plugin kept ends the sign-in.
    await arrives(`${WAY_BACK}?code=c8&state=nobody`);
    await expect(page.getByText("The sign-in was not finished.")).toBeVisible();
    await page.evaluate(() => {
      (globalThis as SeamGlobals).__seam.pending = "s2";
    });
    await arrives(`${WAY_BACK}?code=c2&state=s2`);
    await expect(page.getByText("Signed in to Tracker.")).toBeVisible();
    expect((await seam()).signedIn).toBe(true);
  } finally {
    await sql.close();
  }
});
