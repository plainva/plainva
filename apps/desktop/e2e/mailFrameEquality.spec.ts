import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./fixtures/clockedTest";
import { openProbePage } from "./fixtures/openProbePage";
import { MAIL_FRAME_CASES } from "./fixtures/mailFrameCases";
import { MAIL_CORPUS } from "./fixtures/mailFrameCorpus";
import { MIN_INK_SHARE, type Measured, type PageBox } from "./fixtures/mailFrameJudge";
import type { MailFrameProbeWindow } from "./fixtures/mailFrameProbe";
import type { MarkedFrameResult } from "./fixtures/mailFrameRun";

/**
 * What the assistant reads of a mail is what the reader shows — judged by the
 * engine that draws the reader, not by a model of one (review of 2026-11-17,
 * Fehlerliste 0.9.0 F23). Runs in the WebKit editor regression job (the engine
 * of macOS, iOS and the Linux shell) and with the Chromium probes (WebView2 and
 * Android).
 *
 * Each case is rendered in a reader frame at a phone and a desktop width,
 * fitted as the shells fit it (`mailFrameRun.ts`), and judged
 * (`mailFrameJudge.ts`), a marker word by the share of its ink on the screen
 * (`inkShares`). Two things hold for every case:
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

type Probe = MailFrameProbeWindow["mailFrameProbe"];

/**
 * The share of each marker word's ink that reaches the screen in the open
 * frame (review of 2026-11-18, rule 4), its best showing where it stands more
 * than once: the pixels that change when the word turns transparent, against
 * the pixels it leaves alone, in its own colour on its own ground. Words that lie apart are shot
 * together; a word across another, or where the frame scrolls to, alone.
 */
async function inkShares(page: Page, open: MarkedFrameResult): Promise<Map<string, number>> {
  const shares = new Map<string, number>();
  const keep = (word: string, share: number) => shares.set(word, Math.max(shares.get(word) ?? 0, share));
  const shoot = (clip: PageBox) => page.screenshot({ clip, fullPage: true, animations: "disabled", caret: "hide" }).then((b) => b.toString("base64"));
  const mode = (m: "shown" | "gone" | "ink" | "none", k?: number) => page.evaluate(([m, k]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.mode(m, k), [m, k] as const);
  const ink = (a: string, b: string, boxes: PageBox[]) => page.evaluate(([a, b, boxes]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.ink(a, b, boxes), [a, b, boxes] as const);
  const together = open.words.filter((w) => w.box && !w.alone);
  if (together.length > 0) {
    const clip = open.clip;
    const shots: string[] = [];
    for (const m of ["shown", "gone", "ink", "none"] as const) {
      await mode(m);
      shots.push(await shoot(clip));
    }
    await mode("shown");
    const boxes = together.map((w) => ({ x: w.box!.x - clip.x, y: w.box!.y - clip.y, width: w.box!.width, height: w.box!.height }));
    const shown = await ink(shots[0], shots[1], boxes);
    const alone = await ink(shots[2], shots[3], boxes);
    together.forEach((w, i) => keep(w.word, alone[i] ? shown[i] / alone[i] : 0));
  }
  for (const w of open.words.filter((w) => w.alone || !w.box)) {
    const box = await page.evaluate((k) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.scrollTo(k), w.k);
    if (!box) {
      keep(w.word, 0);
      continue;
    }
    const shots: string[] = [];
    for (const m of ["shown", "gone", "ink", "none"] as const) {
      await mode(m, w.k);
      shots.push(await shoot(box));
    }
    await mode("shown");
    const whole = [{ x: 0, y: 0, width: box.width, height: box.height }];
    const [shown] = await ink(shots[0], shots[1], whole);
    const [alone] = await ink(shots[2], shots[3], whole);
    keep(w.word, alone ? shown / alone : 0);
  }
  return shares;
}

for (const width of [343, 760] as const) {
  test(`at ${width} px the assistant reads no more than the reader shows, and the reader loses nothing main showed`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1000, height: 900 });
    await loadProbe(page);
    const wrong: string[] = [];
    const limits: string[] = [];
    for (const entry of MAIL_FRAME_CASES) {
      const open = await page.evaluate(([h, w]) => ((window as unknown as MailFrameProbeWindow).mailFrameProbe as Probe).open(h, w), [entry.html, width] as const);
      const shares = await inkShares(page, open);
      const judged = new Set(open.frame.seen);
      const why = (word: string) => {
        if (!judged.has(word)) return open.frame.hidden[word] ?? "absent";
        const share = shares.get(word) ?? 0;
        return share < MIN_INK_SHARE ? `${Math.round(share * 100)} % of its ink on the screen` : null;
      };
      for (const word of open.ai) {
        const hidden = why(word);
        if (hidden === null) continue;
        const line = `${entry.name}: the assistant reads ${word}, the reader does not show it (${hidden})`;
        if (entry.limit && word.startsWith("SECRET")) limits.push(line);
        else wrong.push(line);
      }
      for (const url of open.aiLinks) if (!open.frame.links.includes(url)) wrong.push(`${entry.name}: the assistant reads the link ${url}, the reader shows none`);
      for (const word of entry.mainSeen[String(width) as "343" | "760"]) {
        const hidden = why(word);
        if (hidden !== null) wrong.push(`${entry.name}: main showed ${word}, the reader does not (${hidden})`);
      }
    }
    await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
    // The named limits stand in the report, not as failures; the maintainer decides on them.
    for (const line of limits) test.info().annotations.push({ type: "named limit", description: line });
    expect(wrong).toEqual([]);
  });
}

