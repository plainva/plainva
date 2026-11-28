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
  await page.route(`${PICTURE_HOST}/**`, (route) =>
    route.request().url().endsWith("/logo.svg")
      ? route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#c00"/></svg>' })
      : route.fulfill({ contentType: "image/png", body: Buffer.from(TALL_PICTURE, "base64") }),
  );
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
 * isolate — keeps every word. Words that invisible direction marks only show in another order are read in the order
 * of the text (review B7-5, the maintainer's decision (a), as on `main`): `order` holds one case of each kind that
 * earlier rounds left out.
 */
const DIRECTION = {
  // Measured against the reader (review B7-7): a word a person sees mirrored is not read, one drawn plainly is read.
  hidden: [
    { name: "d1 U+202E override", html: `<p>VISIBLEd1</p><p>&#x202E;SECRETd1 gnissim&#x202C; after</p>` },
    { name: "v2 bdo dir=rtl", html: `<p>VISIBLEv2</p><p><bdo dir="rtl">SECRETv2 words</bdo></p>` },
    { name: "v3 U+202D on Latin in a left-to-right paragraph", html: `<p>VISIBLEv3</p><p>&#x202D;SECRETv3&#x202C;</p>` },
    { name: "v4 U+202E before a <b>", html: `<p>VISIBLEv4</p><p>&#x202E;<b>SECRETv4</b>&#x202C; VISIBLEv4b</p>` },
    { name: "v5 U+202E unclosed before a link", html: `<p>VISIBLEv5</p><p>&#x202E;go <a href="https://x.example">SECRETv5</a></p>` },
    { name: "v6 U+202E across a span, second word", html: `<p>VISIBLEv6</p><p>&#x202E;SECRETv6a <span>SECRETv6b</span>&#x202C; VISIBLEv6b</p>` },
    { name: "v7 CSS bidi-override on a parent", html: `<p>VISIBLEv7</p><div style="direction:rtl;unicode-bidi:bidi-override"><span>SECRETv7</span></div>` },
    { name: "v8 isolate-override", html: `<p>VISIBLEv8</p><p><span style="direction:rtl;unicode-bidi:isolate-override">SECRETv8</span></p>` },
    { name: "v9 bdo nested in span", html: `<p>VISIBLEv9</p><p><bdo dir="rtl"><span><i>SECRETv9</i></span></bdo></p>` },
    { name: "w1 U+202E across nested elements", html: `<p>VISIBLEw1 &#x202E;<span><i><a href="https://x.example">SECRETw1</a></i> SECRETw1b</span>&#x202C; VISIBLEw1b</p>` },
    { name: "w2 opened in a child, closed in the parent", html: `<p><span>VISIBLEw2 &#x202E;SECRETw2</span> SECRETw2b&#x202C; VISIBLEw2b</p>` },
    { name: "w3 opened in the parent, closed in a child", html: `<p>&#x202E;SECRETw3 <b>SECRETw3b&#x202C; VISIBLEw3</b> VISIBLEw3b</p>` },
    { name: "z1 pop inside a span with dir", html: `<p>VISIBLEz1</p><p>&#x202E;<span dir="ltr">a&#x202C;</span> SECRETz1 more</p>` },
    { name: "z2 pop inside bdi", html: `<p>VISIBLEz2</p><p>&#x202E;<bdi>a&#x202C;</bdi> SECRETz2 more</p>` },
    { name: "z3 pop inside a css isolate", html: `<p>VISIBLEz3</p><p>&#x202E;<span style="unicode-bidi:isolate">a&#x202C;</span> SECRETz3 more</p>` },
    { name: "z4 override opened inside a span with dir, word after it", html: `<p>VISIBLEz4</p><p><span dir="ltr">&#x202E;x</span> SECRETz4 more</p>` },
    { name: "z5 override, then br", html: `<p>VISIBLEz5</p><p>&#x202E;abc<br>SECRETz5 more</p>` },
    { name: "z6 override before an inline-block", html: `<p>VISIBLEz6</p><p>&#x202E;abc <span style="display:inline-block">SECRETz6 more</span></p>` },
    { name: "z7 embedding char inside a span with dir closes nothing", html: `<p>VISIBLEz7</p><p>&#x202E;<span dir="rtl">&#x202A;a</span>&#x202C; SECRETz7 more</p>` },
    { name: "z8 pop inside css embed", html: `<p>VISIBLEz8</p><p>&#x202E;<span style="unicode-bidi:embed;direction:ltr">a&#x202C;</span> SECRETz8 more</p>` },
    { name: "h1 Hebrew under U+202D in a right-to-left paragraph", html: `<p>VISIBLEh1</p><p dir="rtl">&#x202D;שלום עולם&#x202C; VISIBLEh1b</p>` },
    { name: "h2 a word that wraps in a block with an isolate", html: `<p style="width:120px;word-break:break-all">&#x2066;x&#x2069; VISIBLEh2wrapsoverthelineabcdefghij</p>` },
  ],
  order: [
    { name: "an isolate with a mark between two Latin words (o-cases)", html: `<p>VISIBLEt1a &#x2067;VISIBLEt1b &#x200F; VISIBLEt1c&#x2069; VISIBLEt1d</p>` },
    { name: "a right-to-left span with two bdi in a left-to-right paragraph (c-cases)", html: `<p>VISIBLEt2a <span dir="rtl"><bdi>VISIBLEt2b</bdi> <bdi>VISIBLEt2c</bdi></span> VISIBLEt2d</p>` },
    { name: "a right-to-left box with invisible marks after Latin words (x-cases)", html: `<p>VISIBLEt3a</p><div dir="rtl">VISIBLEt3b&#x061C; VISIBLEt3c&#x061C; VISIBLEt3d</div>` },
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

test("text under a direction override is not read; right-to-left text, embeddings, isolates and marks keep every word, in the order of the text", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  const wrong: string[] = [];
  for (const entry of DIRECTION.hidden) for (const width of [343, 760]) {
    const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, width] as const);
    // Mirrored, as a person sees it: of two neighbouring letters of one script direction on one line, the later stands
    // before the earlier — measured in the reader's frame, letter by letter.
    const mirrored = await page.evaluate(() => {
      const doc = (document.getElementById("pv-marked-frame") as HTMLIFrameElement).contentDocument!;
      const out: Record<string, boolean> = {};
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const data = n.textContent ?? "";
        for (const m of data.matchAll(/(?:SECRET|VISIBLE)[A-Za-z0-9]+|[\u0590-\u05FF]+/g)) {
          const at: Array<{ x: number; top: number; h: number }> = [];
          for (let i = 0; i < m[0].length; i++) {
            const range = doc.createRange();
            range.setStart(n, m.index! + i);
            range.setEnd(n, m.index! + i + 1);
            const b = range.getBoundingClientRect();
            if (b.width > 0) at.push({ x: (b.left + b.right) / 2, top: b.top, h: b.height });
          }
          const rtl = /[\u0590-\u05FF]/.test(m[0]);
          let turned = false;
          for (let k = 0; k + 1 < at.length; k++) {
            if (Math.abs(at[k]!.top - at[k + 1]!.top) > 0.5 * Math.min(at[k]!.h, at[k + 1]!.h)) continue;
            if (rtl ? at[k + 1]!.x > at[k]!.x + 0.5 : at[k + 1]!.x < at[k]!.x - 0.5) turned = true;
          }
          out[m[0]] = turned;
        }
      }
      return out;
    });
    for (const [word, turned] of Object.entries(mirrored)) {
      if (turned && open.ai.includes(word)) wrong.push(`${entry.name}: at ${width} px the assistant reads ${word}, drawn mirrored`);
      if (!turned && open.frame.seen.includes(word) && !open.ai.includes(word)) wrong.push(`${entry.name}: at ${width} px the assistant leaves out ${word}, drawn plainly`);
    }
  }
  // A Latin word with a Hebrew letter after each of its letters (review B7-8, S-1): mirrored on screen, never read —
  // under an override, in a bdo, and across a <b>. Judged against the screen in the reader, letter by letter of the
  // Latin letters alone, not with the product's rule.
  const INTERLEAVED = "I\u05D0\u05D0G\u05D0N\u05D0O\u05D0R\u05D0E\u05D0X";
  for (const html of [`<p>VISIBLEs1</p><p>&#x202E;${INTERLEAVED}&#x202C;</p>`, `<p>VISIBLEs2</p><p><bdo dir="rtl">${INTERLEAVED}</bdo></p>`, `<p>VISIBLEs3</p><p>&#x202E;<b>I\u05D0\u05D0G\u05D0N</b>\u05D0O\u05D0R\u05D0E\u05D0X&#x202C;</p>`]) {
    for (const width of [343, 760]) {
      const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [html, width] as const);
      const latin = await page.evaluate(() => {
        const doc = (document.getElementById("pv-marked-frame") as HTMLIFrameElement).contentDocument!;
        const at: number[] = [];
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const data = n.textContent ?? "";
          for (let i = 0; i < data.length; i++) {
            if (!/[GNORX]/.test(data[i]!)) continue;
            const range = doc.createRange();
            range.setStart(n, i);
            range.setEnd(n, i + 1);
            const b = range.getBoundingClientRect();
            at.push((b.left + b.right) / 2);
          }
        }
        return at;
      });
      const mirrored = latin.some((x, k) => k > 0 && x < latin[k - 1]!);
      if (!mirrored) wrong.push(`${html}: at ${width} px the case is not drawn mirrored`);
      if (open.aiText.includes("X") || open.aiText.includes("G")) wrong.push(`${html}: at ${width} px the assistant reads the mirrored word`);
    }
  }
  // One character cannot be mirrored (review B7-8, M-1): in a block with a direction control it is read — a digit, "a",
  // "I", a Chinese word.
  for (const width of [343, 760]) {
    const html = `<p>VISIBLEm1 &#x2066;Anna&#x2069; 5 a I \u4E2D VISIBLEm1b</p>`;
    const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [html, width] as const);
    const read = open.aiText.split(/[\s\u2066-\u2069]+/);
    for (const word of ["5", "a", "I", "\u4E2D", "Anna", "VISIBLEm1", "VISIBLEm1b"]) if (!read.includes(word)) wrong.push(`m1: at ${width} px the assistant leaves out "${word}"`);
  }
  for (const entry of DIRECTION.order) {
    const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, 760] as const);
    const all = Array.from(entry.html.matchAll(/VISIBLE[a-z0-9]+/g), (m) => m[0]);
    const read = open.ai.filter((word) => all.includes(word));
    if (read.join(" ") !== all.join(" ")) wrong.push(`${entry.name}: the assistant reads "${read.join(" ")}", not the text's "${all.join(" ")}"`);
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
 * Right-to-left mail as it is written (review B7-4, M-R4-3; review B7-5): Hebrew, Arabic, Persian and Urdu newsletters,
 * receipts and letters with Latin buttons, columns, names, numbers, addresses, mixed lines, cells, signatures and lists
 * that wrap — every word the reader shows is read, at both widths; a word left out that the reader shows is a fault.
 * k- and h-cases are this branch's, g-cases the reviewer's of round 5 (g9–g12 lost words while the branch tried to find
 * words turned around).
 */
