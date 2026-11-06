import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { EXAMPLE_NOTE, readVaultFile, seedExampleNote, waitForVaultDirectory } from "./exampleVault";

/**
 * "Apply directly" on the phone (plan "KI direkt schreiben", W5), in the
 * production bundle: the chip over the input writes the assistant's change at
 * once, the answer lists it under "Changed", and "Undo" puts the version back
 * — through the phone's own chain and version store. The folder rule
 * "Change without asking" is a third question of a rule in "AI in this vault".
 *
 * The model is a server on this device behind the native `AiNet` plugin,
 * which a browser does not have: a seam stands in for it, as in the other
 * phone smokes, and answers with a scripted tool call.
 */

interface Seam {
  requests: { said: string }[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

const SERVER = "localhost:8080";
const MODEL = "granite3.3:8b";
const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) => `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;
/** A found tool, called through the conversation's dispatcher. */
const calls = (id: string, name: string, args: unknown) =>
  `${chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: "call_tool", arguments: JSON.stringify({ name, args }) } }] } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, server, model }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
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
        nativeCallback(_plugin: string, _method: string, options: { method: string; body?: { messages?: unknown } }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: model }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          seam.requests.push({ said: JSON.stringify(options.body?.messages ?? []) });
          const text = script.shift();
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script, server: SERVER, model: MODEL },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

const REVIEWED = EXAMPLE_NOTE.replace("A sentence to review.", "A sentence, reviewed.");

test("AI apply directly on the phone: the chip writes the change at once, and Undo puts the version back", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [calls("c1", "propose_edit", { path: "Example.md", edits: [{ find: "A sentence to review.", replace: "A sentence, reviewed." }] }), says("I reviewed the sentence.")]);
  try {
    await openApp(page);
    await seedExampleNote(page);
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Example.md'"), { timeout: 20_000 }).toBe(1);

    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    const chip = conversation.getByTestId("ai-direct-toggle");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(conversation.getByTestId("ai-direct-marking")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-direct-chip-mobile.png") });

    await conversation.getByTestId("ai-input").fill("Review the sentence in the example.");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByText("I reviewed the sentence.")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => readVaultFile(page, "Example.md")).toBe(REVIEWED);
    await expect(conversation.getByTestId("ai-direct-changed")).toContainText("Changed: 1 note");
    await expect(conversation.getByTestId("ai-proposed")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) {
      await conversation.getByTestId("ai-direct-changed").scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath("ai-direct-changed-mobile.png") });
    }

    await conversation.getByTestId("ai-direct-undo").click();
    await expect.poll(() => readVaultFile(page, "Example.md")).toBe(EXAMPLE_NOTE);
    await expect(conversation.getByTestId("ai-direct-undone")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-direct-undone-mobile.png") });
  } finally {
    sql.close();
  }
});

test("AI apply directly on the phone: “Change without asking” is a third question of a folder rule", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, []);
  try {
    await openApp(page);
    await page.evaluate(async () => {
      const fs = (globalThis as unknown as { Capacitor: { Plugins: { Filesystem: { writeFile(options: object): Promise<unknown> } } } }).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/.agent/policy.yml", data: 'folders:\n  "Journal/":\n    write: direct\n', directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    const row = page.getByText("Journal/", { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText(/Change without asking: allowed/)).toBeVisible();
    await expect(page.getByText("“Change without asking” lets the AI change and create notes there, routines included. Deleting, renaming and moving always ask.")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-direct-folder-mobile.png") });
  } finally {
    sql.close();
  }
});
