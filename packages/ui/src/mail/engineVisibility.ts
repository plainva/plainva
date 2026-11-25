import { applyFrameFit } from "./frameFit";

/**
 * Which words of a mail the engine itself hides (plan Umsetzung 0.9.x, B7; Fehlerliste 0.9.0 F23): words the walk over
 * the reader's tree reads as shown, but that lie where no person sees them only because of where other boxes lie — run
 * out of their box sideways or downwards and painted over by a later box, a picture, a cell, a span with padding or a
 * border, or run off the frame's left or top edge. The walk judges an element by its own style; the engine knows where
 * everything lies. So the reader's frame document is laid out in the engine of this device, in an invisible frame of
 * each width a reader of either shell has (343 and 760 CSS pixels, fitted as the shells fit it), and each word is
 * asked of the engine at fifteen points across it: what is painted there on top of it — a box, a picture, a border, or a
 * later word (text later in the mail paints over earlier text). A word covered at more than six of the fifteen points
 * (about half of it), or that has no place a person can reach, at either width, is hidden: in doubt, it is not read.
 *
 * Nothing of the sanitizer changes: the reader shows every mail as before, and the assistant reads the walk's text
 * without the words the engine hides. Where there is no engine — no DOM, or one that lays nothing out (a test runner)
 * — the answer is `null`, and the walk's reading stands.
 */

/** A text's place in the tree, the same in the reader's tree and in the frame's: the path of its parent element and where in that parent's own text it starts. */
export interface WordPlace {
  /** The parent element's path from the body: the index among element children at each step, joined by "/". */
  parent: string;
  start: number;
  end: number;
}

export interface EngineHidden {
  /** Per parent path: the parent's own text (its text children joined), as the frame has it, and the ranges in it that are hidden. */
  parents: Map<string, { text: string; hidden: Array<[number, number]> }>;
}

/** The widths of the readers: the phone's frame and the desktop's. */
export const ENGINE_WIDTHS = [343, 760] as const;

/** A cover fainter than this lets the words below it through (`MIN_OPACITY` of the walk and of the gate). */
const COVER_OPACITY = 0.1;
/** Words asked of the engine between two turns of the interface. */
const WORDS_PER_STEP = 400;
/** How long the frame waits for its pictures (data: only; the assistant's view loads nothing from outside). */
const IMAGES_WAIT_MS = 1000;
/** Elements whose text no reader shows as words (the sanitizer takes most of them away). */
const NOT_WORDS = new Set(["style", "script", "noscript", "template", "title", "xmp", "noembed", "noframes", "iframe"]);
/** Elements that paint their box whatever their colours say. */
const REPLACED = new Set(["img", "svg", "video", "picture", "object", "embed", "canvas", "iframe", "input", "meter", "progress", "hr"]);

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The path of an element from the body: its index among element children at each step. */
export function elementPath(element: Element, body: Element): string | null {
  const steps: number[] = [];
  for (let at: Element | null = element; at && at !== body; at = at.parentElement) {
    const parent: Element | null = at.parentElement;
    if (!parent) return null;
    steps.push(Array.prototype.indexOf.call(parent.children, at) as number);
  }
  return steps.reverse().join("/");
}

/** Whether the engine can answer at all: a DOM that lays out (a test runner's has no layout and no hit test). */
function engineHere(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function" && typeof (document as Document & { elementsFromPoint?: unknown }).elementsFromPoint === "function";
}

