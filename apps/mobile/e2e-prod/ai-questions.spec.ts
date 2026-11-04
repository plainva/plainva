import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * A foreign server's questions to the user on the phone (AI harness P9-4a):
 * the same card as on the desktop, above the composer — a form, a page to
 * open, and a question for a key that Plainva blocks. The answer goes to the
 * server and to no model; a page opens in the system's browser view, never
 * in the app's web view, and only on the user's tap.
 *
 * The request to a server and the request to a model are native plugins
 * (`AiMcp`, `AiNet`), which a browser does not have; this test stands in for
 * both at the plugin headers, as `ai-external-tools.spec.ts` does, and for
 * the system's browser at `window.open` — where the browser plugin hands a
 * web build's page.
 */

const ADDRESS = "https://tracker.example.com/mcp";
const SEARCH = "mcp_tracker_search_issues";
const PAGE = "https://tracker.example.com/connect/github?state=7f3a";

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
  calls: { query: string; offered: unknown; answers: unknown; state: unknown }[];
  requests: string[];
  opened: string[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, page }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
      const seam: Seam = { registry: [], calls: [], requests: [], opened: [] };
      (globalThis as SeamGlobals).__seam = seam;
      // The system's browser view, as a web build reaches it: what was opened, and nothing else happens.
      window.open = ((url?: string | URL) => {
        seam.opened.push(String(url));
        return null;
      }) as typeof window.open;
      const tools = [{ name: "search_issues", title: "Search issues", description: "Searches the tracker's issues.", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } }];
      const asks: Record<string, unknown> = {
        mixing: {
          mode: "form",
          message: "Which project should I search?",
          requestedSchema: { type: "object", properties: { project: { type: "string", title: "Project", oneOf: [{ const: "hk", title: "Hafenkante" }, { const: "ws", title: "Werkstatt" }] } }, required: ["project"] },
        },
        github: { mode: "url", message: "Connect your GitHub account.", url: page, elicitationId: "e-1" },
        private: { mode: "form", message: "One more thing.", requestedSchema: { type: "object", properties: { value: { type: "string", title: "GitHub access token" } } } },
      };
      const promise = (name: string) => ({ name, rtype: "promise" });
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [
          { name: "AiMcp", methods: [...["servers", "addServer", "removeServer", "setSecret", "hasSecret", "deleteSecret", "cancel"].map(promise), { name: "request", rtype: "callback" }] },
          { name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint"].map(promise), { name: "request", rtype: "callback" }] },
        ],
        async nativePromise(plugin: string, method: string, options: Record<string, string>) {
          if (plugin === "AiNet") return method === "hasKey" ? { present: true } : method === "addEndpoint" ? { added: true } : {};
          if (method === "servers") return { servers: seam.registry };
          if (method === "addServer") {
            seam.registry.push({ id: options.serverId!, kind: "http", url: options.url!, args: [], env: [], sandbox: false, stored: [] });
            return { added: true };
          }
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
          const message = JSON.parse(String(options.body)) as { id: number; method: string; params: { name: string; arguments: { query: string }; inputResponses?: unknown; requestState?: string; _meta?: Record<string, unknown> } };
          const answer = (status: number, payload: object) => send([{ type: "open", status, contentType: "application/json" }, { type: "data", text: JSON.stringify({ jsonrpc: "2.0", id: message.id, ...payload }) }, { type: "done" }]);
          const result = (value: object) => answer(200, { result: { resultType: "complete", ...value } });
          if (message.method === "server/discover") result({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "Tracker MCP", version: "1.0.0" } } });
          else if (message.method === "tools/list") result({ tools });
          else if (message.method === "prompts/list") result({ prompts: [] });
          else if (message.method === "tools/call") {
            const query = message.params.arguments.query;
            seam.calls.push({ query, offered: message.params._meta?.["io.modelcontextprotocol/clientCapabilities"], answers: message.params.inputResponses ?? null, state: message.params.requestState ?? null });
            // The first time it asks; the second time, with the answers, it answers.
            if (!message.params.inputResponses) result({ resultType: "input_required", requestState: `state-${query}`, inputRequests: { q: { method: "elicitation/create", params: asks[query] } } });
            else result({ content: [{ type: "text", text: `Done: ${query}.` }] });
          } else answer(404, { error: { code: -32601, message: "Method not found" } });
          return Promise.resolve("mcp");
        },
      };
    },
    { script, page: PAGE },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

