import { test, expect, type BrowserContext } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Setting up the AI on the phone in three steps (plan Oberfläche O7, T9; mockup M7), in the production bundle: "Set
 * up" in an empty conversation opens one sheet — what the AI computes with, the way in, a first hello — instead of the
 * long settings page, and the setup ends in the conversation with the answer.
 *
 * The model is the native `AiNet` plugin, which a browser does not have; this test stands in for it at the seam
 * Capacitor offers (as `ai-usage.spec.ts` does). A browser is no phone with a model of its own, so the sheet offers
 * the two other answers.
 */

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

/** `lists`: what the provider's model list answers, one per connection test — "denied" is a rejected key; the rest are the list. */
async function installSeam(context: BrowserContext, script: string[], lists: Array<"ok" | "denied"> = []): Promise<void> {
  await context.addInitScript(
    ({ script, lists }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      if (!localStorage.getItem("CapacitorStorage.ai")) localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: [], custom: [], profiles: {} }));
      (globalThis as unknown as { __keys: string[] }).__keys = [];
      const promise = (name: string) => ({ name, rtype: "promise" });
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [{ name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint", "setLocalOnly"].map(promise), { name: "request", rtype: "callback" }] }],
        async nativePromise(_plugin: string, method: string, options: { providerId?: string }) {
          const keys = (globalThis as unknown as { __keys: string[] }).__keys;
          if (method === "setKey" && options.providerId) keys.push(options.providerId);
          if (method === "hasKey") return { present: Boolean(options.providerId && keys.includes(options.providerId)) };
          // The system's confirmation of a new address: said yes to.
          if (method === "addEndpoint") return { added: true };
          return {};
        },
        nativeCallback(_plugin: string, _method: string, options: { method: string }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((piece) => callback(piece)));
          if (options.method === "GET") {
            if (lists.shift() === "denied") send([{ type: "httpError", status: 401, body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) }]);
            else send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: "m-1", display_name: "Model One" }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          const text = script.shift();
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script, lists },
  );
}

test("AI setup on the phone: three steps from 'Set up' to the first answer, in one sheet", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [says("Hello! How can I help with your notes?")]);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-screen");
    await conversation.getByRole("button", { name: "Set up", exact: true }).click();

    // 1. What should the AI compute with? A browser has no model of its own: a key of one's own, or an own server.
    const sheet = page.getByTestId("ai-setup-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("ai-setup-steps").locator("li")).toHaveCount(3);
    await expect(sheet.getByTestId("ai-setup-steps").locator('li[aria-current="step"]')).toContainText("Provider");
    await expect(sheet).toContainText("What should the AI compute with?");
    await expect(sheet.getByTestId("ai-setup-kind-device")).toHaveCount(0);
    await expect(sheet.getByTestId("ai-setup-kind-cloud")).toBeVisible();
    await expect(sheet.getByTestId("ai-setup-kind-server")).toBeVisible();
    await expect(sheet).toContainText("You can change this later under Settings › AI.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-setup-step1-mobile.png") });
    await sheet.getByTestId("ai-setup-kind-cloud").click();
    await sheet.getByTestId("ai-setup-next").click();

    // 2. Which provider, which key — nothing goes on without one.
    await expect(sheet.getByTestId("ai-setup-steps").locator('li[aria-current="step"]')).toContainText("Access");
    await sheet.getByTestId("ai-setup-cloud").filter({ hasText: "Anthropic" }).click();
    await expect(sheet.getByTestId("ai-setup-next")).toBeDisabled();
    await sheet.getByTestId("ai-setup-key").fill("sk-test-key");
    await sheet.getByTestId("ai-setup-next").click();

    // 3. Try it: the model of the profile new conversations start with, then the first hello.
    await expect(sheet.getByTestId("ai-setup-steps").locator('li[aria-current="step"]')).toContainText("Try it");
    await expect(sheet.getByTestId("ai-setup-hello")).toBeDisabled();
    await sheet.getByTestId("ai-setup-model").click();
    const models = page.getByTestId("ai-model-sheet");
    await models.getByTestId("ai-model-option").filter({ hasText: "Model One" }).click();
    await models.getByTestId("ai-model-save").click();
    await expect(models).toHaveCount(0);
    await expect(sheet.getByTestId("ai-setup-model")).toContainText("Anthropic · m-1");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-setup-step3-mobile.png") });
    await sheet.getByTestId("ai-setup-hello").click();
    await expect(sheet).toHaveCount(0);

    // The setup ends in the conversation: the send overview first, then the answer.
    await conversation.getByTestId("ai-consent-send").click();
    await expect(conversation.getByText("Hello! How can I help with your notes?")).toBeVisible({ timeout: 20_000 });
    await expect(conversation.getByTestId("ai-grounds")).toContainText("To Anthropic");
  } finally {
    sql.close();
  }
});