const IB = "display:inline-block;padding:4px 10px;border:1px solid #888";
const RTL_MAIL = [
  { name: "k1 Hebrew line with two Latin buttons", html: `<div dir="rtl">שלום <a href="https://x.example/a" style="${IB}">VISIBLEk1a</a> <a href="https://x.example/b" style="${IB}">VISIBLEk1b</a> עולם</div>` },
  { name: "k2 two Latin buttons alone in a right-to-left box", html: `<div dir="rtl"><a href="https://x.example/a" style="${IB}">VISIBLEk2a</a> <a href="https://x.example/b" style="${IB}">VISIBLEk2b</a></div>` },
  { name: "k3 Arabic footer, links parted by a bar", html: `<p dir="rtl">تابعنا: <a href="https://x.example/f">VISIBLEk3a</a> | <a href="https://x.example/i">VISIBLEk3b</a></p>` },
  { name: "k4 Hebrew price line with a brand and a year", html: `<p dir="rtl">מחיר <b>VISIBLEk4a</b> 2026 <b>VISIBLEk4b</b> שקל</p>` },
  { name: "k5 two columns as inline blocks, Latin at the seam", html: `<div dir="rtl"><div style="display:inline-block;width:45%">טקסט VISIBLEk5a</div><div style="display:inline-block;width:45%">VISIBLEk5b טקסט</div></div>` },
  { name: "k6 a left-to-right wrapper round the whole mail", html: `<div dir="ltr"><div>VISIBLEk6a Hello <a href="https://x.example">VISIBLEk6b link</a> and <b>VISIBLEk6c</b>.</div><div style="display:inline-block;width:45%">VISIBLEk6d col</div><div style="display:inline-block;width:45%">VISIBLEk6e col</div></div>` },
  { name: "k7 Hebrew with an address and a web address", html: `<p dir="rtl">כתבו לנו: <a href="mailto:a@b.example">VISIBLEk7a@b.example</a> או <a href="https://x.example">VISIBLEk7b.example</a></p>` },
  { name: "k8 Hebrew, two Latin words in spans, a mark at the end", html: `<p dir="rtl">הזמינו <span>VISIBLEk8a</span> <span>VISIBLEk8b</span>&#x200F;</p>` },
  { name: "h1 Arabic greeting with a Latin name of three words", html: `<p dir="rtl">مرحبا <b>VISIBLEh1a</b> <b>VISIBLEh1b</b> <b>VISIBLEh1c</b>، شكرا لك</p>` },
  { name: "h2 Hebrew table row, Latin in two cells", html: `<table dir="rtl" width="100%"><tr><td>VISIBLEh2a</td><td>VISIBLEh2b</td><td>מוצר</td></tr></table>` },
  { name: "h3 Hebrew line, Latin words parted by Hebrew", html: `<p dir="rtl">VISIBLEh3a שלום VISIBLEh3b עולם VISIBLEh3c</p>` },
  { name: "h4 Arabic menu as a flex row of links", html: `<div dir="rtl" style="display:flex;gap:8px"><a href="https://x.example/1">VISIBLEh4a</a> <a href="https://x.example/2">VISIBLEh4b</a> <a href="https://x.example/3">الرئيسية</a></div>` },
  { name: "h5 Arabic call to action, buttons as inline flex", html: `<p dir="rtl">اضغط <span style="${IB};display:inline-flex;gap:4px">VISIBLEh5a now</span> <span style="${IB};display:inline-flex">VISIBLEh5b</span> هنا</p>` },
  { name: "h6 Hebrew receipt line, order code and phone number", html: `<p dir="rtl">הזמנה VISIBLEh6a-2026 טלפון 03-1234567 VISIBLEh6b</p>` },
  { name: "h7 Arabic line with an English sentence set left to right", html: `<p dir="rtl">للمزيد: <span dir="ltr">VISIBLEh7a VISIBLEh7b VISIBLEh7c</span></p>` },
  { name: "h8 Hebrew with an English quote in bdi", html: `<p dir="rtl">הוא אמר <bdi>VISIBLEh8a VISIBLEh8b</bdi> אתמול</p>` },
  { name: "h9 Hebrew list with Latin items", html: `<ul dir="rtl"><li>VISIBLEh9a פריט</li><li>VISIBLEh9b VISIBLEh9c</li></ul>` },
  { name: "h10 two inline tables side by side", html: `<div dir="rtl"><table style="display:inline-table"><tr><td>VISIBLEh10a</td></tr></table> <table style="display:inline-table"><tr><td>VISIBLEh10b</td></tr></table></div>` },
  { name: "h11 Hebrew list of brands parted by commas and marks", html: `<p dir="rtl">אנחנו עובדים עם VISIBLEh11a,&#x200F; VISIBLEh11b&#x200F; ו-VISIBLEh11c.</p>` },
  { name: "h12 Arabic sentence with marks round a Latin name", html: `<p dir="rtl">&#x200F;شركة&#x200F; VISIBLEh12a&#x200F; VISIBLEh12b&#x200F; ترحب بكم</p>` },
  { name: "h13 Hebrew signature with name, role and company", html: `<div dir="rtl"><div>בברכה,</div><div><b>VISIBLEh13a VISIBLEh13b</b> | מנהלת מכירות | VISIBLEh13c Ltd.</div></div>` },
  { name: "h14 Arabic inline grid of two buttons", html: `<div dir="rtl"><span style="${IB};display:inline-grid">VISIBLEh14a</span> <span style="${IB};display:inline-grid">VISIBLEh14b</span></div>` },
  { name: "h15 Hebrew newsletter, centred buttons and a Latin footer line", html: `<div dir="rtl" style="text-align:center"><p>מבצע סוף השנה</p><p><a style="${IB}" href="https://x.example/s">VISIBLEh15a Shop</a> <a style="${IB}" href="https://x.example/u">VISIBLEh15b</a></p><p dir="ltr">VISIBLEh15c Inc., 1 Main St, Tel Aviv</p></div>` },
  { name: "h16 Arabic paragraph that wraps, Latin words on several lines", html: `<p dir="rtl">${Array.from({ length: 12 }, (_, n) => `نص عربي VISIBLEh16w${n} كلمة`).join(" ")}</p>` },
  { name: "g1 Outlook-style Hebrew letter with a Latin company and signature", html: `<div dir="rtl" style="font-family:Arial"><p dir="RTL">שלום רב,</p><p dir="RTL">מצורפת הצעת המחיר מ-VISIBLEg1a Ltd. לפרויקט VISIBLEg1b.</p><p dir="RTL">בברכה,<br>VISIBLEg1c VISIBLEg1d<br>טל: 054-1234567</p></div>` },
  { name: "g2 Gmail Hebrew reply quoting an English mail", html: `<div dir="rtl"><div dir="rtl">היי, ראית את המייל מ-<a href="mailto:x@y.example">VISIBLEg2a@y.example</a>?</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, Nov 23, 2026 at 10:00 AM VISIBLEg2b Smith &lt;VISIBLEg2c@y.example&gt; wrote:<br></div><blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex"><div dir="ltr">Hi team, the VISIBLEg2d meeting moved to Thursday.</div></blockquote></div></div>` },
  { name: "g3 Hebrew newsletter in tables, button and two product cells", html: `<table dir="rtl" width="100%" cellpadding="0"><tr><td align="center" style="background-color:#1a73e8;color:#ffffff;padding:20px"><h1>מבצע VISIBLEg3a</h1><p>עד 50% הנחה על VISIBLEg3b VISIBLEg3c</p><a href="https://x.example" style="display:inline-block;background-color:#ffffff;color:#1a73e8;padding:10px 20px">VISIBLEg3d Now</a></td></tr><tr><td style="padding:10px"><table width="100%"><tr><td width="50%">VISIBLEg3e Pro<br>₪199</td><td width="50%">VISIBLEg3f Max<br>₪299</td></tr></table></td></tr></table>` },
  { name: "g4 Persian order notice with code and link", html: `<div dir="rtl">سلام، سفارش شما با شماره VISIBLEg4a-1234 ارسال شد. پیگیری: <a href="https://x.example">VISIBLEg4b.example/track</a></div>` },
  { name: "g5 Urdu account notice", html: `<p dir="rtl">آپ کا VISIBLEg5a اکاؤنٹ تیار ہے۔ لاگ ان کریں: VISIBLEg5b</p>` },
  { name: "g6 Hebrew date, time, price, phone, code", html: `<p dir="rtl">תאריך: 27/11/2026, שעה 10:30, מחיר: $49.99, טלפון: +972-3-555-1234, קוד VISIBLEg6a</p>` },
  { name: "g7 Hebrew line quoting a mixed subject", html: `<p dir="rtl">בנושא: "Re: VISIBLEg7a VISIBLEg7b Q4 report" – אנא עדכנו.</p>` },
  { name: "g8 an English sentence that wraps in an rtl box", html: `<div dir="rtl">VISIBLEg8a Thank you for your order. VISIBLEg8b Your package will arrive soon, VISIBLEg8c and we hope you enjoy it very much indeed.</div>` },
  { name: "g9 Hebrew table, a cell with a Latin list parted by commas and marks", html: `<table dir="rtl"><tr><td>אמצעי תשלום</td><td>VISIBLEg9a,&#x200F; VISIBLEg9b,&#x200F; VISIBLEg9c</td></tr></table>` },
  { name: "g10 Hebrew list of brands with marks that wraps", html: `<p dir="rtl">אנחנו עובדים עם החברות הבאות: VISIBLEg10a,&#x200F; VISIBLEg10b,&#x200F; VISIBLEg10c,&#x200F; VISIBLEg10d,&#x200F; VISIBLEg10e,&#x200F; VISIBLEg10f,&#x200F; VISIBLEg10g.</p>` },
  { name: "g11 Arabic header on a gradient without a background colour, marks round a name", html: `<div dir="rtl" style="background-image:linear-gradient(#0b3d91,#1a73e8);color:#ffffff;padding:16px"><p>&#x200F;شركة&#x200F; VISIBLEg11a&#x200F; VISIBLEg11b&#x200F; ترحب بكم</p></div>` },
  { name: "g12 Hebrew signature, a line of name and title with a mark", html: `<div dir="rtl"><div>בברכה,</div><div>VISIBLEg12a,&#x200F; VISIBLEg12b</div></div>` },
  { name: "g13 Outlook Hebrew with LTR spans", html: `<p dir="RTL"><span lang="HE">הפגישה עם </span><span lang="EN-US" dir="LTR">VISIBLEg13a VISIBLEg13b</span><span lang="HE"> נדחתה ל-</span><span dir="LTR">VISIBLEg13c 3</span></p>` },
  { name: "g14 Arabic receipt rows as a table with Latin items", html: `<table dir="rtl" width="100%"><tr><td>المنتج</td><td>السعر</td></tr><tr><td>VISIBLEg14a VISIBLEg14b</td><td>USD 20</td></tr><tr><td>VISIBLEg14c</td><td>USD 5</td></tr></table>` },
];

