import { inkCounts, judgeFrame, markMode, markWords, MARKER, measureFrame, scrollToWord, type FrameSeen, type MarkedWord, type Measured, type PageBox } from "./mailFrameJudge";

/** The parts of the mail code the run needs — the branch's, or another version's for the expectations. */
export interface MailFrameApi {
  /** The body the reader shows; a version without it shows the sanitized HTML part. */
  mailBodyView?: (message: { html: string | null; text: string | null }, options?: { allowRemoteImages?: boolean }) => { html: string } | null;
  sanitizeEmailHtml: (html: string, options?: { allowRemoteImages?: boolean }) => { html: string };
  buildMailFrameDoc: (html: string, options?: object) => string;
  applyFrameFit: (frame: HTMLIFrameElement, options?: { growHeight?: boolean }) => unknown;
  readableBody: (input: { html?: string | null; text?: string | null }, max: number) => { text: string; links: { url: string }[] };
}

export interface MailFrameCase {
  name: string;
  html: string;
}

/** What the assistant reads of a case, and what the reader's frame shows of it. */
export interface MailFrameResult {
  name: string;
  ai: string[];
  aiLinks: string[];
  frame: FrameSeen;
}

/** Renders each case in a reader frame of `width` CSS pixels, fitted as the shells fit it, and judges it. */
export async function runMailFrames(api: MailFrameApi, cases: readonly MailFrameCase[], width: number): Promise<MailFrameResult[]> {
  const results: MailFrameResult[] = [];
  for (const { name, html } of cases) {
    const shown = api.mailBodyView ? api.mailBodyView({ html, text: null })?.html ?? "" : api.sanitizeEmailHtml(html).html;
    const read = api.readableBody({ html }, 100_000);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = `width:${width}px;height:600px;border:0;display:block`;
    const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    frame.srcdoc = api.buildMailFrameDoc(shown, {});
    document.body.append(frame);
    await loaded;
    api.applyFrameFit(frame, { growHeight: true });
    const seen = judgeFrame(frame);
    frame.remove();
    results.push({
      name,
      ai: [...new Set(Array.from(read.text.matchAll(MARKER), (m) => m[0]))].sort(),
      aiLinks: read.links.map((link) => link.url),
      frame: seen,
    });
  }
  return results;
}

/** A case left open in its frame for the pixel judge: what the assistant reads, what the frame shows, and its words. */
export interface MarkedFrameResult extends MailFrameResult {
  /** The frame on the page. */
  clip: PageBox;
  words: MarkedWord[];
}

const MARKED_FRAME = "pv-marked-frame";
const marked = () => document.getElementById(MARKED_FRAME) as HTMLIFrameElement;

/**
 * Renders a case as `runMailFrames` does and leaves its frame on the page, its
 * marker words wrapped for the pixel judge (`markWords`); the test shoots it.
 */
export async function openMarked(api: MailFrameApi, html: string, width: number): Promise<MarkedFrameResult> {
  document.getElementById(MARKED_FRAME)?.remove();
  window.scrollTo(0, 0);
  const shown = api.mailBodyView ? api.mailBodyView({ html, text: null })?.html ?? "" : api.sanitizeEmailHtml(html).html;
  const read = api.readableBody({ html }, 100_000);
  const frame = await openFrame(api, api.buildMailFrameDoc(shown, {}), width);
  frame.id = MARKED_FRAME;
  const seen = judgeFrame(frame);
  const words = markWords(frame);
  const at = frame.getBoundingClientRect();
  return {
    name: "",
    ai: [...new Set(Array.from(read.text.matchAll(MARKER), (m) => m[0]))].sort(),
    aiLinks: read.links.map((link) => link.url),
    frame: seen,
    clip: { x: Math.floor(at.left + window.scrollX), y: Math.floor(at.top + window.scrollY), width: Math.ceil(at.width), height: Math.ceil(at.height) },
    words,
  };
}

