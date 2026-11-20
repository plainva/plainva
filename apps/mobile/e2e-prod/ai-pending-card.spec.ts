import { test, expect, type BrowserContext, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory } from "./exampleVault";

/**
 * The card of a question that waits, on the phone (F71 of release 0.9.0, review of mockup M8): in the usual case — one
 * note, an iPhone's screen, the keyboard down — nothing of the card is covered by its pinned foot, and its lower edge
 * with the round corners is on screen. The model is the native `AiNet` plugin a browser lacks; the test stands in for
 * it at Capacitor's seam (as `ai-setup.spec.ts` does).
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

async function installSeam(context: BrowserContext, script: string[]): Promise<void> {
  await context.addInitScript(
    ({ script }) => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
      const promise = (name: string) => ({ name, rtype: "promise" });
      (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
        PluginHeaders: [{ name: "AiNet", methods: [...["cancel", "setKey", "hasKey", "deleteKey", "addEndpoint", "removeEndpoint", "setLocalOnly"].map(promise), { name: "request", rtype: "callback" }] }],
        async nativePromise(_plugin: string, method: string) {
          if (method === "hasKey") return { present: true };
          return {};
        },
        nativeCallback(_plugin: string, _method: string, options: { method: string }, callback: (chunk: unknown) => void) {
          const send = (chunks: unknown[]) => queueMicrotask(() => chunks.forEach((piece) => callback(piece)));
          if (options.method === "GET") {
            send([{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: "m-1", display_name: "Model One" }] }) }, { type: "done" }]);
            return Promise.resolve("ai");
          }
          const text = script.shift();
          send(text === undefined ? [{ type: "failed", code: "network", message: "offline" }] : [{ type: "open", status: 200 }, { type: "data", text }, { type: "done" }]);
          return Promise.resolve("ai");
        },
      };
    },
    { script },
  );
}

/** Where the card stands against its foot, the pending column and the screen. */
async function placed(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="ai-consent"]') as HTMLElement;
    const foot = card.querySelector(".pv-ai-overview-actions") as HTMLElement;
    const pending = document.querySelector('[data-testid="ai-pending"]') as HTMLElement;
    const footTop = foot.getBoundingClientRect().top;
    // Everything the card says or offers above its foot: the lines of the overview and every control.
    const above = [...card.querySelectorAll("dt, dd, li, p, button, [role='switch'], .pv-ai-overview-head")].filter((el) => !foot.contains(el)) as HTMLElement[];
    const covered = above.filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom > footTop + 0.5).map((el) => (el.textContent ?? el.tagName).trim().slice(0, 40));
    const box = card.getBoundingClientRect();
    return {
      covered,
      cardBottom: box.bottom,
      pendingBottom: pending.getBoundingClientRect().bottom,
      viewport: innerHeight,
      scrolls: card.scrollHeight - card.clientHeight > 1,
      details: Boolean(card.querySelector('[data-testid="ai-overview-more"]')),
    };
  });
}

for (const size of [{ width: 375, height: 812 }, { width: 390, height: 844 }]) {
  test(`at ${size.width} × ${size.height}, nothing of the waiting card is covered by its foot, and its lower edge is on screen`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    const sql = await installSqlBridge(context);
    await installSeam(context, [says("This week the kick-off is planned.")]);
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    try {
      await page.goto("/");
      await waitForVaultDirectory(page);
      await seedExampleNote(page);
      await page.getByTestId("tab-areas").click();
      await page.getByTestId("areas-ai").click();
      const conversation = page.getByTestId("ai-screen");
      await conversation.getByTestId("ai-input").fill("What is planned this week for the example?");
      await conversation.getByTestId("ai-send").click();
      await expect(page.getByTestId("ai-consent")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(300);
      const at = await placed(page);
      expect(at.covered, "nothing of the card lies under its foot").toEqual([]);
      expect(at.scrolls, "the usual card needs no scrolling").toBe(false);
      expect(at.cardBottom, "the card's lower edge stands inside the pending column").toBeLessThanOrEqual(at.pendingBottom + 0.5);
      expect(at.cardBottom, "and on the screen").toBeLessThanOrEqual(at.viewport);
      if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath(`ai-pending-card-${size.width}.png`) });
    } finally {
      sql.close();
    }
  });
}