test("right-to-left mail as it is written: every word the reader shows is read", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1300, height: 900 });
  await loadProbe(page);
  const wrong: string[] = [];
  for (const entry of RTL_MAIL) {
    for (const width of [343, 760]) {
      const open = await page.evaluate(([h, w]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w), [entry.html, width] as const);
      const shares = await inkShares(page, open);
      for (const word of Array.from(entry.html.matchAll(/VISIBLE[A-Za-z0-9]+/g), (m) => m[0])) {
        const share = open.frame.seen.includes(word) ? (shares.get(word) ?? 0) : 0;
        // The case means something: the reader shows every word of it.
        if (share < MIN_INK_SHARE) wrong.push(`${entry.name}: at ${width} px the reader does not show ${word}`);
        else if (!open.ai.includes(word)) wrong.push(`${entry.name}: at ${width} px the assistant leaves out ${word}, the reader shows it (${Math.round(share * 100)} %)`);
      }
    }
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

/**
 * What the rule for pictures from the network costs (review B7-3, M16): it takes the largest the reader allows, so a
 * word a smaller real picture leaves visible can be left out — the safe way, never a hidden word read. These forms do
 * it; each may lose at most the words named, and how many it did is reported.
 */
const KNOWN_COSTS = [
  { name: "g1 a logo without width beside a line running out of its box", html: `<div style="height:16px">VISIBLEOVA line<br><span style="padding-left:150px">VISIBLEOVB right</span></div><img src="${PICTURE_HOST}/logo.svg" style="height:auto"><p>VISIBLEOVC</p>`, may: ["VISIBLEOVB"] },
  { name: "q10 a float with a negative margin", html: `<div style="height:0;white-space:nowrap">VISIBLEFLOAT here</div><img src="${SRC}" style="float:left;margin-top:-10px"><p>VISIBLEFLOATB</p>`, may: ["VISIBLEFLOAT"] },
  { name: "q11 two pictures side by side", html: `<div style="height:0;white-space:nowrap">SECRETTWO here <span style="padding-left:300px">SECRETTWOB</span></div><div style="white-space:nowrap"><img src="${SRC}" width="200"><img src="${SRC}" style="height:auto"></div><p>VISIBLETWO</p>`, may: ["SECRETTWO", "SECRETTWOB"] },
];

test("the known costs of the rule for pictures: no hidden word read, no visible word lost beyond those named", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1800, height: 1400 });
  await loadProbe(page);
  const wrong: string[] = [];
  const lost: string[] = [];
  for (const entry of KNOWN_COSTS) {
    for (const width of [343, 760, 1200]) {
      await page.evaluate((w) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.readerWidth(w), width);
      const shown = new Map<string, number>();
      let ai: string[] = [];
      for (const pictures of [false, true]) {
        const open = await page.evaluate(([h, w, p]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, w, undefined, p), [entry.html, width, pictures] as const);
        ai = open.ai;
        const shares = await inkShares(page, open);
        for (const word of Array.from(entry.html.matchAll(/(?:SECRET|VISIBLE)[A-Z0-9a-z]+/g), (m) => m[0])) {
          const share = open.frame.seen.includes(word) ? (shares.get(word) ?? 0) : 0;
          shown.set(word, Math.min(shown.get(word) ?? 1, share));
        }
      }
      for (const [word, share] of shown) {
        const read = ai.includes(word);
        if (read && share < MIN_INK_SHARE) wrong.push(`${entry.name}: at ${width} px the assistant reads ${word}, the reader does not show it`);
        if (!read && share >= MIN_INK_SHARE) {
          lost.push(`${entry.name} · ${width} px · ${word}`);
          if (!entry.may.includes(word)) wrong.push(`${entry.name}: at ${width} px the assistant leaves out ${word} as well, which is not among its known costs`);
        }
      }
    }
  }
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
  test.info().annotations.push({ type: "visible words the rule takes away", description: `${lost.length}: ${lost.join("; ")}` });
  expect(wrong).toEqual([]);
});

