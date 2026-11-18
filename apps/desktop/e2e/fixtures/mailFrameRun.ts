import { judgeFrame, MARKER, measureFrame, type FrameSeen, type Measured } from "./mailFrameJudge";

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

/** What the reader lays out of a corpus case, and what the assistant reads of it against what the frame shows. */
export interface MailCorpusResult {
  name: string;
  measured: Measured[];
  ai: string[];
  seen: string[];
}

/**
 * Renders each case as the reader shows it — with pictures or without — in a
 * frame of `width`, once every picture has loaded or failed, and measures it
 * (`measureFrame`). The assistant reads one view whatever the picture option;
 * its words are judged against this frame.
 */
export async function runMailCorpus(api: MailFrameApi, cases: readonly MailFrameCase[], width: number, pictures: boolean): Promise<MailCorpusResult[]> {
  const results: MailCorpusResult[] = [];
  for (const { name, html } of cases) {
    const options = { allowRemoteImages: pictures };
    const shown = api.mailBodyView ? api.mailBodyView({ html, text: null }, options)?.html ?? "" : api.sanitizeEmailHtml(html, options).html;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.cssText = `width:${width}px;height:600px;border:0;display:block`;
    const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    frame.srcdoc = api.buildMailFrameDoc(shown, options);
    document.body.append(frame);
    await loaded;
    const images = Array.from(frame.contentDocument!.images).filter((image) => !image.complete);
    await Promise.race([
      Promise.all(images.map((image) => new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    api.applyFrameFit(frame, { growHeight: true });
    const seen = judgeFrame(frame);
    const measured = measureFrame(frame);
    frame.remove();
    const read = api.readableBody({ html }, 100_000);
    results.push({ name, measured, ai: [...new Set(Array.from(read.text.matchAll(MARKER), (m) => m[0]))].sort(), seen: seen.seen });
  }
  return results;
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
