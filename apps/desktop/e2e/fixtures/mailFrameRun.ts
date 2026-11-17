import { judgeFrame, MARKER, type FrameSeen } from "./mailFrameJudge";

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
