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
/** A picture of 400 × 400 pixels in one colour: what a picture from the network brings once the person loads it (review B7-2). */
const TALL_PICTURE = "iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAIAAAAP3aGbAAAD40lEQVR42u3UMQ0AAAjAsPk3DSo4SJpUwY41BfCCBIBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFGJYEgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhAUgAGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWAASAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBZgWBIAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAIYFYFiAYQEYFoBhAYYFYFgAhgUYFoBhARgWYFgAhgVgWIBhARgWYFgAhgVgWIBhARgWgGEBhgVgWACGBRgWgGEBGBZgWACGBWBYgGEBGBaAYQGGBWBYAIYFGBaAYQEYFmBYAKcWwDKzcxmh0qoAAAAASUVORK5CYII=";
/** The address the gate answers with it; nothing else from the network loads. */
const PICTURE_HOST = "https://img.example";

async function loadProbe(page: Page) {
  await page.route("**/__mail_frames", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script type="module">
    await import('/e2e/fixtures/mailFrameProbe.ts');</script></body></html>` }));
  await page.route(`${PICTURE_HOST}/**`, (route) => route.fulfill({ contentType: "image/png", body: Buffer.from(TALL_PICTURE, "base64") }));
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
    // Turned around without an override (review B7-2, M11): the person reads the second before the first.
    { name: "U+2067 isolate with a mark between two Latin words", html: `<p>VISIBLEd4 &#x2067;SECRETd4a &#x200F; SECRETd4b&#x2069; end</p>` },
    { name: "dir=rtl paragraph with a mark between two Latin words", html: `<p>VISIBLEd5</p><p dir="rtl">SECRETd5a &#x200F; SECRETd5b</p>` },
    { name: "U+202B embedding with a mark between two Latin words", html: `<p>VISIBLEd6 &#x202B;SECRETd6a &#x200F; SECRETd6b&#x202C; end</p>` },
  ],
  kept: [
    { name: "dir=rtl paragraph with Latin words", html: `<p dir="rtl">VISIBLEr1 שלום עולם VISIBLEr1b</p>` },
    { name: "U+202B embedding", html: `<p>&#x202B;VISIBLEr2 مرحبا&#x202C; VISIBLEr2b</p>` },
    { name: "U+2067 isolate", html: `<p>start &#x2067;VISIBLEr3 مرحبا&#x2069; VISIBLEr3b</p>` },
    { name: "Arabic newsletter row", html: `<table dir="rtl" width="100%"><tr><td>VISIBLEr4 النشرة الإخبارية</td><td>VISIBLEr4b</td></tr></table>` },
    // A Latin name of two words inside a Hebrew or an Arabic sentence keeps its order: it is read (M11).
    { name: "a Latin brand of two words in a Hebrew sentence", html: `<p dir="rtl">קנו עכשיו VISIBLEr5 VISIBLEr5b במבצע</p>` },
    { name: "a Latin product name in an Arabic sentence with marks", html: `<p dir="rtl">&#x200F;اشترِ VISIBLEr6 VISIBLEr6b الآن&#x200F;</p>` },
    { name: "numbers in a right-to-left sentence", html: `<p dir="rtl">VISIBLEr7 السعر 12 34 دينار</p>` },
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

/**
 * Pictures from the network (review B7-2, S3; regel B): the engine never loads them, and the person may. Whatever size
 * the reader leaves to the picture counts as large as the reader allows; the assistant reads only words the pixel judge
 * sees in the reader without pictures AND with them loaded. The first seven are the review's p1–p7; the rest are
 * ordinary forms of newsletters, which must keep every word a person sees both ways.
 */
const SRC = `${PICTURE_HOST}/tall.png`;
const PICTURES = [
  { name: "p1 width/height attributes, 4 px high by its attribute", html: `<div style="height:0;white-space:nowrap">SECRETATTR here</div><div><img src="${SRC}" width="300" height="4"></div><p>VISIBLEATTR</p>` },
  { name: "p2 style height:auto", html: `<div style="height:0;white-space:nowrap">SECRETAUTO here</div><div><img src="${SRC}" style="height:auto"></div><p>VISIBLEAUTO</p>` },
  { name: "p3 style min-height:1px", html: `<div style="height:0;white-space:nowrap">SECRETMINH here</div><div><img src="${SRC}" style="min-height:1px"></div><p>VISIBLEMINH</p>` },
  { name: "p4 style line-height:1", html: `<div style="height:0;white-space:nowrap">SECRETLINEH here</div><div><img src="${SRC}" style="line-height:1"></div><p>VISIBLELINEH</p>` },
  { name: "p5 no size at all", html: `<div style="height:0;white-space:nowrap">SECRETNOSIZE here</div><div><img src="${SRC}"></div><p>VISIBLENOSIZE</p>` },
  // A block of 4 px over the line's top leading: it touches no letter. Made larger, it would cover the word.
  { name: "p6 an inline size of 300 × 4 px keeps it", html: `<div style="height:0;white-space:nowrap">VISIBLEINLINE here</div><div><img src="${SRC}" style="width:300px;height:4px;display:block"></div><p>VISIBLEINLINEB</p>` },
  { name: "p7 a width attribute only", html: `<div style="height:0;white-space:nowrap">SECRETWONLY here</div><div><img src="${SRC}" width="300"></div><p>VISIBLEWONLY</p>` },
  // As wide as its box by its own width, its height left to the picture up to 30 px: covers the line above it, not one 60 px below.
  { name: "a max-height bounds it", html: `<div style="height:0;white-space:nowrap">SECRETMAXH here</div><div><img src="${SRC}" style="width:100%;max-height:30px"></div><div style="height:0;padding-top:60px;white-space:nowrap">VISIBLEBELOWMAX here</div><p>VISIBLEMAXH</p>` },
  { name: "ordinary: a logo without size above the text", html: `<table width="600"><tr><td align="center"><img src="${SRC}" alt="Shop"></td></tr><tr><td>VISIBLEn1 Neuheiten der Woche</td></tr></table>` },
  { name: "ordinary: a hero picture held by height:auto, text below", html: `<img src="${SRC}" style="width:100%;height:auto;display:block"><h2>VISIBLEn2 Sale</h2><p>VISIBLEn3 Nur heute</p>` },
  { name: "ordinary: a picture beside the text in a table, width attribute only", html: `<table width="600"><tr><td width="200"><img src="${SRC}" width="180"></td><td valign="top">VISIBLEn4 Artikel und Preis</td></tr></table>` },
  // Longer than the measuring frame and the window (review B7-2): 2 000 px down, a box too faint to hide anything lies
  // over a word. It paints, so the word is asked of the engine point by point — WebKit answers no hit test in a frame
  // outside the window, and the word would count as covered.
  { name: "a long mail: a faint box over a word far down", html: `<div style="height:2000px"></div><div style="height:0;white-space:nowrap">VISIBLEFAR here</div><div style="background-color:#000000;opacity:0.05;height:30px"></div><p>VISIBLEFARB</p>` },
  { name: "ordinary: icons without size in a line of text", html: `<p><img src="${SRC}" style="vertical-align:middle"> VISIBLEn5 Folge uns <img src="${SRC}" style="vertical-align:middle"></p>` },
];

test("pictures from the network: the assistant reads only what the reader shows with them and without them", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1800, height: 1400 });
  await loadProbe(page);
  const wrong: string[] = [];
  let takenAway = 0;
  for (const entry of PICTURES) {
    for (const width of [343, 760, 1200]) {
      await page.evaluate((w) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.readerWidth(w), width);
      const shown = new Map<string, number>();
      let ai: string[] = [];
      for (const pictures of [false, true]) {
        const open = await page.evaluate(([h, w, p]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w, undefined, p), [entry.html, width, pictures] as const);
        // The judge sees what the person sees only once the picture is there: with pictures, every one has loaded.
        if (pictures && entry.html.includes(SRC)) {
          const loaded = await page.evaluate(() => Array.from((document.getElementById("pv-marked-frame") as HTMLIFrameElement).contentDocument!.images).every((image) => image.complete && image.naturalWidth > 0));
          expect(loaded, `${entry.name} at ${width} px: the picture from the network loaded in the reader`).toBe(true);
        }
        ai = open.ai;
        const shares = await inkShares(page, open);
        for (const word of Array.from(entry.html.matchAll(/(?:SECRET|VISIBLE)[A-Z0-9a-z]+/g), (m) => m[0])) {
          const share = open.frame.seen.includes(word) ? (shares.get(word) ?? 0) : 0;
          shown.set(word, Math.min(shown.get(word) ?? 1, share));
        }
      }
      for (const [word, share] of shown) {
        const read = ai.includes(word);
        if (read && share < MIN_INK_SHARE) wrong.push(`${entry.name}: at ${width} px the assistant reads ${word}, the reader does not show it ${share < MIN_INK_SHARE ? "with or without pictures" : ""}`);
        if (!read && share >= MIN_INK_SHARE) {
          takenAway++;
          wrong.push(`${entry.name}: at ${width} px the assistant leaves out ${word}, the reader shows it both ways (${Math.round(share * 100)} %)`);
        }
      }
    }
  }
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
  test.info().annotations.push({ type: "visible words taken away", description: String(takenAway) });
  expect(wrong).toEqual([]);
});

