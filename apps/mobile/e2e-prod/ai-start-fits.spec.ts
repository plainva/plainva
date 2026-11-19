import { test, expect, type BrowserContext, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory } from "./exampleVault";

/**
 * The phone's empty AI screen as one surface (F71 of release 0.9.0, mockup KI-Oberflächen M12), in the production
 * bundle on an iPhone's 375 × 812:
 * - it opens at its top: with something to decide and a last conversation the start is taller than the thread, and
 *   the conversation's "follow the answer" jump to the end left it scrolled — its first card cut at the top edge;
 * - with the keyboard up the foot gives way and no empty band stays where the hidden bar was;
 * - with nothing to list, the greeting stands at the top and to the left.
 * The keyboard is the app's own state (`is-keyboard-open`, set by the Keyboard plugin a browser lacks) and the
 * smaller visible area the native resize leaves.
 */
const SERVER = "localhost:8080";
const MODEL = "granite3.3:8b";
const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) => `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;
const calls = (id: string, name: string, args: unknown) =>
  `${chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: "call_tool", arguments: JSON.stringify({ name, args }) } }] } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;

async function installSeam(context: BrowserContext, script: string[], mode: "light" | "dark", language: string): Promise<void> {
  await context.addInitScript(
    ({ script, server, model, mode, language }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language, motion: "off", themeMode: mode }));
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
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((c) => callback(c)));
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
    { script, server: SERVER, model: MODEL, mode, language },
  );
}


const START_SIZE = { width: 375, height: 812 };
/** An iPhone's keyboard with its bar, in CSS pixels. */
const KEYBOARD = 336;

/** The AI screen of a vault with one note — after a first conversation that left a proposal, when `proposal`. */
async function openAiScreen(page: Page, context: BrowserContext, proposal: boolean): Promise<() => void> {
  await page.setViewportSize(START_SIZE);
  const sql = await installSqlBridge(context);
  await installSeam(context, [calls("c1", "propose_edit", { path: "Example.md", edits: [{ find: "A sentence to review.", replace: "A sentence, reviewed." }] }), says("I propose a change.")], "light", "en");
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 30_000 });
  await seedExampleNote(page);
  await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Example.md'"), { timeout: 30_000 }).toBe(1);
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-ai").click();
  const conversation = page.getByTestId("ai-conversation");
  await expect(conversation.getByTestId("ai-input")).toBeVisible();
  if (proposal) {
    await conversation.getByTestId("ai-input").fill("Check the sentence.");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByText("I propose a change.")).toBeVisible({ timeout: 30_000 });
    // A new, empty conversation: something to decide, a last conversation.
    await page.getByTestId("ai-new").click();
    await expect(page.getByTestId("ai-start-waiting")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ai-start-recent")).toHaveCount(1);
  }
  await page.waitForTimeout(500);
  return () => sql.close();
}

test("the empty AI screen opens at its top: the first card whole, nothing scrolled away", async ({ page, context }) => {
  test.setTimeout(120_000);
  const close = await openAiScreen(page, context, true);
  try {
    const placed = await page.evaluate(() => {
      const thread = document.querySelector(".m-ai-page .pv-ai-thread") as HTMLElement;
      const first = thread.firstElementChild as HTMLElement;
      return { scrollTop: thread.scrollTop, threadTop: thread.getBoundingClientRect().top, firstTop: first.getBoundingClientRect().top };
    });
    expect(placed.scrollTop, "the empty conversation is not scrolled").toBe(0);
    expect(placed.firstTop, "the first card of the start begins inside the thread, not above it").toBeGreaterThanOrEqual(placed.threadTop);
  } finally {
    close();
  }
});

test("with the keyboard up the foot gives way, and no empty band stays where the bar was", async ({ page, context }) => {
  test.setTimeout(120_000);
  const close = await openAiScreen(page, context, true);
  try {
    await page.evaluate(() => document.querySelector(".m-app")?.classList.add("is-keyboard-open"));
    await page.setViewportSize({ width: START_SIZE.width, height: START_SIZE.height - KEYBOARD });
    await page.getByTestId("ai-input").focus();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("ai-profile-button")).toBeHidden();
    const room = await page.evaluate(() => {
      const thread = document.querySelector(".m-ai-page .pv-ai-thread") as HTMLElement;
      const composer = document.querySelector(".m-ai-page .pv-ai-composer") as HTMLElement;
      return { thread: thread.clientHeight, below: innerHeight - composer.getBoundingClientRect().bottom };
    });
    expect(room.below, "nothing but the edge between the composer and the keyboard").toBeLessThanOrEqual(16);
    expect(room.thread, "the conversation keeps room to be read").toBeGreaterThanOrEqual(120);
  } finally {
    close();
  }
});

test("with nothing to list, the greeting stands at the top and to the left", async ({ page, context }) => {
  test.setTimeout(120_000);
  const close = await openAiScreen(page, context, false);
  try {
    await expect(page.getByTestId("ai-start")).toHaveCount(0);
    const hello = page.getByTestId("ai-hello");
    await expect(hello).toBeVisible();
    const placed = await page.evaluate(() => {
      const thread = document.querySelector(".m-ai-page .pv-ai-thread") as HTMLElement;
      const hello = document.querySelector('[data-testid="ai-hello"]') as HTMLElement;
      const title = hello.querySelector(".pv-empty-title") as HTMLElement;
      const input = document.querySelector('[data-testid="ai-input"]') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(title);
      return {
        gap: hello.getBoundingClientRect().top - thread.getBoundingClientRect().top,
        // Where the words of the title begin, against where the field below begins: one left edge.
        titleLeft: range.getBoundingClientRect().left,
        fieldLeft: input.closest(".pv-ai-inputrow")!.getBoundingClientRect().left,
        align: getComputedStyle(hello).textAlign,
      };
    });
    expect(placed.gap, "at the top of the conversation").toBeLessThanOrEqual(24);
    expect(placed.align).toBe("left");
    expect(Math.abs(placed.titleLeft - placed.fieldLeft), "the greeting begins where the field below it begins").toBeLessThanOrEqual(16);
  } finally {
    close();
  }
});
