import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory } from "./exampleVault";

/**
 * A run's snapshot and "Ask another model…" on the phone (AI harness P9-2),
 * in the production bundle: the line under an answer opens in the
 * conversation with the version of what the run read and whether it changed
 * since; asked again, the same question goes to the other model of this
 * phone in a new conversation that names the one it comes from. Both models
 * are on a server of this phone — nothing leaves it, so no send overview asks.
 *
 * The model is the native `AiNet` plugin, which a browser does not have: this
 * test stands in for it at the seam Capacitor offers (as `ai-routines.spec.ts`
 * does), a server of this phone that keeps every request.
 */

interface Seam {
  requests: { endpoint: string; model: string; tools: string[]; said: string }[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

const SERVER = "localhost:8080";
const ORIGINAL = "granite3.3:8b";
const OTHER = "gemma4:12b";
const NOTE = "# Example\n\nThe day rate is 1,800 euros.\n";

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) =>
  `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;
const calls = (name: string, args: unknown) =>
  `${chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 20 } })}data: [DONE]\n\n`;

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, server, original, other }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // Two models on a server of this phone: the one conversations start with, and a second one as the profile "Fast".
      if (!localStorage.getItem("CapacitorStorage.ai")) {
        localStorage.setItem(
          "CapacitorStorage.ai",
          JSON.stringify({
            enabled: true,
            providers: [],
            custom: [{ id: "custom-1", label: server, baseUrl: `http://${server}/v1`, api: "openai-chat", local: true }],
            profiles: { balanced: { providerId: "custom-1", model: original }, fast: { providerId: "custom-1", model: other }, local: { providerId: "custom-1", model: original } },
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
        nativeCallback(_plugin: string, _method: string, options: { endpointId: string; method: string; body?: { model?: string; tools?: { name?: string; function?: { name?: string } }[]; messages?: unknown } }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: original }, { id: other }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          seam.requests.push({
            endpoint: options.endpointId,
            model: String(options.body?.model ?? ""),
            tools: (options.body?.tools ?? []).map((tool) => String(tool.function?.name ?? tool.name ?? "")),
            said: JSON.stringify(options.body?.messages ?? []),
          });
          const text = script.shift();
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script, server: SERVER, original: ORIGINAL, other: OTHER },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

test("AI snapshot: the phone keeps the version of what an answer read, says what changed since, and asks the same of its other model", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [calls("read_note", { path: "Example.md" }), says("The note names 1,800 euros a day."), says("1,800 euros a day, says the note.")]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  try {
    await openApp(page);
    await seedExampleNote(page, NOTE);
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Example.md'"), { timeout: 20_000 }).toBe(1);

    // 1. A question on the AI screen; the model reads the note with a tool and answers.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await conversation.getByTestId("ai-input").fill("What day rate does the example name?");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByText("The note names 1,800 euros a day.")).toBeVisible({ timeout: 20_000 });

    // 2. Its line, opened in the conversation: the version of what the tool read, unchanged.
    const line = conversation.getByRole("button", { name: /^answered on this device|^sent to/ }).first();
    await line.click();
    const read = conversation.getByTestId("ai-snapshot-read");
    await expect(read).toContainText("Example");
    await expect(read).toContainText("unchanged");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-snapshot-mobile.png") });

    // 3. The note changes on the phone; opened again, the line says so.
    await page.evaluate(async (text) => {
      const fs = (globalThis as unknown as { Capacitor: { Plugins: { Filesystem: { writeFile(o: unknown): Promise<unknown> } } } }).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Example.md", data: text, directory: "DATA", encoding: "utf8" });
    }, `${NOTE}Travel is extra.\n`);
    await line.click();
    await line.click();
    await expect(conversation.getByTestId("ai-snapshot-read")).toContainText("changed since");

    // 4. The same question to the phone's other model, in a new conversation that names its original.
    await conversation.getByTestId("ai-snapshot-replay-open").click();
    await page.getByRole("menuitem", { name: /Fast/ }).click();
    await expect(conversation.getByText("1,800 euros a day, says the note.")).toBeVisible({ timeout: 20_000 });
    await expect(conversation.getByTestId("ai-replay-head")).toContainText("The same question as in");
    const { requests } = await seam();
    expect(requests.at(-1)!.model).toBe(OTHER);
    expect(requests.at(-1)!.said).toContain("What day rate does the example name?");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-replay-mobile.png") });
  } finally {
    sql.close();
  }
});
