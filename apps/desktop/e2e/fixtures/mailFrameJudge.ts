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
 * its colour stands out from what is painted behind it — and, for a marker
 * word, when at least half of its ink reaches the screen (review of
 * 2026-11-18): the pixels that change when the word alone turns transparent,
 * against the pixels it leaves alone, in its own colour on its own ground (`markWords`, `markMode`,
 * `inkCounts`; the screenshots are the test's). Whatever lies over a word —
 * a picture, a box, a cell, a later line — takes ink away, however it got
 * there. No other code: this file imports nothing.
 */

/** The marker words of the cases: what is meant to be read, and what may be hidden. */
export const MARKER = /\b(?:SECRET|VISIBLE)[A-Za-z0-9_]*/g;
export const MIN_TEXT_PX = 4;
export const MIN_OPACITY = 0.1;
export const MIN_CONTRAST = 1.3;
/** A pixel changes when one of its channels moves by this much: about the step of the least contrast (`MIN_CONTRAST`) from white. */
const INK_STEP = 16;
/** The share of a word's ink that must reach the screen for the word to count as seen. */
export const MIN_INK_SHARE = 0.5;

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

/** The colour of the words of `range` and what the engine paints behind them, at the box `first` of them (a gradient's stops, where one lies behind). */
function groundOf(frame: HTMLIFrameElement, range: Range, first: DOMRect): { colour: Rgba; behind: Rgba; stops: Rgba[] } {
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
  return { colour, behind, stops: stops.map((stop) => over(stop, behind)) };
}

/** The contrast of the words of `range` against what the engine paints behind them, at the box `first` of them. */
export function textContrast(frame: HTMLIFrameElement, range: Range, first: DOMRect): number {
  const { colour, behind, stops } = groundOf(frame, range, first);
  // A gradient covers its box: the words stand on its colours, the least of them counts.
  let least = Infinity;
  for (const background of stops.length > 0 ? stops : [behind]) least = Math.min(least, contrast(over(colour, background), background));
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

/** A box on the page, in CSS pixels from its top left. */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A marker word of a frame, wrapped for the pixel judge: where it lies on the page, and whether it must be shot on its own. */
export interface MarkedWord {
  k: number;
  word: string;
  /** Its box on the page, cut to the frame; `null` where none of it lies in the frame as it stands. */
  box: PageBox | null;
  /** Shot on its own: it lies where the frame scrolls to, or across another marker word. */
  alone: boolean;
}

const WORD_ATTR = "data-pv-ink";

/** The box of the word `k` on the page, cut to the frame (`null` where none of it is in the frame as it stands). */
export function wordBox(frame: HTMLIFrameElement, k: number): { box: PageBox | null; whole: boolean } {
  const doc = frame.contentDocument!;
  const span = doc.querySelector(`[${WORD_ATTR}="${k}"]`);
  const rects = span ? Array.from(span.getClientRects()).filter((r) => r.width > 0 && r.height > 0) : [];
  if (rects.length === 0) return { box: null, whole: false };
  const l = Math.min(...rects.map((r) => r.left));
  const t = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((r) => r.right));
  const b = Math.max(...rects.map((r) => r.bottom));
  const at = frame.getBoundingClientRect();
  const cl = Math.max(l, 0);
  const ct = Math.max(t, 0);
  const cr = Math.min(r, frame.clientWidth);
  const cb = Math.min(b, frame.clientHeight);
  if (cr - cl < 1 || cb - ct < 1) return { box: null, whole: false };
  const box = { x: Math.floor(at.left + window.scrollX + cl), y: Math.floor(at.top + window.scrollY + ct), width: Math.ceil(cr - cl) + 1, height: Math.ceil(cb - ct) + 1 };
  return { box, whole: cl === l && cr === r && ct === t && cb === b };
}

/**
 * Wraps every marker word of the frame in a span of its own, for the pixel
 * judge. Call after `judgeFrame`: a span splits the text nodes it judged.
 */
export function markWords(frame: HTMLIFrameElement): MarkedWord[] {
  const doc = frame.contentDocument!;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const words: MarkedWord[] = [];
  let k = 0;
  for (const text of nodes) {
    for (const m of Array.from(text.data.matchAll(MARKER)).reverse()) {
      const range = doc.createRange();
      range.setStart(text, m.index!);
      range.setEnd(text, m.index! + m[0].length);
      // The word as it stands, in its own colour on its own ground: the sheet its ink is measured on.
      const first = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
      const ground = first ? groundOf(frame, range, first) : null;
      const span = doc.createElement("span");
      span.setAttribute(WORD_ATTR, String(k));
      if (ground) {
        const css = (c: Rgba) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
        // On a gradient, the stop the words stand out from most: the contrast judges the least of them.
        const grounds = ground.stops.length > 0 ? ground.stops : [ground.behind];
        const best = grounds.reduce((a, b) => (contrast(over(ground.colour, b), b) > contrast(over(ground.colour, a), a) ? b : a));
        span.setAttribute("data-pv-ink-colour", css(over(ground.colour, best)));
        span.setAttribute("data-pv-ink-ground", css(best));
      }
      range.surroundContents(span);
      words.push({ k: k++, word: m[0], box: null, alone: false });
    }
  }
  frame.contentWindow!.scrollTo(0, 0);
  for (const word of words) {
    const { box, whole } = wordBox(frame, word.k);
    word.box = box;
    word.alone = !whole;
  }
  const meets = (a: PageBox, b: PageBox) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const word of words) {
    if (word.box && words.some((other) => other !== word && other.box && meets(word.box!, other.box))) word.alone = true;
  }
  return words;
}

