import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory } from "./exampleVault";

/**
 * A look back on the phone (AI harness P9-1), in the production bundle: the
 * skill "History analysis" started from the skills of the conversations
 * screen, a model that asks `get_changes` once, and what the phone answers
 * from its own index — the real one, behind the SQL bridge — and its version
 * history: a note made in this run is new, shown by its beginning; what its
 * properties say is no line of it.
 *
 * The model is the native `AiNet` plugin, which a browser does not have. This
 * test stands in for it at the seam Capacitor offers, as a server under the
 * phone's own address (as `ai-routines.spec.ts` does): it keeps every request
 * with the tools it offered and what it said, and answers from a script.
 */

interface Seam {
  requests: { endpoint: string; tools: string[]; said: string }[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

const MODEL = "granite3.3:8b";
const SERVER = "localhost:8080";
const NOTE = "---\nmood: 2\n---\n# Example\n\nMonday at ten, with Tom.\n";
const ANSWER = "This week the kick-off for Monday was planned in [[Example]].";

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) =>
  `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;
const calls = (name: string, args: unknown) =>
  `${chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 20 } })}data: [DONE]\n\n`;

/** A local day `offset` days from today, as the tools take it. */
const dayKey = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, model, server }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // The AI is on, and the profile new conversations start with names a model on a server of this phone.
      if (!localStorage.getItem("CapacitorStorage.ai")) {
        localStorage.setItem(
          "CapacitorStorage.ai",
          JSON.stringify({
            enabled: true,
            providers: [],
            custom: [{ id: "custom-1", label: server, baseUrl: `http://${server}/v1`, api: "openai-chat", local: true }],
            profiles: { balanced: { providerId: "custom-1", model }, local: { providerId: "custom-1", model } },
          }),
        );
      }
      const seam: Seam = { requests: [] };
      (globalThis as SeamGlobals).__seam = seam;
      const promise = (name: string) => ({ name, rtype: "promise" });
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [{ name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint", "setLocalOnly"].map(promise), { name: "request", rtype: "callback" }] }],
        async nativePromise(_plugin: string, method: string) {
          if (method === "hasKey") return { present: false };
          return {};
        },
        nativeCallback(_plugin: string, _method: string, options: { endpointId: string; method: string; body?: { tools?: { name?: string; function?: { name?: string } }[]; messages?: unknown } }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: model }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          seam.requests.push({ endpoint: options.endpointId, tools: (options.body?.tools ?? []).map((tool) => String(tool.function?.name ?? tool.name ?? "")), said: JSON.stringify(options.body?.messages ?? []) });
          const text = script.shift();
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script, model: MODEL, server: SERVER },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

test("AI history analysis: the phone looks back from its own index — a note made today by its beginning, and of its properties nothing", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [calls("get_changes", { since: dayKey(-6) }), says(ANSWER)]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  try {
    await openApp(page);
    // A note made now: the index knows it as new in the period.
    await seedExampleNote(page, NOTE);
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Example.md'"), { timeout: 20_000 }).toBe(1);

    // 1. The skill, from the skills of the conversations screen: a new conversation bound to it.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    const start = page.getByTestId("ai-history-skill-history");
    await start.scrollIntoViewIfNeeded();
    await expect(start).toContainText("History analysis");
    await start.click();
    const conversation = page.getByTestId("ai-conversation");
    await expect(conversation.getByText(/the kick-off for Monday was planned/)).toBeVisible({ timeout: 20_000 });

    // 2. The model was offered the two tools of a look back — and nothing that leaves the vault or acts.
    const { requests } = await seam();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0]!.tools).toEqual(expect.arrayContaining(["get_changes", "get_note_history"]));
    for (const never of ["run_command", "find_tools", "fetch_url", "web_search", "propose_edit", "create_note"]) expect(requests[0]!.tools).not.toContain(never);

    // 3. What the phone answered, from its index: the note made today, by its beginning — and of its properties, nothing.
    //    The tool's message alone: the skill's own instructions speak of moods.
    const told = JSON.stringify((JSON.parse(requests[1]!.said) as { role: string; content?: unknown }[]).filter((message) => message.role === "tool").map((message) => message.content));
    expect(told).toContain("Notes created or changed from");
    expect(told).toMatch(/\[\[Example\]\] \(Example\.md\) — new on \d{4}-\d{2}-\d{2}/);
    expect(told).toContain("Monday at ten, with Tom.");
    expect(told).toContain("A line that was deleted is counted, never shown.");
    expect(told).not.toContain("mood");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-history-mobile.png") });
  } finally {
    sql.close();
  }
});
