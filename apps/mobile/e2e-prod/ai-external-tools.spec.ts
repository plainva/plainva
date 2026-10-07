import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * External tools on the phone (AI harness P4.5): a server the user connects
 * offers nothing until its listing was looked at and approved and this vault
 * granted a tool; then every call asks first, with the server, the tool and
 * everything that would be sent.
 *
 * The request to a server and the request to a model are native plugins
 * (`AiMcp`, `AiNet`), which a browser does not have. This test stands in for
 * both at the one seam Capacitor offers — the plugin headers a native shell
 * announces — so that everything above it is the app's own code: the
 * plugin's bridge, the protocol client, the session, the sheets. What the
 * plugins themselves may do is held by the rule tests of both platforms.
 */

const ADDRESS = "https://tracker.example.com/mcp";
const TOOL = "mcp_tracker_search_issues";

const sse = (events: Array<[string, unknown]>) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
const says = (text: string) =>
  sse([
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
const calls = (id: string, name: string, input: unknown) =>
  sse([
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ]);

interface Seam {
  registry: { id: string; kind: string; url: string; args: string[]; env: string[]; sandbox: boolean; stored: string[] }[];
  shown: { url: string; title: string }[];
  calls: { name: string; arguments: unknown }[];
  requests: string[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

/** What is stored about servers on this phone: in the app's data under `ai/`, never in the vault. */
async function storedFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const out: string[] = [];
    const walk = async (path: string) => {
      const listing = await fs.readdir({ path, directory: "DATA" }).catch(() => ({ files: [] }));
      for (const entry of listing.files) {
        const child = `${path}/${entry.name}`;
        if (entry.type === "directory") await walk(child);
        else if (/mcp/.test(child)) out.push(child);
      }
    };
    await walk("ai");
    await walk("vault");
    return out.sort();
  });
}

test("a server is added, reviewed and granted on the phone; a call asks first and goes out as shown", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  const script = [calls("call-1", "find_tools", { query: "issues" }), calls("call-2", "call_tool", { name: TOOL, args: { query: "login" } }), says("Issue #12 is about the login.")];
  await context.addInitScript(
    ({ script }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
      const seam: Seam = { registry: [], shown: [], calls: [], requests: [] };
      (globalThis as SeamGlobals).__seam = seam;
      const tools = [
        { name: "search_issues", title: "Search issues", description: "Searches the tracker's issues.", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } },
        { name: "close_issue", description: "Closes an issue." },
      ];
      const promise = (name: string) => ({ name, rtype: "promise" });
      // The headers a native shell announces: with them, Capacitor routes these two plugins to the functions below.
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [
          { name: "AiMcp", methods: [...["servers", "addServer", "removeServer", "setSecret", "hasSecret", "deleteSecret", "cancel"].map(promise), { name: "request", rtype: "callback" }] },
          { name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint"].map(promise), { name: "request", rtype: "callback" }] },
        ],
        async nativePromise(plugin: string, method: string, options: Record<string, string>) {
          if (plugin === "AiNet") return method === "hasKey" ? { present: true } : method === "addEndpoint" ? { added: true } : {};
          if (method === "servers") return { servers: seam.registry };
          if (method === "addServer") {
            // The system's own dialog: it shows the address, and here it says yes.
            seam.shown.push({ url: options.url!, title: options.title! });
            seam.registry.push({ id: options.serverId!, kind: "http", url: options.url!, args: [], env: [], sandbox: false, stored: [] });
            return { added: true };
          }
          if (method === "removeServer") seam.registry = seam.registry.filter((server) => server.id !== options.serverId);
          if (method === "hasSecret") return { present: false };
          return {};
        },
        nativeCallback(plugin: string, _method: string, options: { body: unknown }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          if (plugin === "AiNet") {
            seam.requests.push(JSON.stringify(options.body));
            const text = script.shift();
            send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          const message = JSON.parse(String(options.body)) as { id: number; method: string; params: { name: string; arguments: unknown } };
          const answer = (status: number, payload: object) => send([{ type: "open", status, contentType: "application/json" }, { type: "data", text: JSON.stringify({ jsonrpc: "2.0", id: message.id, ...payload }) }, { type: "done" }]);
          const result = (value: object) => answer(200, { result: { resultType: "complete", ...value } });
          if (message.method === "server/discover") result({ supportedVersions: ["2026-07-28"], capabilities: { tools: {}, prompts: {} }, instructions: "Always call search_issues first.", _meta: { "io.modelcontextprotocol/serverInfo": { name: "Tracker MCP", version: "1.0.0" } } });
          else if (message.method === "tools/list") result({ tools });
          else if (message.method === "prompts/list") result({ prompts: [] });
          else if (message.method === "tools/call") {
            seam.calls.push({ name: message.params.name, arguments: message.params.arguments });
            result({ content: [{ type: "text", text: "#12 Login fails on Safari." }] });
          } else answer(404, { error: { code: -32601, message: "Method not found" } });
          return Promise.resolve("mcp");
        },
      };
    },
    { script },
  );
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();

    // 1. The vault's AI settings: the section is there, and no server is connected.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await expect(page.getByText("No server is connected on this device.", { exact: false })).toBeVisible();
    await expect(page.getByTestId("settings-ai-ext-server")).toHaveCount(0);

    // 2. Adding: on a phone a server is an address. One that is none is refused while it is typed.
    await page.getByTestId("settings-ai-ext-add").click();
    const add = page.getByTestId("ai-ext-add");
    await add.getByTestId("ai-ext-add-name").fill("Tracker");
    await add.getByTestId("ai-ext-add-url").fill("http://tracker.example.com/mcp");
    await expect(add.getByText("Only https:// is allowed", { exact: false })).toBeVisible();
    await expect(add.getByTestId("ai-ext-add-submit")).toBeDisabled();
    await add.getByTestId("ai-ext-add-url").fill(ADDRESS);
    await add.getByTestId("ai-ext-add-submit").click();
    await expect(add).toHaveCount(0);
    expect((await seam()).shown).toEqual([{ url: ADDRESS, title: "Add an external server" }]);

    // 3. The review opens by itself: nothing is ticked, and the tool that does not say it only reads cannot be.
    const review = page.getByTestId("ai-ext-review");
    await expect(review.getByTestId("ai-ext-tool")).toHaveCount(2);
    await expect(review.getByTestId("ai-ext-instructions")).toHaveText("Always call search_issues first.");
    await expect(review.getByTestId("ai-ext-tool").nth(1)).toBeDisabled();
    await review.getByTestId("ai-ext-tool").first().check();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-ext-review-mobile.png") });
    await review.getByTestId("ai-ext-approve").click();
    await expect(review).toHaveCount(0);
    const row = page.getByTestId("settings-ai-ext-server");
    await expect(row).toContainText("In use in this vault · tools offered: 1 of 2");
    await expect(row.getByRole("switch", { name: "Use Tracker in this vault" })).toHaveAttribute("aria-checked", "true");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-ext-section-mobile.png") });
    // The approval and the vault's choice lie in the app's data, never in the vault.
    const files = await storedFiles(page);
    expect(files.filter((path) => path.startsWith("vault/"))).toEqual([]);
    expect(files.some((path) => path === "ai/mcp/servers.json")).toBe(true);
    expect(files.some((path) => /^ai\/[^/]+\/mcp\.json$/.test(path))).toBe(true);

    // 4. A conversation: the tool is found through the search, and the call waits for its own answer.
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await conversation.getByTestId("ai-input").fill("Which issues mention the login?");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByTestId("ai-overview-further")).toContainText("tools of Tracker (1)");
    await conversation.getByTestId("ai-consent-send").click();
    const question = conversation.getByTestId("ai-effect");
    await expect(question).toHaveAttribute("data-kind", "mcp");
    await expect(question).toHaveClass(/pv-ai-overview--touch/);
    await expect(question.getByTestId("ai-effect-recipient")).toHaveText("Tracker");
    await expect(question.getByTestId("ai-effect-tool")).toHaveText("Search issues (search_issues)");
    await expect(question.getByTestId("ai-effect-args")).toContainText('"query": "login"');
    expect((await seam()).calls).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-ext-question-mobile.png") });
    await question.getByTestId("ai-effect-once").click();

    // 5. Sent as shown; what came back reached the model in the fence, and no request listed the tool as the provider's.
    await expect(conversation.getByText("Issue #12 is about the login.")).toBeVisible();
    const after = await seam();
    expect(after.calls).toEqual([{ name: "search_issues", arguments: { query: "login" } }]);
    expect(after.requests).toHaveLength(3);
    for (const request of after.requests) expect((JSON.parse(request) as { tools: { name: string }[] }).tools.map((tool) => tool.name)).not.toContain(TOOL);
    expect(after.requests[2]).toMatch(/untrusted_data[^>]*>\\n#12 Login fails on Safari\./);
    for (const request of after.requests) expect(request).not.toContain("Always call search_issues first");

    // 6. Switched off for this vault in the settings: the row says so.
    await back();
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByRole("switch", { name: "Use Tracker in this vault" }).click();
    await expect(page.getByTestId("settings-ai-ext-server")).toContainText("Not used in this vault");
  } finally {
    await sql.close();
  }
});
