import { test, expect, type Page } from "./fixtures/clockedTest";
import { openProbePage } from "./fixtures/openProbePage";
import { MAIL_FRAME_CASES } from "./fixtures/mailFrameCases";
import type { MailFrameProbeWindow } from "./fixtures/mailFrameProbe";

/**
 * What the assistant reads of a mail is what the reader shows — judged by the
 * engine that draws the reader, not by a model of one (review of 2026-11-17,
 * Fehlerliste 0.9.0 F23). Runs in the WebKit editor regression job (the engine
 * of macOS, iOS and the Linux shell) and with the Chromium probes (WebView2 and
 * Android).
 *
 * Each case is rendered in a reader frame at a phone and a desktop width,
 * fitted as the shells fit it (`mailFrameRun.ts`), and judged
 * (`mailFrameJudge.ts`). Two things hold for every case:
 *  - every marker word and every link the assistant reads, the frame shows or
 *    lets a person reach;
 *  - every word the reader of `main` showed (frozen in `mailFrameCases.ts`),
 *    the reader shows now.
 */
async function loadProbe(page: Page) {
  await page.route("**/__mail_frames", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script type="module">
    await import('/e2e/fixtures/mailFrameProbe.ts');</script></body></html>` }));
  await openProbePage(page, "/__mail_frames", () => !!(window as unknown as MailFrameProbeWindow).mailFrameProbe);
}

for (const width of [343, 760] as const) {
  test(`at ${width} px the assistant reads no more than the reader shows, and the reader loses nothing main showed`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1000, height: 900 });
    await loadProbe(page);
    const cases = MAIL_FRAME_CASES.map(({ name, html }) => ({ name, html }));
    const results = await page.evaluate(([c, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.run(c, w), [cases, width] as const);
    const wrong: string[] = [];
    results.forEach((result, index) => {
      const seen = new Set(result.frame.seen);
      for (const word of result.ai) if (!seen.has(word)) wrong.push(`${result.name}: the assistant reads ${word}, the reader does not show it (${result.frame.hidden[word] ?? "absent"})`);
      for (const url of result.aiLinks) if (!result.frame.links.includes(url)) wrong.push(`${result.name}: the assistant reads the link ${url}, the reader shows none`);
      for (const word of MAIL_FRAME_CASES[index].mainSeen[String(width) as "343" | "760"]) {
        if (!seen.has(word)) wrong.push(`${result.name}: main showed ${word}, the reader does not (${result.frame.hidden[word] ?? "absent"})`);
      }
    });
    expect(wrong).toEqual([]);
    expect(results.length).toBe(MAIL_FRAME_CASES.length);
  });
}
