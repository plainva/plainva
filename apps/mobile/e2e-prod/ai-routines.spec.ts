import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Routines on the phone (AI harness P8-1), in the production bundle: the
 * section of the vault's AI settings, the sheet that sets one up in two steps
 * — the form, then what holds for a run nobody watches —, a run started by
 * hand that reads, asks nothing and leaves a note, and the line in the
 * conversation that says its result is ready.
 *
 * The model is the native `AiNet` plugin, which a browser does not have. This
 * test stands in for it at the seam Capacitor offers, as a server under the
 * phone's own address: it keeps every request with the tools it offered, and
 * answers from a script.
 */

interface Seam {
  requests: { endpoint: string; tools: string[] }[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

const MODEL = "granite3.3:8b";
const SERVER = "localhost:8080";
const BRIEF = "Nothing is due today. The plan for the week is the note that changed last.";

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) =>
  `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script, model, server }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // The AI is on, and the profile "Local" names a model on a server of this phone: a routine with it sends nothing
      // anywhere. Written once — what the app stores afterwards has to survive a reload.
      if (!localStorage.getItem("CapacitorStorage.ai")) {
        localStorage.setItem(
          "CapacitorStorage.ai",
          JSON.stringify({
            enabled: true,
            providers: [],
            custom: [{ id: "custom-1", label: server, baseUrl: `http://${server}/v1`, api: "openai-chat", local: true }],
            profiles: { local: { providerId: "custom-1", model } },
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
        nativeCallback(_plugin: string, _method: string, options: { endpointId: string; method: string; body?: { tools?: { name?: string; function?: { name?: string } }[] } }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: model }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          seam.requests.push({ endpoint: options.endpointId, tools: (options.body?.tools ?? []).map((tool) => String(tool.function?.name ?? tool.name ?? "")) });
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

test("AI routines: the phone sets one up in two steps, confirmed for a run nobody watches; run now, it reads, asks nothing and leaves a note", async ({ page, context }) => {
  test.setTimeout(150_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [says(BRIEF)]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  const inbox = () =>
    page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const listed = await fs.readdir({ path: "vault/Inbox", directory: "DATA" }).catch(() => ({ files: [] as { name: string }[] }));
      return listed.files.map((file) => file.name);
    });
  try {
    await openApp(page);
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();
    const sheet = (title: string) => page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: title }) });

    // 1. The vault's AI settings hold the routines: none yet, and a word about when they run.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    const settings = page.getByTestId("settings-ai-vault");
    await expect(settings).toContainText("Routines run on this device while Plainva is open.");
    await expect(settings.getByTestId("settings-ai-routine")).toHaveCount(0);
    const add = settings.getByTestId("settings-ai-routine-add");
    await add.scrollIntoViewIfNeeded();
    await expect(add).toContainText("Every active skill that only reads can become a routine.");
    await add.click();

    // 2. The form, as a sheet: it starts with the working days at seven and the model of the profile "Local".
    const form = page.getByTestId("ai-routine-form");
    await expect(form).toBeVisible();
    await expect(form.getByTestId("ai-routine-next")).toBeDisabled();
    await form.getByTestId("ai-routine-name").fill("Morning brief");
    for (const day of [1, 2, 3, 4, 5]) await expect(form.getByTestId(`ai-routine-day-${day}`)).toHaveAttribute("aria-pressed", "true");
    await expect(form.getByTestId("ai-routine-time")).toHaveValue("07:00");
    await expect(form.getByTestId("ai-routine-model")).toContainText(`Local — ${SERVER} · ${MODEL}`);
    // Every day chip is on the screen: seven of them wrap, none leaves it.
    const width = page.viewportSize()!.width;
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const box = (await form.getByTestId(`ai-routine-day-${day}`).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-routine-form-mobile.png") });
    await form.getByTestId("ai-routine-next").scrollIntoViewIfNeeded();
    await form.getByTestId("ai-routine-next").click();

    // 3. What holds for a run nobody watches. Nothing was sent to put it together, and only this yes makes the routine.
    const confirm = page.getByTestId("ai-routine-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("“Morning brief” runs without you — so this holds for it");
    await expect(confirm.getByTestId("ai-routine-budget")).toHaveText("At most 8 steps, 12 tool calls and 6,000 tokens of output per run.");
    await expect(confirm.getByTestId("ai-routine-who")).toHaveText(`${SERVER} · ${MODEL} — a model on this device. Nothing leaves it.`);
    await expect(confirm.getByTestId("ai-routine-result")).toContainText("called “Morning brief – ");
    await expect(confirm.getByTestId("ai-consent")).toHaveCount(0);
    expect((await seam()).requests).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-routine-confirm-mobile.png") });
    await confirm.getByTestId("ai-routine-save").scrollIntoViewIfNeeded();
    await confirm.getByTestId("ai-routine-save").click();
    await expect(confirm).toHaveCount(0);

    // 4. The row: what it does and when, that it has not run, and when it will.
    const row = settings.getByTestId("settings-ai-routine");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Morning brief");
    // The time of day is written the way the language writes it ("07:00", "07:00 AM").
    await expect(row).toContainText(/Weekdays 0?7:00(\sAM)? · “Daily orientation” · /);
    await expect(row).toContainText(`· ${SERVER} · ${MODEL}`);
    await expect(row.getByTestId("settings-ai-routine-status")).toContainText("Not run yet");
    await row.scrollIntoViewIfNeeded();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-routine-list-mobile.png") });

    // 5. Tapping it offers what can be done with it; "Run now" sends one request to the model on this phone — with
    //    tools that read, and none that does anything else.
    await row.click();
    await sheet("Morning brief").getByText("Run now", { exact: true }).click();
    await expect.poll(inbox).toHaveLength(1);
    const { requests } = await seam();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.endpoint).toBe("custom-1");
    expect(requests[0]!.tools).toEqual(expect.arrayContaining(["read_note", "search_vault"]));
    for (const never of ["run_command", "find_tools", "call_tool", "use_skill", "fetch_url", "web_search", "propose_edit", "create_note", "create_task", "remember"]) expect(requests[0]!.tools).not.toContain(never);
    expect((await inbox())[0]).toMatch(/^Morning brief – \d{4}-\d{2}-\d{2}\.md$/);
    await expect(row.getByTestId("settings-ai-routine-status")).toContainText(/Last today .+ — note “Morning brief – \d{4}-\d{2}-\d{2}”/);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-routine-ran-mobile.png") });

    // 6. Paused from the same sheet, and the row says so.
    await row.click();
    await sheet("Morning brief").getByText("Pause", { exact: true }).click();
    await expect(row.getByTestId("settings-ai-routine-status")).toContainText("Paused");

    // 7. The conversation says once that the result is ready, with the way to the note.
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await expect(conversation.getByTestId("ai-routine-ready")).toContainText("“Morning brief” is ready.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-routine-ready-mobile.png") });
    await conversation.getByTestId("ai-routine-open").click();
    await expect(page.getByText(BRIEF, { exact: false }).first()).toBeVisible();
  } finally {
    sql.close();
  }
});