test("a server the vault lets ask asks on the phone through Plainva's card — a form, a page to open, and a question for a key Plainva blocks", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [
    calls("call-1", "call_tool", { name: SEARCH, args: { query: "mixing" } }),
    says("Two mixing issues are open."),
    calls("call-2", "call_tool", { name: SEARCH, args: { query: "github" } }),
    says("GitHub is connected now."),
    calls("call-3", "call_tool", { name: SEARCH, args: { query: "private" } }),
    says("The tracker could not reach GitHub without a key."),
  ]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  try {
    await openApp(page);
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();

    // 1. The review: questions to the user are off until the vault says otherwise, for this server alone.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByTestId("settings-ai-ext-add").click();
    const add = page.getByTestId("ai-ext-add");
    await add.getByTestId("ai-ext-add-name").fill("Tracker");
    await add.getByTestId("ai-ext-add-url").fill(ADDRESS);
    await add.getByTestId("ai-ext-add-submit").click();
    const review = page.getByTestId("ai-ext-review");
    await review.getByTestId("ai-ext-tool").first().check();
    const questions = review.getByTestId("ai-ext-questions");
    await expect(questions).not.toBeChecked();
    await questions.check();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-question-setting-mobile.png") });
    await review.getByTestId("ai-ext-approve").click();
    await expect(review).toHaveCount(0);

    // 2. A form: the call is asked first, as every call; then the server's question is Plainva's card, its words a quote.
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await conversation.getByTestId("ai-input").fill("Which mixing issues are open?");
    await conversation.getByTestId("ai-send").click();
    await conversation.getByTestId("ai-consent-send").click();
    await conversation.getByTestId("ai-effect-once").click();
    const card = conversation.getByTestId("ai-question");
    await expect(card).toHaveAttribute("data-kind", "form");
    await expect(card).toHaveClass(/pv-ai-overview--touch/);
    await expect(card.locator("h4")).toHaveText("Tracker has a question");
    await expect(card.getByTestId("ai-question-said")).toContainText("Which project should I search?");
    await card.locator('[data-name="project"] [data-testid="ai-question-input"]').click();
    await page.getByRole("option", { name: "Werkstatt" }).click();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-question-form-mobile.png") });
    await card.getByTestId("ai-question-answer").click();
    await expect(conversation.getByText("Two mixing issues are open.")).toBeVisible();
    let state = await seam();
    expect(state.calls.map((call) => call.offered)).toEqual([{ elicitation: { form: {}, url: {} } }, { elicitation: { form: {}, url: {} } }]);
    expect(state.calls[1]).toMatchObject({ state: "state-mixing", answers: { q: { action: "accept", content: { project: "ws" } } } });
    const toModel = state.requests.join("\n");
    expect(toModel).toContain("Done: mixing.");
    expect(toModel).not.toContain("Which project should I search");
    expect(toModel).not.toContain("Werkstatt");

    // 3. A page: shown whole with its host apart, opened only on the tap — in the system's browser view — and the
    //    server hears yes only on Continue.
    await conversation.getByTestId("ai-input").fill("Connect GitHub.");
    await conversation.getByTestId("ai-send").click();
    await conversation.getByTestId("ai-effect-once").click();
    await expect(card).toHaveAttribute("data-kind", "url");
    await expect(card.getByTestId("ai-question-host")).toHaveText("tracker.example.com");
    expect((await seam()).opened).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-question-page-mobile.png") });
    await card.getByTestId("ai-question-open").click();
    await expect(card).toHaveAttribute("data-opened", "true");
    expect((await seam()).opened).toEqual([PAGE]);
    await card.getByTestId("ai-question-continue").click();
    await expect(conversation.getByText("GitHub is connected now.")).toBeVisible();
    expect((await seam()).calls[3]).toMatchObject({ query: "github", answers: { q: { action: "accept" } } });

    // 4. A question for a key: not shown as a question.
    await conversation.getByTestId("ai-input").fill("And the private issues?");
    await conversation.getByTestId("ai-send").click();
    await conversation.getByTestId("ai-effect-once").click();
    await expect(card).toHaveAttribute("data-kind", "refused");
    await expect(card.getByTestId("ai-question-why")).toContainText("GitHub access token");
    await expect(card.locator("input")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-question-refused-mobile.png") });
    await card.getByTestId("ai-question-close").click();
    await expect(conversation.getByText("The tracker could not reach GitHub without a key.")).toBeVisible();
    state = await seam();
    expect(state.calls[5]).toMatchObject({ query: "private", answers: { q: { action: "decline" } } });
  } finally {
    await sql.close();
  }
});
