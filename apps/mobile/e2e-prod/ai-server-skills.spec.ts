import { createHash } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Skills a connected server serves, on the phone (AI harness P9-4b, MCP
 * skills extension): the desktop's workshop group "From servers" in the
 * phone's grammar, the review as a sheet — its server, the key the AI loads
 * it by, the server's words as its quote, every file with its digest, and
 * its instructions read only on the tap, checked — and a conversation that
 * loads the approved skill and its file, each checked against the manifest.
 *
 * The request to a server and the request to a model are native plugins
 * (`AiMcp`, `AiNet`), which a browser does not have; this test stands in for
 * both at the plugin headers, as `ai-questions.spec.ts` does.
 */

const ADDRESS = "https://tracker.example.com/mcp";
const MAIN = "---\nname: code-review\ndescription: Review code using the team's checklist.\n---\n\n# Code review\n\nRead `references/checklist.md`, then review the diff.\n";
const CHECKLIST = "# Review checklist\n\nCheck correctness, tests, and compatibility.\n";
const FILES: Record<string, string> = { "SKILL.md": MAIN, "references/checklist.md": CHECKLIST };
const MANIFEST = Object.entries(FILES).map(([path, text]) => ({ uri: `skill://code-review/${path}`, digest: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`, size: Buffer.byteLength(text, "utf8") }));

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
  methods: string[];
  reads: string[];
  requests: string[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, files, manifest }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
      const seam: Seam = { registry: [], methods: [], reads: [], requests: [] };
      (globalThis as SeamGlobals).__seam = seam;
      const tools = [{ name: "search_issues", title: "Search issues", description: "Searches the tracker's issues.", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } }];
      const entry = { uri: "skill://code-review/SKILL.md", frontmatter: { name: "code-review", description: "Review code using the team's checklist." }, resources: manifest };
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
          const message = JSON.parse(String(options.body)) as { id: number; method: string; params: { uri?: string } };
          seam.methods.push(message.method);
          const answer = (status: number, payload: object) => send([{ type: "open", status, contentType: "application/json" }, { type: "data", text: JSON.stringify({ jsonrpc: "2.0", id: message.id, ...payload }) }, { type: "done" }]);
          const result = (value: object) => answer(200, { result: { resultType: "complete", ...value } });
          if (message.method === "server/discover")
            result({ supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "Tracker MCP", version: "1.0.0" } } });
          else if (message.method === "tools/list") result({ tools });
          else if (message.method === "prompts/list") result({ prompts: [] });
          else if (message.method === "skills/list") result({ skills: [entry], ttlMs: 0, cacheScope: "private" });
          else if (message.method === "resources/read") {
            const uri = message.params.uri ?? "";
            seam.reads.push(uri);
            const text = uri.startsWith("skill://code-review/") ? files[uri.slice("skill://code-review/".length)] : undefined;
            if (text === undefined) answer(200, { error: { code: -32602, message: "Unknown resource" } });
            else result({ contents: [{ uri, mimeType: "text/markdown", text }], ttlMs: 0, cacheScope: "private" });
          } else answer(404, { error: { code: -32601, message: "Method not found" } });
          return Promise.resolve("mcp");
        },
      };
    },
    { script, files: FILES, manifest: MANIFEST },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

test("a server's skill on the phone waits under From servers, is approved for exactly its files after a look at its instructions, and loads checked", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [calls("call-1", "use_skill", { name: "mcp_tracker/code-review" }), calls("call-2", "use_skill", { name: "mcp_tracker/code-review", file: "references/checklist.md" }), says("Three points of the checklist stand out.")]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  try {
    await openApp(page);
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();

    // 1. The review counts the skills the server serves; nothing of them is read.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByTestId("settings-ai-ext-add").click();
    const add = page.getByTestId("ai-ext-add");
    await add.getByTestId("ai-ext-add-name").fill("Tracker");
    await add.getByTestId("ai-ext-add-url").fill(ADDRESS);
    await add.getByTestId("ai-ext-add-submit").click();
    const review = page.getByTestId("ai-ext-review");
    await expect(review.getByTestId("ai-ext-skills")).toHaveText("It serves 1 skill. You approve each one under AI → Skills, “From servers”.");
    await review.getByTestId("ai-ext-tool").first().check();
    await review.getByTestId("ai-ext-approve").click();
    await expect(review).toHaveCount(0);
    expect((await seam()).reads).toEqual([]);

    // 2. The workshop: the skill waits in its server's group.
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    await page.getByTestId("ai-history-skills").click();
    const workshop = page.getByTestId("ai-skills-workshop");
    await expect(workshop).toBeVisible();
    const waiting = workshop.getByTestId("ai-server-skill-review");
    await expect(waiting).toHaveCount(1);
    await expect(waiting).toContainText("code-review");
    await expect(waiting).toContainText("Tracker · new · 2 files");
    await expect(workshop.getByTestId("ai-server-skills-refresh")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-server-skill-workshop-mobile.png") });

    // 3. The review sheet: its server, its key, the server's words as its quote, the files with their digests; the
    //    instructions read only on the tap.
    await waiting.click();
    const approval = page.getByTestId("ai-skill-approval");
    await expect(approval).toContainText("Approve a skill of Tracker?");
    await expect(approval.getByTestId("ai-server-skill-facts")).toContainText("Tracker · tracker.example.com");
    await expect(approval).toContainText("mcp_tracker/code-review");
    await expect(approval.getByTestId("ai-server-skill-said")).toContainText("Review code using the team's checklist.");
    await expect(approval.getByTestId("ai-skill-files")).toContainText(MANIFEST[0]!.digest.slice(7, 14));
    expect((await seam()).reads).toEqual([]);
    await approval.getByTestId("ai-server-skill-view").click();
    await expect(approval.getByTestId("ai-skill-text")).toContainText("Read `references/checklist.md`, then review the diff.");
    // Each file a model may read of it is shown too, checked.
    await expect(approval.getByTestId("ai-server-skill-file")).toContainText("references/checklist.md");
    await expect(approval.getByTestId("ai-server-skill-file")).toContainText("Check correctness, tests, and compatibility.");
    expect((await seam()).reads).toEqual(["skill://code-review/SKILL.md", "skill://code-review/references/checklist.md"]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-server-skill-review-mobile.png") });
    await approval.getByTestId("ai-skill-approve").click();
    await expect(approval).toHaveCount(0);
    await expect(waiting).toHaveCount(0);
    await expect(workshop.getByTestId("ai-skill-row").filter({ hasText: "code-review" })).toHaveCount(1);

    // 4. A conversation: the catalog carries the skill in its own fence; the model loads it and its file, each checked.
    await back();
    const conversation = page.getByTestId("ai-conversation");
    await conversation.getByTestId("ai-input").fill("Review yesterday's diff.");
    await conversation.getByTestId("ai-send").click();
    await conversation.getByTestId("ai-consent-send").click();
    await expect(conversation.getByText("Three points of the checklist stand out.")).toBeVisible();
    const state = await seam();
    expect(state.requests[0]).toContain("<server_skills>");
    expect(state.requests[0]).toContain("mcp_tracker/code-review");
    expect(state.requests[1]).toContain('origin=\\"server\\" server=\\"tracker\\"');
    expect(state.requests[2]).toContain("Check correctness, tests, and compatibility.");
    expect(state.reads).toEqual(["skill://code-review/SKILL.md", "skill://code-review/references/checklist.md"]);
  } finally {
    await sql.close();
  }
});