function alpha(colour: string): number {
  if (!colour || colour === "transparent") return 0;
  const m = /rgba?\(([^)]+)\)/.exec(colour);
  if (!m) return 1;
  const parts = m[1]!.split(/[ ,/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
}

/** The opacity an element is drawn with: its own and every box's above it. */
function drawnOpacity(element: Element, win: Window): number {
  let opacity = 1;
  for (let at: Element | null = element; at; at = at.parentElement) opacity *= Number(win.getComputedStyle(at).opacity || "1");
  return opacity;
}

/**
 * Whether `element`, lying on top at (x, y), paints there: a background, a picture, or a border at that edge. Words of
 * its own are asked of their boxes, not of the element's box (`laterWords`): an inline box is taller than its ink.
 */
function paintsAt(element: Element, x: number, y: number, win: Window): boolean {
  const style = win.getComputedStyle(element);
  if (style.visibility !== "visible") return false;
  if (drawnOpacity(element, win) < COVER_OPACITY) return false;
  if (REPLACED.has(element.localName)) return true;
  if (alpha(style.backgroundColor) > 0 || (style.backgroundImage && style.backgroundImage !== "none")) return true;
  // A border paints its own strip of the box.
  const box = element.getBoundingClientRect();
  const edge = (width: string, colour: string, inside: boolean) => parseFloat(width) > 0 && alpha(colour) > 0 && inside;
  if (edge(style.borderTopWidth, style.borderTopColor, y < box.top + parseFloat(style.borderTopWidth))) return true;
  if (edge(style.borderBottomWidth, style.borderBottomColor, y > box.bottom - parseFloat(style.borderBottomWidth))) return true;
  if (edge(style.borderLeftWidth, style.borderLeftColor, x < box.left + parseFloat(style.borderLeftWidth))) return true;
  if (edge(style.borderRightWidth, style.borderRightColor, x > box.right - parseFloat(style.borderRightWidth))) return true;
  return false;
}

/** Whether something other than the word's own boxes paints at (x, y), in the frame's viewport, on top of the text `text`. */
function coveredAt(doc: Document, win: Window, text: Text, x: number, y: number): boolean {
  for (const element of doc.elementsFromPoint(x, y)) {
    // The word's own boxes: what lies further down is behind it.
    if (element.contains(text)) return false;
    if (paintsAt(element, x, y, win)) return true;
  }
  // Nothing at that point that holds the word: it is not where it is drawn.
  return true;
}

/** A box in the frame's document, in CSS pixels from its top left. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One word of the frame: its text, where it starts, and its boxes in the document. */
interface Word {
  text: Text;
  start: number;
  end: number;
  boxes: Box[];
}

/** The words of a text, as the engine of this device separates them (CJK into its words, not one line). */
function wordsOf(data: string): Array<{ index: number; word: string }> {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (!Segmenter) return Array.from(data.matchAll(/\S+/g), (m) => ({ index: m.index!, word: m[0] }));
  const out: Array<{ index: number; word: string }> = [];
  for (const part of new Segmenter(undefined, { granularity: "word" }).segment(data)) if (/\S/.test(part.segment)) out.push({ index: part.index, word: part.segment });
  return out;
}

/** Cells of the grid that finds the later words over a point. */
const CELL = 64;

/** The later words' boxes, by cell: where a later word lies, it paints over an earlier one (the same stacking order). */
class LaterWords {
  private readonly cells = new Map<string, Array<{ k: number; box: Box }>>();
  add(k: number, box: Box): void {
    // Its ink, roughly: an inline box reaches above and below the letters — from about the height of a small letter
    // down to the line the letters stand on.
    const h = box.bottom - box.top;
    const ink = { left: box.left, right: box.right, top: box.top + h * 0.35, bottom: box.bottom - h * 0.2 };
    for (let cx = Math.floor(ink.left / CELL); cx <= Math.floor(ink.right / CELL); cx++) {
      for (let cy = Math.floor(ink.top / CELL); cy <= Math.floor(ink.bottom / CELL); cy++) {
        const key = `${cx},${cy}`;
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, (cell = []));
        cell.push({ k, box: ink });
      }
    }
  }
  /** Whether a word after the word `k` lies over the point (document coordinates). */
  over(k: number, x: number, y: number): boolean {
    for (const entry of this.cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []) {
      if (entry.k > k && x >= entry.box.left && x <= entry.box.right && y >= entry.box.top && y <= entry.box.bottom) return true;
    }
    return false;
  }
}

/** Of the fifteen points across a word, how many may be covered with the word still seen: more than half of it shows, as the gate judges ink. */
const COVERED_POINTS_MAX = 6;

/** Whether a person sees the word `k`: some box of it covered at no more than six of fifteen points, in a place a person reaches. */
function wordSeen(frame: HTMLIFrameElement, word: Word, k: number, later: LaterWords): boolean {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  const root = doc.documentElement;
  const scrollsX = ["auto", "scroll"].includes(win.getComputedStyle(root).overflowX);
  const reachX = scrollsX ? Math.max(root.scrollWidth, frame.clientWidth) : frame.clientWidth;
  for (const box of word.boxes) {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    // Beyond the frame's left or top edge, or past where it lets a person go: nobody gets there.
    if (box.right <= 1 || box.bottom <= 0 || box.left >= reachX - 1) continue;
    let covered = 0;
    // Across the band the letters stand in: an inline box reaches well above them (and a little below the line).
    for (const fy of [0.35, 0.46, 0.57, 0.68, 0.79]) {
      for (const fx of [0.15, 0.5, 0.85]) {
        const x = box.left + width * fx;
        const y = box.top + height * fy;
        if (x < 0 || y < 0 || x >= reachX) {
          covered++;
          continue;
        }
        // Brought into the frame where it scrolls to it, as a person scrolls there.
        if (x < win.scrollX || x >= win.scrollX + win.innerWidth || y < win.scrollY || y >= win.scrollY + win.innerHeight) {
          win.scrollTo(Math.max(0, x - win.innerWidth / 2), Math.max(0, y - win.innerHeight / 2));
        }
        const vx = x - win.scrollX;
        const vy = y - win.scrollY;
        if (vx < 0 || vy < 0 || vx >= win.innerWidth || vy >= win.innerHeight) covered++;
        else if (later.over(k, x, y) || coveredAt(doc, win, word.text, vx, vy)) covered++;
      }
    }
    if (win.scrollX !== 0 || win.scrollY !== 0) win.scrollTo(0, 0);
    if (covered <= COVERED_POINTS_MAX) return true;
  }
  return false;
}