/**
 * The width of this device's reader (B7, review S2): a mail can hide a word only at one width — the desktop's column
 * is as wide as the person makes it. Once the reader showed mails at that width, the assistant reads no word the frame
 * hides there; each case below shows the word at the gate's widths and covers it at its own.
 */
const RED = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4IScHRwzEcQCxYxBBO0tjggAAAABJRU5ErkJggg==";
const AT_ONE_WIDTH = [
  {
    width: 600,
    // The word starts at 110 px + 30 % of the line and is 28 px or so wide; the picture is 60 % of the line, at most
    // 321 px. With W the line (the frame less its 24 px margins): at 343 px the picture ends at 191 px and the word
    // starts at 206 px; at 600 px the picture ends at 321 px and the word lies at 283–311 px; at 760 px the word
    // starts at 331 px, past the picture. Covered only between about 560 and 720 px.
    name: "a word at 110 px + 30 % beside a picture of 60 % up to 321 px: covered only between about 560 and 720 px",
    html: `<p>VISIBLEw600</p><div style="height:0;padding-left:30%;white-space:nowrap"><span style="padding-left:110px;font-size:6px">SECRETw6</span></div><div><img src="data:image/png;base64,${RED}" style="width:60%;max-width:321px;height:40px"></div>`,
  },
  {
    width: 1100,
    // The word at 400 px, the picture 50 % of the line: it reaches past the word from a line of about 990 px on.
    name: "a word at 400 px beside a picture of 50 %: covered from about 1010 px on",
    html: `<p>VISIBLEw1100</p><div style="height:0;padding-left:400px;white-space:nowrap">SECRETw1100</div><div><img src="data:image/png;base64,${RED}" style="width:50%;height:40px"></div>`,
  },
  {
    width: 1200,
    name: "review B7 c3b: a picture of 45 % covers a word at 400 px only on a wide column",
    html: `<div style="height:0;padding-left:400px;white-space:nowrap">SECRETWIDEB</div><div><img src="data:image/png;base64,${RED}" style="width:45%;height:40px"></div><p>VISIBLEBASEB</p>`,
  },
];

test("at the width this device's reader shows mails in, the assistant reads no word the frame hides there", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1300, height: 900 });
  await loadProbe(page);
  const wrong: string[] = [];
  for (const entry of AT_ONE_WIDTH) {
    const secret = Array.from(entry.html.matchAll(/SECRET[A-Za-z0-9]+/g), (m) => m[0])[0]!;
    // The case means something: at the gate's widths the frame shows the word.
    for (const width of [343, 760]) {
      await page.evaluate((w) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.readerWidth(w), width);
      const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, width] as const);
      const shares = await inkShares(page, open);
      if (!open.frame.seen.includes(secret) || (shares.get(secret) ?? 0) < MIN_INK_SHARE) wrong.push(`${entry.name}: at ${width} px the frame already hides ${secret}`);
    }
    await page.evaluate((w) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.readerWidth(w), entry.width);
    const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, entry.width] as const);
    const shares = await inkShares(page, open);
    const shown = open.frame.seen.includes(secret) && (shares.get(secret) ?? 0) >= MIN_INK_SHARE;
    if (shown) wrong.push(`${entry.name}: at ${entry.width} px the frame shows ${secret} — the case covers nothing there`);
    if (open.ai.includes(secret)) wrong.push(`${entry.name}: at ${entry.width} px the assistant reads ${secret}, the reader does not show it`);
  }
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
  expect(wrong).toEqual([]);
});

/**
 * Text drawn under a direction override (B7, review H7): a person sees the letters mirrored, a machine reads them
 * plainly — the assistant reads none of it. Right-to-left text as mail writes it — `dir="rtl"`, an embedding, an
 * isolate — keeps every word.
 */
