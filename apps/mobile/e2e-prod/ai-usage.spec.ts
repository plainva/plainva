import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * What the phone's AI costs (AI harness P9-6), in the production bundle: the
 * line under an answer says how much of the request came from the provider's
 * cache, and the month's usage in the settings names that share per model,
 * the cost where there is a price, and what choosing and shortening the notes
 * saved — read from the vault's run ledger in the app's data, where the run
 * just wrote its own entry beside three the test puts there.
 *
 * The model is the native `AiNet` plugin, which a browser does not have. This
 * test stands in for it at the seam Capacitor offers, as a server under the
 * phone's own address (as `ai-history.spec.ts` does), and answers with the
 * cache numbers an OpenAI-compatible server reports.
 */

const MODEL = "granite3.3:8b";
/**
 * The vault's note: long, the answer in its last section. The phone's own request carries a card of it — what the
 * question asks about —, and the rest of the note is what choosing and shortening saved.
 */
const NOTE = `---\ntype: Note\n---\n# Example\n\nA sentence to review.\n\n## Background\n\n${"Calm hours passed by the window. ".repeat(150).trim()}\n\n## Where it runs\n\nThe model runs on this phone.\n`;
const SERVER = "localhost:8080";
const ANSWER = "Answered on this phone.";

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
/** An answer whose request read 700 of its 1,000 input tokens from the server's cache. */
const says = (text: string) =>
  `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 700 } } })}data: [DONE]\n\n`;

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, model, server }) => {
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
      const promise = (name: string) => ({ name, rtype: "promise" });
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [{ name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint", "setLocalOnly"].map(promise), { name: "request", rtype: "callback" }] }],
        async nativePromise(_plugin: string, method: string) {
          if (method === "hasKey") return { present: false };
          return {};
        },
        nativeCallback(_plugin: string, _method: string, options: { method: string }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((piece) => callback(piece)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: model }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          const text = script.shift();
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script, model: MODEL, server: SERVER },
  );
}

/** The run ledger of the vault that is open, wherever its key files it in the app's data. */
async function ledgerPath(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const listing = await fs.readdir({ path: "ai", directory: "DATA" }).catch(() => ({ files: [] }));
    for (const entry of listing.files) {
      if (entry.type !== "directory") continue;
      const path = `ai/${entry.name}/ledger.json`;
      const found = await fs.stat({ path, directory: "DATA" }).catch(() => null);
      if (found) return path;
    }
    return null;
  });
}

test("AI usage on the phone: the cache share under the answer and in the month, the cost per model, and what choosing and shortening saved", async ({ page, context }) => {
  test.setTimeout(120_000);
  // The vault opens behind the index, as on the phone.
  const sql = await installSqlBridge(context);
  await installSeam(context, [says(ANSWER)]);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  await seedExampleNote(page, NOTE);
  await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Example.md'"), { timeout: 20_000 }).toBe(1);
  try {

    // 1. A question; the server reports that it read 700 of the 1,000 tokens of the request from its cache.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await conversation.getByTestId("ai-input").fill("Where do you run?");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByText(ANSWER)).toBeVisible({ timeout: 20_000 });
    const line = conversation.locator(".pv-ai-run .pv-ai-runline").first();
    await expect(line).toContainText("~1,040 tokens");
    await expect(line).toContainText("70% of the input from the cache");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-usage-answer-mobile.png") });

    // 2. The month's ledger, as the app keeps it: the run's own entry, and three more — two of models with a price, one
    //    of a cloud model without one.
    await expect.poll(() => ledgerPath(page), { timeout: 20_000 }).not.toBeNull();
    const path = (await ledgerPath(page))!;
    const own = await page.evaluate(async (path) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const kept = JSON.parse(String((await fs.readFile({ path, directory: "DATA", encoding: "utf8" })).data)) as { version: number; entries: Record<string, unknown>[] };
      const mine = kept.entries[kept.entries.length - 1]!;
      const at = `${new Date().toISOString().slice(0, 7)}-01T10:00:00Z`;
      const entry = (providerId: string, model: string, usage: object, extra: object) => ({ at, conversationId: "c-seeded", providerId, model, stop: "answered", steps: 1, tools: [], usage, ...extra });
      kept.entries.push(
        entry("anthropic", "claude-sonnet-4-5", { inputTokens: 300, outputTokens: 120, cacheReadTokens: 700, cacheWriteTokens: 0 }, { costUsd: 0.0123, context: { savedTokens: 11420 }, savedUsd: 0.0343 }),
        entry("openai", "gpt-5", { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, { costUsd: 0.002, context: { savedTokens: 1000 }, savedUsd: 0.0025 }),
        entry("openrouter", "mistralai/mistral-large", { inputTokens: 400, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 }, { context: { savedTokens: 1000 } }),
      );
      await fs.writeFile({ path, directory: "DATA", encoding: "utf8", data: JSON.stringify(kept) });
      return mine as { providerId: string; context?: { savedTokens: number }; savedUsd?: number };
    }, path);
    // The phone's own run: the note went without what the context left out of it — most of it —, and the model on
    // this phone costs nothing: its saving is worth no dollars, not an unknown price.
    expect(own.providerId).toBe("custom-1");
    expect(own.context?.savedTokens).toBeGreaterThan(1_000);
    expect(own.savedUsd).toBe(0);

    // 3. The settings: per model what it went with, from the cache where it says so, the cost where there is a price —
    //    and below, what the month saved.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-ai").click();
    const settings = page.getByTestId("settings-ai");
    await expect(settings).toBeVisible();
    // A row of the month: the model and what it went with (the profiles name the same model).
    const usageRow = (name: string) => settings.locator(".pv-grouprow", { hasText: "tokens sent" }).filter({ hasText: name });
    await expect(usageRow(`${SERVER} · ${MODEL}`)).toContainText("1,000 tokens sent · 40 received · 70% of the input from the cache");
    await expect(usageRow("claude-sonnet-4-5")).toContainText("1,000 tokens sent · 120 received · 70% of the input from the cache · ≈ $0.01");
    const plain = usageRow("gpt-5");
    await expect(plain).toContainText("1,000 tokens sent · 50 received · ≈ $0.00");
    await expect(plain).not.toContainText("cache");
    await expect(usageRow("mistralai/mistral-large")).toContainText("400 tokens sent · 30 received");
    // Every saving counts in tokens. The cloud model without a price keeps the dollars out — a sum that left its run
    // out would still look complete —; the phone's own model does not, it costs nothing.
    const saved = settings.getByTestId("m-ai-usage-saved");
    const total = 11_420 + 1_000 + 1_000 + own.context!.savedTokens;
    await expect(saved).toHaveText(`Saved by choosing and shortening: ~${total.toLocaleString("en-US")} tokens`);
    await expect(saved).not.toContainText("$");
    await saved.scrollIntoViewIfNeeded();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-usage-settings-mobile.png") });
  } finally {
    sql.close();
  }
});
