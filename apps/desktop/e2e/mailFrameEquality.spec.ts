import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./fixtures/clockedTest";
import { openProbePage } from "./fixtures/openProbePage";
import { MAIL_FRAME_CASES } from "./fixtures/mailFrameCases";
import { MAIL_CORPUS } from "./fixtures/mailFrameCorpus";
import type { Measured } from "./fixtures/mailFrameJudge";
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
 * And ordinary newsletters look as at `main` (the second measure, below).
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

/**
 * The second measure (review of 2026-11-17, rule 3): ordinary newsletters,
 * which hide nothing, look as they do at `main` — measured in the engine the
 * test runs in, against what `main` measured in that engine
 * (`mailFrameCorpus.main.json`). For every element with words and every
 * element that paints: the same box (width and height within 1 px), the same
 * computed colour and background, and words at least as readable as at main
 * (contrast at least the smaller of 4.5 and main's). An element the reader
 * shows otherwise on purpose is named with its reason in the case (`differs`).
 */
type FrozenCorpus = { engines: Record<string, Record<string, Record<string, Measured[]>>> };
const MAIN_CORPUS = JSON.parse(readFileSync(new URL("./fixtures/mailFrameCorpus.main.json", import.meta.url), "utf8")) as FrozenCorpus;

function corpusDeviations(name: string, main: Measured[], now: Measured[], differs: Record<string, string>): string[] {
  if (differs["*"]) return [];
  // An element is excused by its own path only: what stands inside it is measured as at main.
  const excused = (path: string) => Object.prototype.hasOwnProperty.call(differs, path);
  const at = new Map(now.map((entry) => [entry[0], entry]));
  const was = new Set(main.map((entry) => entry[0]));
  const out: string[] = [];
  for (const before of main) {
    if (excused(before[0])) continue;
    const after = at.get(before[0]);
    if (!after) {
      out.push(`${name} ${before[0]} <${before[1]}>: gone`);
      continue;
    }
    const why: string[] = [];
    if (Math.abs(after[2] - before[2]) > 1 || Math.abs(after[3] - before[3]) > 1) why.push(`box ${before[2]}×${before[3]} → ${after[2]}×${after[3]}`);
    if (after[4] !== before[4]) why.push(`colour ${before[4]} → ${after[4]}`);
    if (after[5] !== before[5]) why.push(`background ${before[5]} → ${after[5]}`);
    if (before[6] !== null && (after[6] === null || after[6] < Math.min(4.5, before[6]) - 0.01)) why.push(`contrast ${before[6]} → ${after[6]}`);
    if (why.length > 0) out.push(`${name} ${before[0]} <${before[1]}>: ${why.join("; ")}`);
  }
  for (const entry of now) if (!was.has(entry[0]) && !excused(entry[0])) out.push(`${name} ${entry[0]} <${entry[1]}>: painted or worded only now`);
  return out;
}

for (const width of [343, 760] as const) {
  for (const pictures of [false, true]) {
    test(`at ${width} px ${pictures ? "with" : "without"} pictures ordinary newsletters look as at main, and the assistant reads no more than they show`, async ({ page, browserName }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1000, height: 900 });
      await loadProbe(page);
      const frozen = MAIN_CORPUS.engines[browserName]?.[`${width}/${pictures}`];
      expect(frozen, `main measured in ${browserName}`).toBeTruthy();
      const cases = MAIL_CORPUS.map(({ name, html }) => ({ name, html }));
      const results = await page.evaluate(([c, w, p]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.corpus(c, w, p), [cases, width, pictures] as const);
      const wrong: string[] = [];
      results.forEach((result, index) => {
        for (const word of result.ai) if (!result.seen.includes(word)) wrong.push(`${result.name}: the assistant reads ${word}, the reader does not show it`);
        const main = frozen![result.name];
        if (!main) wrong.push(`${result.name}: not measured at main`);
        else wrong.push(...corpusDeviations(result.name, main, result.measured, MAIL_CORPUS[index].differs ?? {}));
      });
      expect(wrong).toEqual([]);
      expect(results.length).toBe(MAIL_CORPUS.length);
    });
  }
}

test("a mail wider than a phone's frame at its least scale scrolls sideways to its far edge", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  // A line that keeps itself whole is wide in every engine (a wide picture in a cell shrinks to it in WebKit).
  const wide = `<p style="white-space:nowrap">${"word ".repeat(400)}VISIBLE far edge</p>`;
  const fit = await page.evaluate((html) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.scroll(html, 343), wide);
  expect(fit.scale).toBeCloseTo(0.4, 2);
  expect(fit.overflowX).toBe("auto");
  expect(fit.reach).toBeGreaterThan(0);
  expect(fit.moved).toBe(fit.reach);
});