/**
 * Sets the marker words (all, or the word `k`) as a shot needs them: as the
 * mail draws them (`shown`), turned transparent (`gone`), alone on a sheet of
 * their own ground in their own colour (`ink`), or alone and transparent
 * (`none`). Whether the colour stands out from the ground is the contrast's
 * question (`textContrast`); the ink asks how much of the word reaches the screen.
 */
export function markMode(frame: HTMLIFrameElement, mode: "shown" | "gone" | "ink" | "none", k?: number): void {
  const doc = frame.contentDocument!;
  doc.getElementById("pv-ink-sheet")?.remove();
  const which = k === undefined ? `[${WORD_ATTR}]` : `[${WORD_ATTR}="${k}"]`;
  const rules: string[] = [];
  if (mode === "ink" || mode === "none") rules.push(`*{visibility:hidden!important}${which}{visibility:visible!important}`);
  if (mode === "ink" || mode === "none") {
    for (const span of Array.from(doc.querySelectorAll(which))) {
      const colour = span.getAttribute("data-pv-ink-colour") ?? "rgb(0,0,0)";
      const ground = span.getAttribute("data-pv-ink-ground") ?? "rgb(255,255,255)";
      const own = `[${WORD_ATTR}="${span.getAttribute(WORD_ATTR)}"]`;
      rules.push(`${own}{background-color:${ground}!important;background-image:none!important${mode === "ink" ? `;color:${colour}!important;-webkit-text-fill-color:${colour}!important` : ""}}`);
    }
  }
  if (mode === "gone" || mode === "none") rules.push(`${which}{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}`);
  if (rules.length === 0) return;
  const sheet = doc.createElement("style");
  sheet.id = "pv-ink-sheet";
  sheet.textContent = rules.join("");
  (doc.head ?? doc.documentElement).append(sheet);
}

/** Scrolls the frame so that the word `k` is in it, as a person scrolls to it; its box on the page then. */
export function scrollToWord(frame: HTMLIFrameElement, k: number): PageBox | null {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  const span = doc.querySelector(`[${WORD_ATTR}="${k}"]`);
  const first = span ? Array.from(span.getClientRects()).find((r) => r.width > 0 && r.height > 0) : undefined;
  if (!first) return null;
  win.scrollTo(Math.max(0, first.left + win.scrollX - 10), Math.max(0, first.top + win.scrollY - 10));
  return wordBox(frame, k).box;
}

/** Of two screenshots of the same place (PNG, base64), the pixels that differ inside each box (relative to the shot). */
export async function inkCounts(a: string, b: string, boxes: Array<{ x: number; y: number; width: number; height: number }>): Promise<number[]> {
  const load = (data: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${data}`;
    });
  const [first, second] = await Promise.all([load(a), load(b)]);
  const canvas = document.createElement("canvas");
  canvas.width = first.width;
  canvas.height = first.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(first, 0, 0);
  const one = g.getImageData(0, 0, canvas.width, canvas.height).data;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(second, 0, 0);
  const two = g.getImageData(0, 0, canvas.width, canvas.height).data;
  return boxes.map((box) => {
    let n = 0;
    for (let y = Math.max(0, box.y); y < Math.min(canvas.height, box.y + box.height); y++) {
      for (let x = Math.max(0, box.x); x < Math.min(canvas.width, box.x + box.width); x++) {
        const i = (y * canvas.width + x) * 4;
        if (Math.max(Math.abs(one[i] - two[i]), Math.abs(one[i + 1] - two[i + 1]), Math.abs(one[i + 2] - two[i + 2])) >= INK_STEP) n++;
      }
    }
    return n;
  });
}
