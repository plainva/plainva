/**
 * Whether a person sees a word in the mail reader's frame — judged by the
 * engine that draws it, not by a model of one (review of 2026-11-17). Used by
 * `mailFrameEquality.spec.ts` in Chromium and WebKit: what the assistant reads
 * of a mail must be what the frame shows or lets a person reach.
 *
 * A word counts as seen when the engine renders it (it is in the body's
 * `innerText`), it has a box, the box lies where a person gets to (inside the
 * frame, or where the frame scrolls to; not clipped by a box above it), it is
 * not hidden, not too faint and not too small (after the frame's scale), and
 * its colour stands out from what is painted behind it at that point. No
 * other code: this file imports nothing.
 */

/** The marker words of the cases: what is meant to be read, and what may be hidden. */
export const MARKER = /\b(?:SECRET|VISIBLE)[A-Za-z0-9_]*/g;
export const MIN_TEXT_PX = 4;
export const MIN_OPACITY = 0.1;
export const MIN_CONTRAST = 1.3;

type Rgba = [number, number, number, number];

function rgba(value: string): Rgba | null {
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return null;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}
function luminance(c: Rgba): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** What the frame shows: the marker words seen, with the reason for each one not seen, and the links a person can see. */
export interface FrameSeen {
  seen: string[];
  hidden: Record<string, string>;
  links: string[];
}

/** The scale the reader's frame fitting gave the body (`applyFrameFit`). */
function scaleOf(doc: Document): number {
  return Number(/scale\(([\d.]+)\)/.exec(doc.body.style.transform)?.[1] ?? 1);
}

/** Why the text of `range` is not seen, or null where it is. */
function unseen(frame: HTMLIFrameElement, range: Range, element: Element): string | null {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  const root = doc.documentElement;
  const rects = () => Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  let boxes = rects();
  if (boxes.length === 0) return "no box";
  // Where a person gets to: the frame, and what it scrolls to (not what it cuts off).
  const scrollsX = ["auto", "scroll"].includes(win.getComputedStyle(root).overflowX);
  const reachX = (scrollsX ? root.scrollWidth : frame.clientWidth) - 1;
  boxes = boxes.filter((r) => r.right + win.scrollX > 1 && r.left + win.scrollX < reachX && r.bottom + win.scrollY > 0);
  if (boxes.length === 0) return "past the frame";
  for (let e: Element | null = element; e && e !== doc.body; e = e.parentElement) {
    const style = win.getComputedStyle(e);
    if (style.overflowX === "hidden" || style.overflowY === "hidden" || style.overflowX === "clip" || style.overflowY === "clip") {
      const box = e.getBoundingClientRect();
      boxes = boxes.filter((r) => r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom);
      if (boxes.length === 0) return "clipped";
    }
  }
  const style = win.getComputedStyle(element);
  if (style.visibility !== "visible") return "visibility";
  let opacity = 1;
  for (let e: Element | null = element; e; e = e.parentElement) opacity *= Number(win.getComputedStyle(e).opacity);
  if (opacity < MIN_OPACITY) return "faint";
  const px = parseFloat(style.fontSize) * scaleOf(doc);
  if (px < MIN_TEXT_PX) return `tiny ${px.toFixed(1)}`;
  const k = textContrast(frame, range, boxes[0]);
  return k < MIN_CONTRAST ? `contrast ${k.toFixed(2)}` : null;
}