/** The pixel judge's handles on the open frame (`openMarked`). */
export const markedFrame = {
  mode: (mode: Parameters<typeof markMode>[1], k?: number) => markMode(marked(), mode, k),
  scrollTo: (k: number) => scrollToWord(marked(), k),
  ink: inkCounts,
  close: () => marked()?.remove(),
};

/** What the reader lays out of a corpus case, what main laid out of it in the same engine, and what the assistant reads of it against what the frame shows. */
export interface MailCorpusResult {
  name: string;
  measured: Measured[];
  /** The frame main gave the case, measured here: the same engine and the same fonts as the reader's. */
  mainMeasured: Measured[] | null;
  ai: string[];
  seen: string[];
}

/** A frame of `width` with `doc` in it, once every picture has loaded or failed, fitted as the shells fit it. */
async function openFrame(api: MailFrameApi, doc: string, width: number): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = `width:${width}px;height:600px;border:0;display:block`;
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = doc;
  document.body.append(frame);
  await loaded;
  const images = Array.from(frame.contentDocument!.images).filter((image) => !image.complete);
  await Promise.race([
    Promise.all(images.map((image) => new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  api.applyFrameFit(frame, { growHeight: true });
  return frame;
}

/**
 * Renders each case as the reader shows it — with pictures or without — in a
 * frame of `width` and measures it (`measureFrame`), and beside it the frame
 * document main made of the case (`mainDocs`, frozen), measured the same way.
 * The assistant reads one view whatever the picture option; its words are
 * judged against the reader's frame.
 */
export async function runMailCorpus(api: MailFrameApi, cases: readonly MailFrameCase[], width: number, pictures: boolean, mainDocs?: Record<string, string>): Promise<MailCorpusResult[]> {
  const results: MailCorpusResult[] = [];
  for (const { name, html } of cases) {
    const options = { allowRemoteImages: pictures };
    const shown = api.mailBodyView ? api.mailBodyView({ html, text: null }, options)?.html ?? "" : api.sanitizeEmailHtml(html, options).html;
    const frame = await openFrame(api, api.buildMailFrameDoc(shown, options), width);
    const seen = judgeFrame(frame);
    const measured = measureFrame(frame);
    frame.remove();
    let mainMeasured: Measured[] | null = null;
    if (mainDocs?.[name] !== undefined) {
      const before = await openFrame(api, mainDocs[name], width);
      mainMeasured = measureFrame(before);
      before.remove();
    }
    const read = api.readableBody({ html }, 100_000);
    results.push({ name, measured, mainMeasured, ai: [...new Set(Array.from(read.text.matchAll(MARKER), (m) => m[0]))].sort(), seen: seen.seen });
  }
  return results;
}

/** The frame document a version of the reader makes of each case, with pictures or without: what `mailFrameCorpus.main.json` freezes of main. */
export function frameDocs(api: MailFrameApi, cases: readonly MailFrameCase[], pictures: boolean): Record<string, string> {
  const options = { allowRemoteImages: pictures };
  return Object.fromEntries(cases.map(({ name, html }) => [name, api.buildMailFrameDoc(api.sanitizeEmailHtml(html, options).html, options)]));
}

/** How a frame of `width` fits a mail wider than it: its scale, whether it scrolls sideways, and how far a sideways scroll moves it. */
export async function frameScroll(api: MailFrameApi, html: string, width: number): Promise<{ scale: number; overflowX: string; moved: number; reach: number }> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = `width:${width}px;height:600px;border:0;display:block`;
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = api.buildMailFrameDoc(api.sanitizeEmailHtml(html).html, {});
  document.body.append(frame);
  await loaded;
  api.applyFrameFit(frame, { growHeight: true });
  const doc = frame.contentDocument!;
  const root = doc.documentElement;
  const scale = Number(/scale\(([\d.]+)\)/.exec(doc.body.style.transform)?.[1] ?? 1);
  frame.contentWindow!.scrollBy(10_000, 0);
  const result = { scale, overflowX: frame.contentWindow!.getComputedStyle(root).overflowX, moved: root.scrollLeft, reach: root.scrollWidth - root.clientWidth };
  frame.remove();
  return result;
}