test("AI setup on the phone: a key that was refused is fixed in the sheet the next time — the setup never begins behind it (review O7, O2)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [], ["denied", "ok"]);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-screen");
    await conversation.getByRole("button", { name: "Set up", exact: true }).click();
    const sheet = page.getByTestId("ai-setup-sheet");
    const current = sheet.getByTestId("ai-setup-steps").locator('li[aria-current="step"]');
    await sheet.getByTestId("ai-setup-kind-cloud").click();
    await sheet.getByTestId("ai-setup-next").click();
    await sheet.getByTestId("ai-setup-cloud").filter({ hasText: "Anthropic" }).click();
    await sheet.getByTestId("ai-setup-key").fill("sk-wrong");
    await sheet.getByTestId("ai-setup-next").click();
    // The provider refused the key: said in the sheet, which stays at the way in.
    await expect(sheet.getByTestId("ai-setup-problem")).toBeVisible();
    await expect(current).toContainText("Access");
    // Put away, and begun again: at the way in, with the problem named, a way back to the first step, and a new key.
    await sheet.getByTestId("ai-setup-back").click();
    await expect(current).toContainText("Provider");
    await page.locator(".m-sheet-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(sheet).toHaveCount(0);

    await conversation.getByRole("button", { name: "Set up", exact: true }).click();
    await expect(sheet).toBeVisible();
    await expect(current).toContainText("Access");
    await expect(sheet.getByTestId("ai-setup-problem")).toBeVisible();
    await expect(sheet.getByTestId("ai-setup-back")).toBeVisible();
    await sheet.getByTestId("ai-setup-key").fill("sk-right");
    await sheet.getByTestId("ai-setup-next").click();
    await expect(current).toContainText("Try it");
    await expect(sheet.getByTestId("ai-setup-back")).toBeVisible();
  } finally {
    sql.close();
  }
});

test("AI setup on the phone: an own server's address is no unsaved typing, and a corrected one replaces the server (review O7, second round)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  // An own server is set up already and has not been asked yet: the setup begins at the first hello.
  await context.addInitScript(() => {
    localStorage.setItem(
      "CapacitorStorage.ai",
      JSON.stringify({ enabled: true, providers: [], custom: [{ id: "custom-1", label: "ai.example.org", baseUrl: "https://ai.example.org/v1", api: "openai-chat", local: false }], profiles: {} }),
    );
  });
  await installSeam(context, [], ["ok", "ok", "ok"]);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-screen");
    await conversation.getByRole("button", { name: "Set up", exact: true }).click();
    const sheet = page.getByTestId("ai-setup-sheet");
    const current = sheet.getByTestId("ai-setup-steps").locator('li[aria-current="step"]');
    await expect(current).toContainText("Try it");
    // Put away at the first hello: nothing was typed, so nothing is asked.
    await page.locator(".m-sheet-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(sheet).toHaveCount(0);

    // Begun again, back at the way in: the server's address stands there, and correcting it replaces that server.
    await conversation.getByRole("button", { name: "Set up", exact: true }).click();
    await sheet.getByTestId("ai-setup-back").click();
    await expect(current).toContainText("Access");
    await expect(sheet.getByTestId("ai-setup-address")).toHaveValue("https://ai.example.org/v1");
    await sheet.getByTestId("ai-setup-address").fill("https://llm.example.org/v1");
    await sheet.getByTestId("ai-setup-next").click();
    await expect(current).toContainText("Try it");
    const custom = await page.evaluate(() => (JSON.parse(localStorage.getItem("CapacitorStorage.ai") ?? "{}") as { custom?: { id: string; baseUrl: string }[] }).custom ?? []);
    expect(custom.map((c) => [c.id, c.baseUrl])).toEqual([["custom-1", "https://llm.example.org/v1"]]);

    // A provider tried in between, then the server again (review O7, third round): the same address is that server.
    await sheet.getByTestId("ai-setup-back").click();
    await sheet.getByTestId("ai-setup-back").click();
    await expect(current).toContainText("Provider");
    await sheet.getByTestId("ai-setup-kind-cloud").click();
    await sheet.getByTestId("ai-setup-next").click();
    await sheet.getByTestId("ai-setup-cloud").filter({ hasText: "Anthropic" }).click();
    await sheet.getByTestId("ai-setup-key").fill("sk-test-key");
    await sheet.getByTestId("ai-setup-next").click();
    await expect(current).toContainText("Try it");
    await sheet.getByTestId("ai-setup-back").click();
    await sheet.getByTestId("ai-setup-back").click();
    await sheet.getByTestId("ai-setup-kind-server").click();
    await sheet.getByTestId("ai-setup-next").click();
    await expect(sheet.getByTestId("ai-setup-address")).toHaveValue("https://llm.example.org/v1");
    await sheet.getByTestId("ai-setup-next").click();
    await expect(current).toContainText("Try it");
    const after = await page.evaluate(() => (JSON.parse(localStorage.getItem("CapacitorStorage.ai") ?? "{}") as { custom?: { id: string; baseUrl: string }[] }).custom ?? []);
    expect(after.map((c) => [c.id, c.baseUrl])).toEqual([["custom-1", "https://llm.example.org/v1"]]);

    // The address in the field is a stored one: closing asks nothing.
    await page.locator(".m-sheet-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(sheet).toHaveCount(0);
  } finally {
    sql.close();
  }
});
