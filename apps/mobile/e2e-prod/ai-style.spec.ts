import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory } from "./exampleVault";

/**
 * The writing style on the phone (AI harness P9-3), in the production bundle:
 * the memory's section takes a note as an example through the phone's note
 * picker, shows what this phone measures in it — each feature with its
 * numbers, each taken out on its own —, and "My style" at the composer gives
 * one conversation the app's lines about it, never a word of the note. The
 * same picker is the phone's "Pin a note…".
 *
 * The model is the native `AiNet` plugin, which a browser does not have: this
 * test stands in for it at the seam Capacitor offers (as `ai-snapshot.spec.ts`
 * does), a server of this phone that keeps every request.
 */

interface Seam {
  requests: { model: string; said: string }[];
}
type SeamGlobals = typeof globalThis & { __seam: Seam };

const SERVER = "localhost:8080";
const MODEL = "granite3.3:8b";
const WEEKLY = [
  "# Example",
  "",
  "Ich habe heute mit dem Studio gesprochen. Du kannst die Termine morgen prüfen.",
  "",
  "Das Budget steht noch nicht fest. Wir warten auf die Zahlen vom Verleih.",
  "",
  "## Offen",
  "- Termine für den zweiten Block klären",
  "- Budget mit dir abstimmen",
  "- Tonmischung: wer bezahlt das?",
  "- Drehplan für den Winter schreiben",
  "",
  "Ich schicke dir die Liste am Abend. Dann sehen wir weiter, z. B. am 3. März im Büro.",
  "",
  "Kannst du mir sagen, ob das passt? Ich brauche die Antwort bis Freitag.",
  "",
  "## Notizen",
  "Der Kunde will mehr Bilder vom Hafen. Das ist gut für uns. Wir haben genug Material.",
  "",
  "Die Kamera ist noch beim Verleih. Ich hole sie morgen ab, wenn du Zeit hast.",
  "",
  "- Kamera abholen",
  "- Akkus laden",
  "- Speicherkarten prüfen",
  "",
  "Am Ende des Tages ist alles fertig. Ich bin zufrieden mit dem Stand. Du auch?",
  "",
].join("\n");

const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const says = (text: string) =>
  `${chunk({ choices: [{ delta: { content: text } }] })}${chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } })}data: [DONE]\n\n`;

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
        nativeCallback(_plugin: string, _method: string, options: { method: string; body?: { model?: string; messages?: unknown } }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((chunk) => callback(chunk)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: model }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          seam.requests.push({ model: String(options.body?.model ?? ""), said: JSON.stringify(options.body?.messages ?? []) });
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

/** A note picked in the phone's picker: its name typed, its row tapped. */
async function pick(page: Page, name: string): Promise<void> {
  const sheet = page.getByTestId("note-pick-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("note-pick-search").fill(name);
  await sheet.getByTestId("note-pick-row").filter({ hasText: name }).first().click();
  await expect(sheet).toHaveCount(0);
}

test("AI writing style: the phone measures a note it was given as an example, takes a feature out on its own, and gives one chosen conversation only the app's lines", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await installSeam(context, [says("Hier ist ein Entwurf, kurz und in Listen.")]);
  const seam = () => page.evaluate(() => (globalThis as SeamGlobals).__seam);
  try {
    await openApp(page);
    await seedExampleNote(page, WEEKLY);
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Example.md'"), { timeout: 20_000 }).toBe(1);

    // 1. The memory's section on the AI screen: an example through the phone's note picker.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    await page.getByTestId("ai-history-memory").click();
    const memory = page.getByTestId("ai-memory");
    await expect(memory).toContainText("No examples yet.");
    await memory.getByTestId("ai-style-pick").click();
    await pick(page, "Example");
    await expect(memory.getByTestId("ai-style-example")).toContainText("Example");
    const address = memory.locator('[data-testid="ai-style-feature"][data-key="address"]');
    await expect(address).toContainText("Addresses people as “du”");
    await expect(address).toContainText("“du” 6 times, “Sie” never");

    // 2. One feature out on its own, and back.
    await address.getByTestId("ai-style-remove").click();
    await expect(address).toHaveCount(0);
    await expect(memory.getByTestId("ai-style-removed")).toContainText("Taken out: Form of address");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-style-memory-mobile.png") });
    await memory.getByTestId("ai-style-restore").click();
    await expect(address).toBeVisible();
    expect((await seam()).requests).toHaveLength(0);

    // 3. The composer: "Pin a note…" is the same picker; "My style" beside the globe, for this one conversation.
    await page.getByRole("button", { name: "Back" }).first().click();
    const conversation = page.getByTestId("ai-conversation");
    await conversation.getByRole("button", { name: "Pin a note…" }).click();
    await pick(page, "Example");
    await expect(conversation.locator(".pv-ai-chips")).toContainText("Example");
    const toggle = conversation.getByTestId("ai-style-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await conversation.getByTestId("ai-input").fill("Schreib mir eine Notiz für die Vorbesprechung morgen.");
    await conversation.getByTestId("ai-send").click();
    await expect(conversation.getByText("Hier ist ein Entwurf, kurz und in Listen.")).toBeVisible({ timeout: 20_000 });
    await expect(conversation.getByTestId("ai-style-marking")).toContainText("With your writing style");
    const said = (await seam()).requests.at(-1)!.said;
    expect(said).toContain("follow their own writing style");
    expect(said).toContain("Addresses people informally (in German:");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-style-conversation-mobile.png") });
  } finally {
    sql.close();
  }
});