/** The contrast of the words of `range` against what the engine paints behind them, at the box `first` of them. */
export function textContrast(frame: HTMLIFrameElement, range: Range, first: DOMRect): number {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  const root = doc.documentElement;
  const element = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as Element;
  const style = win.getComputedStyle(element);
  const rects = () => Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  // What is painted behind the words, at the words: scroll there and ask the engine.
  win.scrollTo(Math.max(0, first.left + win.scrollX - 20), Math.max(0, first.top + win.scrollY - 20));
  const at = rects()[0] ?? first;
  const x = Math.min(Math.max((at.left + at.right) / 2, 1), frame.clientWidth - 2);
  const y = Math.min(Math.max((at.top + at.bottom) / 2, 1), (frame.clientHeight || root.clientHeight) - 2);
  const layers: Rgba[] = [];
  let stops: Rgba[] = [];
  // The engine's hit list leaves out table rows and row groups; their backgrounds lie behind the cell.
  const stack: Element[] = [];
  for (const e of doc.elementsFromPoint(x, y)) {
    stack.push(e);
    if (win.getComputedStyle(e).display !== "table-cell") continue;
    for (let up = e.parentElement; up && !["table", "inline-table"].includes(win.getComputedStyle(up).display); up = up.parentElement) {
      if (/^table-(?:row|row-group|header-group|footer-group)$/.test(win.getComputedStyle(up).display)) stack.push(up);
    }
  }
  for (const e of stack) {
    const s = win.getComputedStyle(e);
    const fill = rgba(s.backgroundColor);
    if (s.backgroundImage.includes("gradient") && stops.length === 0) stops = (s.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map((c) => rgba(c)!).filter(Boolean);
    if (fill && fill[3] > 0) {
      layers.push(fill);
      if (fill[3] >= 1) break;
    }
  }
  let behind: Rgba = [255, 255, 255, 1];
  for (const layer of layers.reverse()) behind = over(layer, behind);
  const colour = rgba((style as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor || style.color) ?? [0, 0, 0, 1];
  // A gradient covers its box: the words stand on its colours, the least of them counts.
  let least = Infinity;
  for (const background of stops.length > 0 ? stops.map((stop) => over(stop, behind)) : [behind]) least = Math.min(least, contrast(over(colour, background), background));
  return least;
}

/** One element of a frame as the engine lays it out and colours it: where it is in the tree, its box, its colours, and for words the contrast. */
export type Measured = [path: string, tag: string, width: number, height: number, colour: string, background: string, contrast: number | null];

/**
 * What a frame lays out, for the comparison with main (review of 2026-11-17,
 * rule 3): every element with words of its own and every element that paints
 * (a background, a gradient, a border, a picture), with its box and its
 * computed colours, and for words the contrast against what lies behind them.
 */
export function measureFrame(frame: HTMLIFrameElement): Measured[] {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  const out: Measured[] = [];
  const visit = (element: Element, path: string) => {
    const style = win.getComputedStyle(element);
    const words = Array.from(element.childNodes).find((node) => node.nodeType === 3 && /\S/.test((node as Text).data.replace(/\u00a0/g, " "))) as Text | undefined;
    const fill = rgba(style.backgroundColor);
    const paints = (fill !== null && fill[3] > 0) || style.backgroundImage !== "none" || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0 || element.localName === "img";
    if (words || paints) {
      const box = element.getBoundingClientRect();
      let k: number | null = null;
      if (words) {
        const range = doc.createRange();
        range.selectNodeContents(words);
        const first = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
        k = first && style.display !== "none" ? Number(textContrast(frame, range, first).toFixed(2)) : null;
      }
      const colour = (style as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor || style.color;
      out.push([path, element.localName, Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10, colour, style.backgroundColor, k]);
    }
    Array.from(element.children).forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(doc.body, "body");
  win.scrollTo(0, 0);
  return out;
}

/** What a person sees in a fitted reader frame. */
export function judgeFrame(frame: HTMLIFrameElement): FrameSeen {
  const doc = frame.contentDocument!;
  // In upper case where the style sets the letters so (`innerText` gives them as drawn).
  const rendered = doc.body.innerText.toLowerCase();
  const seen = new Set<string>();
  const hidden: Record<string, string> = {};
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const visibleText = new Set<Node>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const element = text.parentElement;
    if (!element) continue;
    if (text.data.trim() !== "") {
      const range = doc.createRange();
      range.selectNodeContents(text);
      if (unseen(frame, range, element) === null && rendered.includes(text.data.trim().split(/\s+/)[0].toLowerCase())) visibleText.add(text);
    }
    for (const m of text.data.matchAll(MARKER)) {
      const range = doc.createRange();
      range.setStart(text, m.index!);
      range.setEnd(text, m.index! + m[0].length);
      const why = rendered.includes(m[0].toLowerCase()) ? unseen(frame, range, element) : "not rendered";
      if (why === null) seen.add(m[0]);
      else if (!seen.has(m[0])) hidden[m[0]] = why;
    }
  }
  for (const word of seen) delete hidden[word];
  // A link is seen where a word or a picture inside it is.
  const links: string[] = [];
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    let shows = false;
    const inside = doc.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    for (let node = inside.nextNode(); node && !shows; node = inside.nextNode()) shows = visibleText.has(node);
    for (const image of Array.from(anchor.querySelectorAll("img"))) {
      if (shows) break;
      const r = image.getBoundingClientRect();
      const s = frame.contentWindow!.getComputedStyle(image);
      shows = r.width > 1 && r.height > 1 && s.visibility === "visible" && Number(s.opacity) >= MIN_OPACITY && (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0;
    }
    if (shows) links.push((anchor as HTMLAnchorElement).href);
  }
  return { seen: [...seen].sort(), hidden, links };
}
