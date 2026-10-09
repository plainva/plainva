import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * "Fully local" on the phone (AI harness P7-1, ADR 0030), in the production
 * bundle: the group "Mode" of the AI's settings — the line that says what
 * holds, the one switch, and what rests while it is on —, the conversation
 * that names what is missing where no model runs on this phone, the way to a
 * server on this device with what its user says about its model, and a
 * conversation that is answered there.
 *
 * The model is the native `AiNet` plugin, which a browser does not have. This
 * test stands in for it at the seam Capacitor offers: it keeps the endpoint of
 * every request and what the shell was told about the switch, answers as a
 * server under the phone's own address, and has no answer for a provider — a
 * request to one would fail the test by its mere presence in the list.
 */

interface Seam {
  /** Every chat request, by the endpoint it named. */
  requests: { endpoint: string; tools: number }[];
  /** Every list of models that was asked for, by endpoint. */
  lists: string[];
  /** What the shell was told about "Fully local", in order. */
  localOnly: boolean[];
  /** The addresses the system's dialog was asked to add. */
  endpoints: string[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

const ADDRESS = "http://localhost:8080/v1";
const SERVER = "localhost:8080";
const MODEL = "granite3.3:8b";

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) =>
  `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, model }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // The AI is opt-in per device: switched on here, with a provider's model chosen. Written once — what the app
      // stores afterwards (the switch, the server, the profile) has to survive a reload.
      if (!localStorage.getItem("CapacitorStorage.ai")) {
        localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
      }
      const seam: Seam = { requests: [], lists: [], localOnly: [], endpoints: [] };
      (globalThis as SeamGlobals).__seam = seam;
      const promise = (name: string) => ({ name, rtype: "promise" });
      // The header a native shell announces: with it, Capacitor routes this plugin to the functions below.
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [{ name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint", "setLocalOnly"].map(promise), { name: "request", rtype: "callback" }] }],
        async nativePromise(_plugin: string, method: string, options: Record<string, unknown>) {
          // One key on this phone: the provider's. A server on this device needs none.
          if (method === "hasKey") return { present: options.endpointId === "anthropic" };
          if (method === "addEndpoint") {
            // The system's own dialog: it shows the address, and here it says yes.
            seam.endpoints.push(String(options.baseUrl));
            return { added: true };
          }
          if (method === "setLocalOnly") seam.localOnly.push(options.on === true);
          return {};
        },
        nativeCallback(_plugin: string, _method: string, options: { endpointId: string; method: string; body?: { tools?: unknown[] } }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          const here = options.endpointId !== "anthropic";
          if (options.method === "GET") {
            // The connection test: the server names its models, and nothing about them.
            seam.lists.push(options.endpointId);
            send(here ? [{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: model }] }) }, { type: "done" }] : [{ type: "failed", code: "network", message: "offline" }]);
            return Promise.resolve("ai");
          }
          seam.requests.push({ endpoint: options.endpointId, tools: Array.isArray(options.body?.tools) ? options.body.tools.length : 0 });
          const text = here ? script.shift() : undefined;
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script, model: MODEL },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

test("AI fully local: the phone's settings say what holds; switched on they list what rests and a conversation names what is missing; a server on this device is set up with what its user says about its model, and answers", async ({ page, context }) => {
  test.setTimeout(150_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [says("Answered on this phone.")]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("CapacitorStorage.ai") ?? "{}") as { localOnly?: boolean; profiles?: Record<string, unknown> });
  try {
    await openApp(page);
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();
    const sheet = (title: string) => page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: title }) });
    const toAppSettings = async () => {
      await page.getByTestId("nav-settings").first().click();
      await page.getByTestId("settings-area-ai").click();
      await expect(page.getByTestId("settings-ai")).toBeVisible();
    };

    // 1. As it is set up, a provider answers — the settings say so in a line, not with a control. Only "Fully local"
    //    is a switch.
    await toAppSettings();
    const settings = page.getByTestId("settings-ai");
    const now = settings.getByTestId("ai-mode-now");
    const fullyLocal = settings.getByRole("switch", { name: "Fully local" });
    await expect(now).toContainText("Now: Cloud — a provider answers");
    await expect(now).toContainText("New conversations start with Anthropic · m-1.");
    await expect(settings).toContainText("Only “Fully local” is a switch, because only it promises something.");
    await expect(fullyLocal).toHaveAttribute("aria-checked", "false");
    await expect(settings.getByTestId("ai-mode-rest")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-state-mobile.png") });

    // 2. Switched on, with no model on this phone: the line says what is missing and offers the way there; under the
    //    switch stands what rests. The shell is told, and the switch is kept with this device's settings.
    await fullyLocal.click();
    await expect(fullyLocal).toHaveAttribute("aria-checked", "true");
    await expect(now).toContainText("Now: Fully local — and no model is set up on this device");
    await expect(now).toContainText("Until one is, the AI cannot answer.");
    await expect(settings.getByTestId("ai-mode-setup")).toContainText("Set up a model on this device");
    await expect(settings).toContainText("While “Fully local” is on, this rests");
    await expect(settings.getByTestId("ai-mode-rest").filter({ hasText: "Anthropic" })).toContainText("Stays set up and receives nothing. This profile does not answer: Balanced.");
    await expect(settings).toContainText("The switch is about the AI.");
    await expect.poll(async () => (await seam()).localOnly.at(-1)).toBe(true);
    await expect.poll(async () => (await stored()).localOnly).toBe(true);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-missing-mobile.png") });

    // 3. A conversation says the same before anyone types: no model on this device, and the way to the settings.
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const missing = page.getByTestId("ai-local-empty");
    await expect(missing).toContainText("No model on this device");
    await expect(missing).toContainText("“Fully local” is on, and no profile names a model that runs on this device.");
    await expect(page.getByTestId("ai-input")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-empty-mobile.png") });
    expect((await seam()).requests).toEqual([]);

    // 4. The way there: a server under this phone's own address. The system's dialog shows the address; the
    //    connection test asks it for its models — it is this device, so the switch lets that through.
    await back();
    await toAppSettings();
    await settings.getByTestId("ai-mode-setup").click();
    await sheet("Add provider").getByText("OpenAI-compatible server", { exact: true }).click();
    await page.locator(".m-sheet input").fill(ADDRESS);
    await page.locator(".m-sheet input").press("Enter");
    await expect(settings).toContainText(SERVER);
    await expect.poll(async () => (await seam()).endpoints).toEqual([ADDRESS]);
    await expect.poll(async () => (await seam()).lists.length).toBeGreaterThan(0);

    // 5. Its model for the profile "Local" — and what the user says about it, because the server tells neither: the
    //    window, which has to be a number, and that it takes no tools.
    await settings.getByTestId("ai-profile-local").click();
    await sheet("Model for “Local”").getByText(SERVER, { exact: true }).click();
    await sheet("From the provider's list").getByText(MODEL, { exact: true }).click();
    const windowSheet = sheet("Context window");
    await expect(windowSheet).toContainText("A server on this device does not tell Plainva");
    await windowSheet.locator("input").fill("a lot");
    await windowSheet.locator("input").press("Enter");
    await expect(page.locator(".m-sheet-title", { hasText: "A whole number between 1,024 and 2,000,000, or empty." })).toBeVisible();
    await page.getByTestId("confirm-act").click();
    await sheet("Context window").locator("input").fill("8 192");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-window-mobile.png") });
    await sheet("Context window").locator("input").press("Enter");
    const tools = sheet("Can call tools");
    await expect(tools).toContainText("Off: the model gets no tools and answers from what goes along");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-tools-mobile.png") });
    await tools.getByText("Give it no tools", { exact: true }).click();
    await expect(settings.getByTestId("ai-profile-local")).toContainText(`${SERVER} · ${MODEL} · window 8,192 · no tools`);

    // 6. Now the line names the model that answers. The provider still rests; nothing was removed.
    await expect(now).toContainText("Now: Fully local — nothing leaves this device");
    await expect(now).toContainText(`${SERVER} · ${MODEL} answers, the model of the profile “Local”.`);
    await expect(settings.getByTestId("ai-mode-setup")).toHaveCount(0);
    await expect(settings.getByTestId("ai-mode-rest").filter({ hasText: "Anthropic" })).toHaveCount(1);
    await expect(settings.getByTestId("ai-profile-balanced")).toContainText("Anthropic · m-1");
    await now.scrollIntoViewIfNeeded();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-on-mobile.png") });

    // 7. The vault's page says it where the internet would be allowed: it rests.
    await back();
    await page.getByTestId("settings-area-aiVault").click();
    await expect(page.getByTestId("ai-rests-web")).toHaveText("Rests while “Fully local” is on.");
    await back();
    await back();

    // 8. A conversation is answered on this phone — without tools, as its user said, and without an overview, because
    //    nothing leaves. Not one request named the provider.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await expect(page.getByTestId("ai-local-empty")).toHaveCount(0);
    await conversation.getByTestId("ai-input").fill("Where do you run?");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByText("Answered on this phone.")).toBeVisible();
    await expect(conversation.getByTestId("ai-local-marking")).toHaveText("Fully local: nothing leaves this device.");
    const { requests } = await seam();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.endpoint).not.toBe("anthropic");
    expect(requests[0]!.tools).toBe(0);
    expect((await seam()).lists.every((endpoint) => endpoint !== "anthropic")).toBe(true);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-local-answer-mobile.png") });

    // 9. Switched off again, everything is as it was set up: the provider answers new conversations, and this phone
    //    computes something itself — the state the settings call "Hybrid".
    await back();
    await toAppSettings();
    await fullyLocal.click();
    await expect(fullyLocal).toHaveAttribute("aria-checked", "false");
    await expect(now).toContainText("Now: Hybrid — this device sorts, a provider answers");
    await expect(settings.getByTestId("ai-mode-rest")).toHaveCount(0);
    await expect.poll(async () => (await seam()).localOnly.at(-1)).toBe(false);
    await expect.poll(async () => (await stored()).localOnly).toBe(false);
  } finally {
    await sql.close?.();
  }
});