test("a mail too long to check in time: the assistant reads none of it, and is told why (review B7-2, F3)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  // The budget grows with the mail up to 45 s (B7, decision (a)): the gate sets the old 3 s limit to have a mail past it.
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.limit(3000));
  // 20 000 words, each one running into the next box: every one is asked of the engine, past the budget.
  const words = Array.from({ length: 20_000 }, (_, n) => `w${n}`).join(" ");
  const html = `<div style="height:0;white-space:nowrap">${words}</div><div style="height:0;white-space:nowrap">${words}</div><p>VISIBLEend</p>`;
  const open = await page.evaluate(([h]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.open(h, 760), [html] as const);
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.marked.close());
  expect(open.ai).toEqual([]);
  expect(open.aiText).toContain("too long for Plainva to check in time");
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.limit(null));
});

test("a stop of the person ends a pass under way, and a mail past the budget is told at once the next time", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1000, height: 900 });
  await loadProbe(page);
  // Long enough to run for seconds: every word runs into the next box and is asked of the engine.
  const words = Array.from({ length: 20_000 }, (_, n) => `w${n}`).join(" ");
  const html = `<div style="height:0;white-space:nowrap">${words}</div><div style="height:0;white-space:nowrap">${words}</div><p>VISIBLEend</p>`;
  // What the person stops computes no further (B7): stopped after a second, no step of the pass runs after it.
  const stopped = await page.evaluate(([h]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.readStopped(h, 1000), [html] as const);
  expect(stopped.threw).toBe(true);
  expect(stopped.atStop).toBeGreaterThan(0);
  expect(stopped.later).toBe(stopped.atStop);
  // A stopped pass is not kept: the same mail is measured again.
  const before = await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.passes());
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.limit(3000));
  const first = await page.evaluate(([h]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.read(h), [html] as const);
  expect(first.text).toContain("too long for Plainva to check in time");
  const measured = await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.passes());
  expect(measured).toBeGreaterThan(before);
  // Past the budget, kept as that: the second question about the same mail is told at once, with no new pass.
  const second = await page.evaluate(async ([h]) => {
    const at = performance.now();
    const read = await (window as unknown as MailFrameProbeWindow).mailFrameProbe.read(h);
    return { text: read.text, took: performance.now() - at };
  }, [html] as const);
  expect(second.text).toContain("too long for Plainva to check in time");
  expect(await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.passes())).toBe(measured);
  expect(second.took).toBeLessThan(1000);
  // Another width is another answer: measured anew.
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.readerWidth(500));
  await page.evaluate(([h]) => (window as unknown as MailFrameProbeWindow).mailFrameProbe.read(h), [html] as const);
  expect(await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.passes())).toBeGreaterThan(measured);
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.limit(null));
});