/** A frame of `width` with `frameDoc` in it, laid out and fitted as the shells fit the reader's; invisible and out of the way. */
async function openFrame(frameDoc: string, width: number): Promise<HTMLIFrameElement | null> {
  const frame = document.createElement("iframe");
  // No scripts, as the reader's: only the tree to read.
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:600px;border:0;opacity:0;pointer-events:none`;
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  // Every box answers the hit test: a mail cannot take a cover out of it.
  frame.srcdoc = frameDoc.replace("</head>", "<style>*{pointer-events:auto!important}</style></head>");
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  if (!doc?.body) {
    frame.remove();
    return null;
  }
  const images = Array.from(doc.images).filter((image) => !image.complete);
  if (images.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(images.map((image) => new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))),
      new Promise((resolve) => (timer = setTimeout(resolve, IMAGES_WAIT_MS))),
    ]);
    clearTimeout(timer);
  }
  applyFrameFit(frame, { growHeight: true });
  return frame;
}

/** The hidden ranges of one width, added to `out`. False where the frame could not be laid out. */
async function hiddenAt(frameDoc: string, width: number, out: EngineHidden): Promise<boolean> {
  const frame = await openFrame(frameDoc, width);
  if (!frame) return false;
  try {
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    const body = doc.body;
    // A frame that lays nothing out is no engine to ask (a test runner's DOM).
    if (body.getBoundingClientRect().width <= 0) return false;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    /** The offset of a text in its parent's own text, kept per parent while the walk is in it. */
    const offsets = new Map<Element, number>();
    const words: Array<Word & { path: string; offset: number }> = [];
    const later = new LaterWords();
    let measured = 0;
    win.scrollTo(0, 0);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const parent = text.parentElement;
      if (!parent) continue;
      const start = offsets.get(parent) ?? 0;
      offsets.set(parent, start + text.data.length);
      if (NOT_WORDS.has(parent.localName)) continue;
      const path = elementPath(parent, body);
      if (path === null) continue;
      for (const { index, word } of wordsOf(text.data)) {
        const range = doc.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + word.length);
        const boxes = Array.from(range.getClientRects())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ left: r.left + win.scrollX, top: r.top + win.scrollY, right: r.right + win.scrollX, bottom: r.bottom + win.scrollY }));
        const k = words.length;
        words.push({ text, start: index, end: index + word.length, boxes, path, offset: start });
        for (const box of boxes) later.add(k, box);
      }
      if (words.length - measured >= WORDS_PER_STEP) {
        measured = words.length;
        await turn();
      }
    }
    for (let k = 0; k < words.length; k++) {
      const word = words[k]!;
      if (!wordSeen(frame, word, k, later)) {
        let entry = out.parents.get(word.path);
        if (!entry) out.parents.set(word.path, (entry = { text: "", hidden: [] }));
        entry.hidden.push([word.offset + word.start, word.offset + word.end]);
      }
      if ((k + 1) % WORDS_PER_STEP === 0) await turn();
    }
    // The parents' own texts, for the check that the reader's tree is the frame's.
    for (const [element, length] of offsets) {
      const path = elementPath(element, body);
      const entry = path === null ? undefined : out.parents.get(path);
      if (!entry || entry.text) continue;
      entry.text = Array.from(element.childNodes).filter((child) => child.nodeType === 3).map((child) => (child as Text).data).join("");
      if (entry.text.length !== length) entry.text = "";
    }
    return true;
  } finally {
    frame.remove();
  }
}

/**
 * The words the engine hides of a reader frame document (`buildMailFrameDoc`), at every reader width; null where
 * there is no engine to ask. Between steps the interface gets its turn.
 */
export async function engineHiddenWords(frameDoc: string, widths: readonly number[] = ENGINE_WIDTHS): Promise<EngineHidden | null> {
  if (!engineHere() || !document.body) return null;
  const out: EngineHidden = { parents: new Map() };
  for (const width of widths) {
    if (!(await hiddenAt(frameDoc, width, out))) return null;
    await turn();
  }
  for (const entry of out.parents.values()) entry.hidden.sort((a, b) => a[0] - b[0]);
  return out;
}

/** `text` with the ranges blanked: each hidden code unit a blank, so what stands around them stays where it was. `offset`: where `text` starts in its parent's own text. */
export function blanked(text: string, ranges: ReadonlyArray<readonly [number, number]>, offset: number): string {
  let out = "";
  let at = 0;
  for (const [start, end] of ranges) {
    const from = Math.max(at, start - offset);
    const to = Math.min(text.length, end - offset);
    if (to <= from) continue;
    out += text.slice(at, from) + " ".repeat(to - from);
    at = to;
  }
  return out + text.slice(at);
}