const DIRECTION = {
  hidden: [
    { name: "U+202E override", html: `<p>VISIBLEd1</p><p>&#x202E;SECRETd1 gnissim&#x202C; after</p>` },
    { name: "bdo dir=rtl", html: `<p>VISIBLEd2</p><p><bdo dir="rtl">SECRETd2 words</bdo></p>` },
    { name: "U+202D override", html: `<p>VISIBLEd3</p><p>&#x202D;SECRETd3&#x202C;</p>` },
  ],
  kept: [
    { name: "dir=rtl paragraph with Latin words", html: `<p dir="rtl">VISIBLEr1 שלום עולם VISIBLEr1b</p>` },
    { name: "U+202B embedding", html: `<p>&#x202B;VISIBLEr2 مرحبا&#x202C; VISIBLEr2b</p>` },
    { name: "U+2067 isolate", html: `<p>start &#x2067;VISIBLEr3 مرحبا&#x2069; VISIBLEr3b</p>` },
    { name: "Arabic newsletter row", html: `<table dir="rtl" width="100%"><tr><td>VISIBLEr4 النشرة الإخبارية</td><td>VISIBLEr4b</td></tr></table>` },
  ],
};

test("text under a direction override is not read; right-to-left text, embeddings and isolates keep every word", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  const wrong: string[] = [];
  for (const entry of DIRECTION.hidden) {
    const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, 760] as const);
    for (const word of open.ai) if (word.startsWith("SECRET")) wrong.push(`${entry.name}: the assistant reads ${word}, drawn mirrored`);
    if (!open.ai.some((word) => word.startsWith("VISIBLE"))) wrong.push(`${entry.name}: the assistant lost the words around it`);
  }
  for (const entry of DIRECTION.kept) {
    const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, 760] as const);
    const all = Array.from(entry.html.matchAll(/VISIBLE[a-z0-9]+/g), (m) => m[0]);
    for (const word of all) if (!open.ai.includes(word)) wrong.push(`${entry.name}: the assistant does not read ${word}`);
  }
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
  expect(wrong).toEqual([]);
});

/**
 * The second measure (review of 2026-11-17, rule 3): ordinary newsletters,
 * which hide nothing, look as they do at `main`. Frozen is the frame document
 * `main` made of each case (`mailFrameCorpus.main.json`), not its sizes — a
 * size hangs on the fonts of the machine; both frames are laid out and
 * measured side by side, in the engine the test runs in. For every element with words and every
 * element that paints: the same box (width and height within 1 px), the same
 * computed colour and background, and words at least as readable as at main
 * (contrast at least the smaller of 4.5 and main's). An element the reader
 * shows otherwise on purpose is named with its reason in the case (`differs`).
 */
type FrozenCorpus = { docs: Record<"false" | "true", Record<string, string>> };
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
    test(`at ${width} px ${pictures ? "with" : "without"} pictures ordinary newsletters look as at main, and the assistant reads no more than they show`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1000, height: 900 });
      await loadProbe(page);
      const docs = MAIN_CORPUS.docs[String(pictures) as "false" | "true"];
      const cases = MAIL_CORPUS.map(({ name, html }) => ({ name, html }));
      const results = await page.evaluate(([c, w, p, d]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.corpus(c, w, p, d), [cases, width, pictures, docs] as const);
      const wrong: string[] = [];
      /** The words the engine left out of an ordinary mail at this width, to be judged by their pixels (B7, review H8). */
      const owed: { index: number; words: string[] }[] = [];
      results.forEach((result, index) => {
        for (const word of result.ai) if (!result.seen.includes(word)) wrong.push(`${result.name}: the assistant reads ${word}, the reader does not show it`);
        // An ordinary mail hides nothing by where its boxes lie: the engine takes no word of it away (B7, F23).
        if (result.dropped.length > 0) owed.push({ index, words: result.dropped });
        const main = result.mainMeasured;
        if (!main) wrong.push(`${result.name}: no frame of main frozen`);
        else wrong.push(...corpusDeviations(result.name, main, result.measured, MAIL_CORPUS[index].differs ?? {}));
      });
      // A word the engine leaves out is one a person does not see: less than half of its ink reaches the screen,
      // judged by the pixels — not by the engine's own measure (B7, review H8).
      for (const { index, words } of owed) {
        const open = await page.evaluate(([h, w, only]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w, only), [MAIL_CORPUS[index].html, width, words] as const);
        const shares = await inkShares(page, open);
        for (const word of words) {
          // Of the part of it the frame lets a person reach (a word cut off at its edge counts by what is inside).
          const reach = Math.max(0, ...open.words.filter((w) => w.word === word).map((w) => w.reach));
          const share = (shares.get(word) ?? 0) * reach;
          if (share >= MIN_INK_SHARE) wrong.push(`${MAIL_CORPUS[index].name}: the engine takes ${word} away, ${Math.round(share * 100)} % of its ink is on the screen`);
        }
      }
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