/**
 * The cheaper measurement of a text that only runs out of the frame's reach (review B7-7, part 6): it never lets a word
 * be read that asking every word of the engine hides. Compared over reply chains, the gate's cases and seeded random
 * nests of boxes, at both widths.
 */
test("the cheaper measurement of what runs out of reach reads no word that asking every word hides", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1300, height: 900 });
  await loadProbe(page);
  const P = "Thanks for being with us this year; here is what changed in the service and what comes next for you.";
  const chain = (n: number) => {
    let inner = "";
    for (let k = n; k >= 1; k--) inner = `<div>On Mon, Nov ${(k % 28) + 1}, 2026 Person ${k} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px #cccccc solid;padding-left:1ex"><p>${P} r${k}</p>${inner}</blockquote>`;
    return `<p>Latest reply.</p>${inner}`;
  };
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  const random = () => {
    let html = "";
    const depth = 3 + rand(30);
    for (let d = 0; d < depth; d++) {
      const pad = rand(40);
      const words = Array.from({ length: 1 + rand(12) }, (_, w) => `x${d}w${w}${"a".repeat(rand(14))}`).join(" ");
      const nowrap = rand(4) === 0 ? "white-space:nowrap;" : "";
      html = `<div style="margin-left:${pad}px;padding-left:${rand(20)}px;${nowrap}">${words}${html}</div>`;
    }
    return html;
  };
  const cases = [chain(20), chain(40), chain(80), ...RTL_MAIL.map((c) => c.html), ...DIRECTION.hidden.map((c) => c.html), ...Array.from({ length: 30 }, random)];
  const wrong: string[] = [];
  let same = 0;
  let cheaper = 0;
  for (const [n, html] of cases.entries()) {
    for (const width of [343, 760]) {
      const read = await page.evaluate(
        async ([h, w]) => {
          const probe = (window as unknown as MailFrameProbeWindow).mailFrameProbe;
          probe.readerWidth(w);
          probe.forget();
          probe.wordWise(true);
          // A comment of its own for each reading: the reader keeps its view per markup, the sanitizer drops comments.
          const every = (await probe.read(`<!--every ${w}-->${h}`)).text;
          probe.forget();
          probe.wordWise(false);
          probe.resetTrace();
          const lines = (await probe.read(`<!--lines ${w}-->${h}`)).text;
          return { every, lines, reachOnly: probe.trace().reachOnly ?? 0 };
        },
        [html, width] as const,
      );
      const words = (t: string) => t.split(/\s+/).filter(Boolean);
      const allowed = new Map<string, number>();
      for (const w of words(read.every)) allowed.set(w, (allowed.get(w) ?? 0) + 1);
      for (const w of words(read.lines)) {
        const left = allowed.get(w) ?? 0;
        if (left === 0) wrong.push(`case ${n} at ${width} px: the cheaper measurement reads "${w}", asking every word hides it`);
        else allowed.set(w, left - 1);
      }
      if (read.every === read.lines) same++;
      if (read.reachOnly > 0) cheaper++;
    }
  }
  await page.evaluate(() => (window as unknown as MailFrameProbeWindow).mailFrameProbe.forget());
  test.info().annotations.push({ type: "compared", description: `${cases.length * 2} readings, ${same} identical, ${cheaper} took the cheaper way` });
  expect(cheaper).toBeGreaterThan(0);
  expect(wrong).toEqual([]);
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
  // A mail of real work for the pass — twenty lines of 100 words that all run into the next box, each asked of the
  // engine: within the budget in either engine (about 550 ms in both, measured 27.11.), and heavy enough in both that a
  // pass that never gave the interface its turn would hold it far longer than the bound below (review B7-4, H-R4-10:
  // the mail before was heavy in one engine only).
  const words = Array.from({ length: 100 }, (_, n) => `w${n}`).join(" ");
  const heavy = `${Array.from({ length: 20 }, () => `<div style="height:0;white-space:nowrap">${words}</div>`).join("")}<p>VISIBLEheavy</p>`;
  // Each measure a mail of its own: the reader keeps a mail's reading once made (`mailHtmlView`), a second one of the
  // same text would measure nothing.
  let made = 0;
  const measure = (html: string) =>
    page.evaluate(async ([h]) => {
      // The longest the interface waited between two of its tasks, in either engine (WebKit has no long-task entries,
      // review B7-3): a message handed on again and again while the pass runs, the widest gap between two of them.
      const longest = { ms: 0 };
      let running = true;
      let last = performance.now();
      const meter = new MessageChannel();
      meter.port1.onmessage = () => {
        const at = performance.now();
        longest.ms = Math.max(longest.ms, at - last);
        last = at;
        if (running) meter.port2.postMessage(0);
      };
      meter.port2.postMessage(0);
      // The product's way alone: what the assistant reads, timed without the judge's frames.
      const started = performance.now();
      const read = await (window as unknown as MailFrameProbeWindow).mailFrameProbe.read(h);
      const took = performance.now() - started;
      // The gap still open counts too: a pass that never gives the interface its turn starves the meter itself — in
      // WebKit not one of its messages comes through before the pass ends (review B7-4, H-R4-10).
      longest.ms = Math.max(longest.ms, performance.now() - last);
      running = false;
      meter.port1.close();
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
  // The heavy mail is heavy: the pass over it takes several times the bound for one task.
  expect(plainHeavy.took).toBeGreaterThan(300);
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