test("a mail too long to check in time: the assistant reads none of it, and is told why (review B7-2, F3)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  // 20 000 words, each one running into the next box: every one is asked of the engine, past the budget.
  const words = Array.from({ length: 20_000 }, (_, n) => `w${n}`).join(" ");
  const html = `<div style="height:0;white-space:nowrap">${words}</div><div style="height:0;white-space:nowrap">${words}</div><p>VISIBLEend</p>`;
  const open = await page.evaluate(([h]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, 760), [html] as const);
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
  expect(open.ai).toEqual([]);
  expect(open.aiText).toContain("too long for Plainva to check in time");
});

/**
 * The pass in step with the interface (review B7-2, H14/H15): a mail of 3 000 boxes that paint holds the interface no
 * longer than a slice at a time, and in a hidden window — whose timers the engine throttles — an ordinary mail is
 * still read in time. Measured, and the numbers go into the report.
 */
test("the engine pass keeps its pace with many painting boxes and in a hidden window", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  const painting = `<p>VISIBLEpaint</p>${Array.from({ length: 3000 }, (_, n) => `<span style="background-color:#eef;border:1px solid #ccd">c${n}</span>`).join(" ")}`;
  const ordinary = MAIL_CORPUS.find((entry) => entry.name === "dark theme newsletter")!.html;
  // A mail of real work for the pass — 1 000 words that all run into the next box, each asked of the engine: well
  // within the budget in either engine, and many turns of the interface.
  const words = Array.from({ length: 1000 }, (_, n) => `w${n}`).join(" ");
  const heavy = `<div style="height:0;white-space:nowrap">${words}</div><div style="height:0;white-space:nowrap">${words}</div><p>VISIBLEheavy</p>`;
  // Each measure a mail of its own: the reader keeps a mail's reading once made (`mailHtmlView`), a second one of the
  // same text would measure nothing.
  let made = 0;
  const measure = (html: string) =>
    page.evaluate(async ([h]) => {
      const longest = { ms: 0 };
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longest.ms = Math.max(longest.ms, entry.duration);
      });
      try {
        observer.observe({ type: "longtask", buffered: false });
      } catch {
        /* silent: an engine without long-task entries reports 0 */
      }
      // The product's way alone: what the assistant reads, timed without the judge's frames.
      const started = performance.now();
      const read = await (window as unknown as MailFrameProbeWindow).mailFrameProbe.read(h);
      const took = performance.now() - started;
      observer.disconnect();
      return { took, longest: longest.ms, ai: Array.from(read.text.matchAll(/\b(?:SECRET|VISIBLE)[A-Za-z0-9_]*/g), (m) => m[0]), tooLong: read.text.includes("too long for Plainva to check in time") };
    }, [`${html}<!-- mail ${++made} -->`] as const);
  // Once to warm the engine and the modules up; the second is what a person meets.
  const cold = await measure(painting);
  const shown = await measure(painting);
  const shownHeavy = await measure(heavy);
  test.info().annotations.push({ type: "engine pass · painting, first run", description: `${Math.round(cold.took)} ms, longest task ${Math.round(cold.longest)} ms` });
  // A hidden or minimised window (H15): the engine throttles its timers to about one a second. Headless Chromium does
  // not hide a page behind another, so the throttling is laid on here — every timer of the page waits a second at least.
  const throttled = await page.evaluate(async () => {
    const plain = window.setTimeout.bind(window);
    (window as unknown as { setTimeout: unknown }).setTimeout = (handler: TimerHandler, ms?: number, ...rest: unknown[]) => plain(handler, Math.max(ms ?? 0, 1000), ...rest);
    // The throttling holds: a timer of no delay now waits a second.
    const at = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return performance.now() - at;
  });
  expect(throttled).toBeGreaterThan(900);
  const plainHeavy = shownHeavy;
  const hidden = await measure(ordinary);
  const hiddenPainting = await measure(painting);
  const hiddenHeavy = await measure(heavy);
  for (const [name, m] of [["painting", shown], ["heavy", plainHeavy], ["throttled ordinary", hidden], ["throttled painting", hiddenPainting], ["throttled heavy", hiddenHeavy]] as const) {
    test.info().annotations.push({ type: `engine pass · ${name}`, description: `${Math.round(m.took)} ms, longest task ${Math.round(m.longest)} ms, too long ${m.tooLong}` });
  }
  expect(shown.ai).toContain("VISIBLEpaint");
  // No task of the pass holds the interface longer than laying the mail out once does — what the reader itself pays
  // when it shows the mail, and what no pass can cut (review B7-2, H14).
  const layout = await page.evaluate(async ([h]) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:760px;height:600px;border:0";
    const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    frame.srcdoc = `<!doctype html><html><body style="margin:12px;font:14px/1.5 system-ui,sans-serif">${h}</body></html>`;
    document.body.append(frame);
    await loaded;
    const at = performance.now();
    void frame.contentDocument!.body.getBoundingClientRect();
    const took = performance.now() - at;
    frame.remove();
    return took;
  }, [`${painting}<!-- layout -->`] as const);
  test.info().annotations.push({ type: "the mail laid out once (no pass)", description: `${Math.round(layout)} ms` });
  // The way word by word holds no task long (it did: 488 ms in one). Open: a mail of thousands of painting boxes
  // still has one task of about 150 ms while its texts are gathered, not its layout — named in Performance_Notes.md.
  expect(plainHeavy.longest).toBeLessThan(100);
  expect(hidden.tooLong).toBe(false);
  expect(hidden.ai.length).toBeGreaterThan(0);
  expect(hiddenPainting.tooLong).toBe(false);
  // The mail of real work is read throttled as it is in front: the pass does not wait for timers.
  expect(plainHeavy.tooLong).toBe(false);
  expect(hiddenHeavy.tooLong).toBe(false);
  expect(hiddenHeavy.ai).toContain("VISIBLEheavy");
});

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

