import { applyFrameFit } from "./frameFit";
import { mailReaderWidths } from "./readerWidth";

export { forgetMailReaderFrame, forgetMailReaderWidth, mailReaderWidth, mailReaderWidths, noteMailReaderWidth, READER_WIDTHS_MEASURED } from "./readerWidth";

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
 * without the words the engine hides.
 *
 * It fails closed (plan Umsetzung 0.9.x, B7, review): where the engine is there but the pass cannot finish — a frame
 * that does not load or lays nothing out, anything that throws —, `engineHiddenWords` throws, and the assistant reads
 * nothing of the message (`readableBodyInEngine`). Only where there is no layout engine at all (`hasLayoutEngine`:
 * no DOM, or a DOM without hit testing — a test runner's; no runtime of the app reads mail so) the answer is `null`,
 * and the walk's reading stands.
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

/**
 * The widths a mail is measured at: the two of the gate, and the widths this device's readers show mails in — every
 * reader on screen, then the latest kept (review B7-2, H13), at most `READER_WIDTHS_MEASURED` of them.
 */
export function engineWidths(): number[] {
  return [...new Set([...ENGINE_WIDTHS, ...mailReaderWidths()])].sort((a, b) => a - b);
}

/** The time the whole pass may take for one mail, all widths together; past it, nothing of the mail is read. */
export const ENGINE_BUDGET_MS = 3000;
/** The longest the pass holds the interface between two of its turns. */
const SLICE_MS = 12;
/** The least height a picture from the network whose height the reader does not fix is measured with (it is not loaded). */
const REMOTE_PICTURE_HEIGHT = 1000;
/** The intrinsic sizes a picture from the network is tried with, to learn which of its sizes the reader fixes. */
const PROBE_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 4000],
  [4000, 1],
];

/** A cover fainter than this lets the words below it through (`MIN_OPACITY` of the walk and of the gate). */
const COVER_OPACITY = 0.1;
/** How long the invisible frame may take to load before the pass gives up (and nothing is read). */
const LOAD_WAIT_MS = 5000;
/** How long the frame waits for its pictures (data: only; the assistant's view loads nothing from outside). */
const IMAGES_WAIT_MS = 1000;
/** Elements whose text no reader shows as words (the sanitizer takes most of them away). */
const NOT_WORDS = new Set(["style", "script", "noscript", "template", "title", "xmp", "noembed", "noframes", "iframe"]);
/** Elements that paint their box whatever their colours say. */
const REPLACED = new Set(["img", "svg", "video", "picture", "object", "embed", "canvas", "iframe", "input", "meter", "progress", "hr"]);

/**
 * The interface's turn (review B7-2, H15): a message task, not a timer — an engine throttles the timers of a hidden or
 * minimised window to about one a second, a message it hands on at once, so the pass keeps its pace there too.
 */
const turn = () =>
  new Promise<void>((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

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
/** Whether this runtime has a layout engine to ask: a DOM with hit testing. The app's web views all have one. */
export function hasLayoutEngine(): boolean {
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
  /** Whether the ink of an entry after `k` meets the ink band of `box`. */
  meets(k: number, box: Box): boolean {
    const h = box.bottom - box.top;
    const ink = { left: box.left, right: box.right, top: box.top + h * 0.35, bottom: box.bottom - h * 0.2 };
    for (let cx = Math.floor(ink.left / CELL); cx <= Math.floor(ink.right / CELL); cx++) {
      for (let cy = Math.floor(ink.top / CELL); cy <= Math.floor(ink.bottom / CELL); cy++) {
        for (const entry of this.cells.get(`${cx},${cy}`) ?? []) {
          if (entry.k > k && entry.box.left < ink.right && ink.left < entry.box.right && entry.box.top < ink.bottom && ink.top < entry.box.bottom) return true;
        }
      }
    }
    return false;
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
function wordSeen(frame: HTMLIFrameElement, word: Word, laterOver: (x: number, y: number) => boolean): boolean {
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
        else if (laterOver(x, y) || coveredAt(doc, win, word.text, vx, vy)) covered++;
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
  // In the window, not beside it (review B7-2): WebKit answers no hit test in a frame outside the window — every word
  // asked one by one would count as covered. Seen by nobody (opacity 0), behind everything, taking no click or focus.
  frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:600px;border:0;opacity:0;pointer-events:none;z-index:-2147483647`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loaded = Promise.race([
    new Promise<boolean>((resolve) => frame.addEventListener("load", () => resolve(true), { once: true })),
    new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), LOAD_WAIT_MS))),
  ]);
  // Every box answers the hit test: a mail cannot take a cover out of it.
  frame.srcdoc = frameDoc.replace("</head>", `<style>*{pointer-events:auto!important}</style></head>`);
  document.body.append(frame);
  const came = await loaded;
  clearTimeout(timer);
  const doc = frame.contentDocument;
  if (!came || !doc?.body) {
    frame.remove();
    return null;
  }
  await picturesLoaded(doc);
  // The pictures from the network (B7, review M8; review B7-2, S3): never loaded here. Which of a picture's sizes the
  // reader fixes is asked of the layout under the reader's own rules (`MAIL_IMAGE_RULES`), not of its markup: it is
  // tried with pictures of three shapes, and a size that changes with the picture is the picture's — as large as the
  // reader lets it be then: as wide as its box, as tall as the whole mail laid out (`max-width`/`max-height` bound it).
  const free = await remotePictureFreedom(doc);
  applyFrameFit(frame, { growHeight: true });
  if (free.length) {
    const tall = `${Math.max(doc.documentElement.scrollHeight, REMOTE_PICTURE_HEIGHT)}px`;
    for (const { picture, width, height } of free) {
      if (width) picture.style.setProperty("width", "100%", "important");
      if (height) picture.style.setProperty("height", tall, "important");
    }
    applyFrameFit(frame, { growHeight: true });
  }
  return frame;
}

/**
 * Waits for the pictures of the frame (data: only here) to load or fail; throws where they do not in time. Asked of each
 * picture's own state in step with the interface, not of its events (review B7-2): WebKit sends a frame without scripts
 * no `load` to a listener outside it, though the picture is there.
 */
async function picturesLoaded(doc: Document): Promise<void> {
  const until = now() + IMAGES_WAIT_MS;
  while (Array.from(doc.images).some((image) => image.hasAttribute("src") && !image.complete)) {
    if (now() > until) throw new Error("the mail's pictures did not load in time");
    await turn();
  }
}

/** A picture of `width` × `height` that loads at once and shows nothing: the stand-in of a picture from the network. */
const probePicture = (width: number, height: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`)}`;

/**
 * Which sizes of each picture from the network the reader leaves to the picture (review B7-2, S3): each is shown with
 * stand-ins of three shapes in turn; a width or height that differs between them is not fixed by the mail under the
 * reader's rules. The stand-in of 1 × 1 stays in place afterwards.
 */
async function remotePictureFreedom(doc: Document): Promise<Array<{ picture: HTMLImageElement; width: boolean; height: boolean }>> {
  const pictures = Array.from(doc.querySelectorAll<HTMLImageElement>("img:not([src])"));
  if (!pictures.length) return [];
  const seen = pictures.map(() => [] as Array<{ width: number; height: number }>);
  for (const [width, height] of PROBE_SIZES) {
    for (const picture of pictures) picture.setAttribute("src", probePicture(width, height));
    await picturesLoaded(doc);
    pictures.forEach((picture, n) => {
      const box = picture.getBoundingClientRect();
      seen[n]!.push({ width: box.width, height: box.height });
    });
  }
  for (const picture of pictures) picture.setAttribute("src", probePicture(1, 1));
  await picturesLoaded(doc);
  const differs = (values: number[]) => values.some((value) => Math.abs(value - values[0]!) > 0.5);
  return pictures.map((picture, n) => ({ picture, width: differs(seen[n]!.map((size) => size.width)), height: differs(seen[n]!.map((size) => size.height)) }));
}

/** The hidden ranges of one width, added to `out`. Throws where the frame could not be laid out.  */
/** The boxes of a range in the frame's document coordinates; WebKit can give a drawn range at a text's end none of
 * its client boxes, its bounding box stands in then. */
function boxesOf(range: Range, win: Window): Box[] {
  let rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (rects.length === 0) {
    const bound = range.getBoundingClientRect();
    if (bound.width > 0 && bound.height > 0) rects = [bound];
  }
  return rects.map((r) => ({ left: r.left + win.scrollX, top: r.top + win.scrollY, right: r.right + win.scrollX, bottom: r.bottom + win.scrollY }));
}

/** How far to the right a person gets in the frame: where it scrolls to, else its width. */
function reachOf(frame: HTMLIFrameElement): number {
  const doc = frame.contentDocument!;
  const root = doc.documentElement;
  const scrollsX = ["auto", "scroll"].includes(frame.contentWindow!.getComputedStyle(root).overflowX);
  return scrollsX ? Math.max(root.scrollWidth, frame.clientWidth) : frame.clientWidth;
}

/** Whether a box clipping its content (`overflow` other than visible) cuts into the text's lines. */
function clipped(text: Text, lines: readonly Box[], win: Window): boolean {
  for (let at = text.parentElement; at && at !== at.ownerDocument.body; at = at.parentElement) {
    const style = win.getComputedStyle(at);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const r = at.getBoundingClientRect();
    const box = { left: r.left + win.scrollX, top: r.top + win.scrollY, right: r.right + win.scrollX, bottom: r.bottom + win.scrollY };
    if (lines.some((line) => line.left < box.left || line.right > box.right || line.top < box.top || line.bottom > box.bottom)) return true;
  }
  return false;
}

/** Everything in the mail that paints its box — a background, a picture, a border —, found by where it lies. */
async function paintingBoxes(doc: Document, win: Window, pace: Pace): Promise<{ over(text: Text, lines: readonly Box[]): boolean }> {
  const cells = new Map<string, Array<{ element: Element; box: Box }>>();
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    // In step with the interface (review B7-2, H14): a mail of thousands of painting boxes holds it no longer than a slice.
    await pace.step();
    const style = win.getComputedStyle(element);
    if (style.visibility !== "visible" || style.display === "none") continue;
    const paints =
      REPLACED.has(element.localName) ||
      alpha(style.backgroundColor) > 0 ||
      (style.backgroundImage && style.backgroundImage !== "none") ||
      ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0);
    if (!paints) continue;
    for (const r of Array.from(element.getClientRects())) {
      if (r.width <= 0 || r.height <= 0) continue;
      const box = { left: r.left + win.scrollX, top: r.top + win.scrollY, right: r.right + win.scrollX, bottom: r.bottom + win.scrollY };
      for (let cx = Math.floor(box.left / CELL); cx <= Math.floor(box.right / CELL); cx++) {
        for (let cy = Math.floor(box.top / CELL); cy <= Math.floor(box.bottom / CELL); cy++) {
          const key = `${cx},${cy}`;
          let cell = cells.get(key);
          if (!cell) cells.set(key, (cell = []));
          cell.push({ element, box });
        }
      }
    }
  }
  return {
    over(text, lines) {
      for (const line of lines) {
        for (let cx = Math.floor(line.left / CELL); cx <= Math.floor(line.right / CELL); cx++) {
          for (let cy = Math.floor(line.top / CELL); cy <= Math.floor(line.bottom / CELL); cy++) {
            for (const { element, box } of cells.get(`${cx},${cy}`) ?? []) {
              // A box that holds the text paints behind it; only another one can lie over it.
              if (element.contains(text)) continue;
              if (box.left < line.right && line.left < box.right && box.top < line.bottom && line.top < box.bottom) return true;
            }
          }
        }
      }
      return false;
    },
  };
}

/** Code units of the text drawn under a direction override (U+202D, U+202E up to U+202C; `<bdo>`, `bidi-override`). */
function overriddenRanges(text: Text, win: Window): Array<[number, number]> {
  for (let at = text.parentElement; at; at = at.parentElement) {
    const style = win.getComputedStyle(at);
    if (at.localName === "bdo" || /override/.test(style.unicodeBidi)) return [[0, text.data.length]];
  }
  const out: Array<[number, number]> = [];
  let open = -1;
  for (let i = 0; i < text.data.length; i++) {
    const c = text.data.charCodeAt(i);
    if ((c === 0x202d || c === 0x202e) && open < 0) open = i;
    else if (c === 0x202c && open >= 0) {
      out.push([open, i]);
      open = -1;
    }
  }
  if (open >= 0) out.push([open, text.data.length]);
  return out;
}

/** A letter of a script written right to left (Hebrew, Arabic, Syriac, Thaana, N'Ko …). */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]|\uD802[\uDC00-\uDFFF]|\uD803[\uDC00-\uDE7F]/;
/** A letter of a script written left to right (Latin, Greek, Cyrillic … — anything with letters that is not the above). */
const LTR_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
/** What can turn the order of words around without an override: marks, embeddings, isolates, a right-to-left box. */
const REORDERING = /[\u200F\u061C\u202B\u2067\u2068]/;

/**
 * The block a text is laid out in: the nearest ancestor that is not inline (review B7-3, M13). Words turned around by
 * direction marks stand on one line of one block, whatever elements (`<b>`, `<span>`, `<a>`, `<bdi>`) lie between them.
 */
function blockOf(text: Text, win: Window, blocks: Map<Element, Element>): Element | null {
  const parent = text.parentElement;
  if (!parent) return null;
  const known = blocks.get(parent);
  if (known) return known;
  let at: Element = parent;
  while (at.parentElement && /^(inline|contents)/.test(win.getComputedStyle(at).display)) at = at.parentElement;
  blocks.set(parent, at);
  return at;
}

/**
 * Whether the order of a block's words on screen can differ from their order in the text (a cheap check first): it
 * holds a mark, an embedding or an isolate, or it or something in it has a direction of its own. Not `unicode-bidi`
 * itself: the engine's own sheet makes every block an isolate, and a block of left-to-right text turns nothing around.
 */
function mayReorder(block: Element, win: Window, known: Map<Element, boolean>): boolean {
  let may = known.get(block);
  if (may !== undefined) return may;
  may = REORDERING.test(block.textContent ?? "") || block.closest("[dir],bdi") !== null || block.querySelector("[dir],bdi") !== null || win.getComputedStyle(block).direction === "rtl";
  known.set(block, may);
  return may;
}

/**
 * Words a person reads in another order than they stand in the text, without an override (review B7-2, M11; review
 * B7-3, M13): two words of a left-to-right script on one line of one block, with no letter of a right-to-left script
 * between them, the later one drawn before the earlier — only invisible marks, embeddings or isolates turn them so,
 * across the elements between them too. Both are left out, as under an override. Right-to-left text, and a
 * left-to-right name inside it, keep their order and are read. Fed the block's words in the order of the text.
 */
class WordOrder {
  private block: Element | null = null;
  private last: { box: Box; hide: () => void } | null = null;

  next(block: Element, word: string, box: Box | null, hide: () => void): void {
    if (block !== this.block) {
      this.block = block;
      this.last = null;
    }
    // A word of a right-to-left script starts over; marks, spaces and punctuation between two words are passed by.
    if (RTL_LETTER.test(word)) {
      this.last = null;
      return;
    }
    if (!LTR_LETTER.test(word) || !box) return;
    const a = this.last;
    this.last = { box, hide };
    if (!a) return;
    // One line: the same top within a fifth of the word's height — lines laid over each other are not one line.
    const height = Math.min(a.box.bottom - a.box.top, box.bottom - box.top);
    const oneLine = Math.abs(a.box.top - box.top) < 0.2 * height && Math.abs(a.box.bottom - box.bottom) < 0.2 * height;
    if (oneLine && box.right <= a.box.left + 0.5) {
      a.hide();
      hide();
    }
  }
}

/** The pass ran out of its budget (B7, review M4): the mail is too long to check in time, not unsafe. */
export class EngineBudgetError extends Error {
  constructor() {
    super("the mail's engine pass ran out of time");
    this.name = "EngineBudgetError";
  }
}

/** The pass's clock (B7, review M4): it gives the interface its turn every few milliseconds and stops at its budget. */
class Pace {
  private slice = now();
  constructor(private readonly deadline: number) {}
  async step(): Promise<void> {
    const at = now();
    if (at > this.deadline) throw new EngineBudgetError();
    if (at - this.slice >= SLICE_MS) {
      await turn();
      this.slice = now();
    }
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

async function hiddenAt(frameDoc: string, width: number, out: EngineHidden, pace: Pace): Promise<void> {
  const frame = await openFrame(frameDoc, width);
  if (!frame) throw new Error("the mail's frame did not load");
  try {
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    const body = doc.body;
    // A frame that lays nothing out cannot say what shows: nothing is read (fail closed).
    if (body.getBoundingClientRect().width <= 0) throw new Error("the mail's frame laid nothing out");
    win.scrollTo(0, 0);
    const reachX = reachOf(frame);
    const hide = (path: string, from: number, to: number) => {
      let entry = out.parents.get(path);
      if (!entry) out.parents.set(path, (entry = { text: "", hidden: [] }));
      entry.hidden.push([from, to]);
    };
    // First the texts as a whole (B7, review M4): their line boxes, and what paints anywhere in the mail. Only a text
    // whose lines meet something that paints and holds no part of it, a later text, a clipping box's edge or the
    // frame's edge is asked word by word; every other text is seen as it stands — nothing lies over it.
    const painters = await paintingBoxes(doc, win, pace);
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    /** The offset of a text in its parent's own text, kept per parent while the walk is in it. */
    const offsets = new Map<Element, number>();
    const texts: Array<{ text: Text; path: string; offset: number; lines: Box[] }> = [];
    const laterText = new LaterWords();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const parent = text.parentElement;
      if (!parent) continue;
      const start = offsets.get(parent) ?? 0;
      offsets.set(parent, start + text.data.length);
      if (NOT_WORDS.has(parent.localName) || !/\S/.test(text.data)) continue;
      const path = elementPath(parent, body);
      if (path === null) continue;
      const range = doc.createRange();
      range.selectNodeContents(text);
      const lines = boxesOf(range, win);
      const k = texts.length;
      texts.push({ text, path, offset: start, lines });
      for (const line of lines) laterText.add(k, line);
      await pace.step();
    }
    // Word order across a block (review B7-3, M13): the blocks the texts lie in, which of them may turn words around.
    const blocks = new Map<Element, Element>();
    const reorderable = new Map<Element, boolean>();
    const order = new WordOrder();
    for (let k = 0; k < texts.length; k++) {
      const { text, path, offset, lines } = texts[k]!;
      // Under a direction override a person sees the letters mirrored: none of it is read (B7, review H7).
      const overridden = overriddenRanges(text, win);
      for (const [from, to] of overridden) hide(path, offset + from, offset + to);
      // Words turned around without one (review B7-2, M11): left out the same way.
      const block = blockOf(text, win, blocks);
      if (block && mayReorder(block, win, reorderable)) {
        for (const { index, word } of wordsOf(text.data)) {
          const range = doc.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + word.length);
          order.next(block, word, boxesOf(range, win)[0] ?? null, () => {
            hide(path, offset + index, offset + index + word.length);
            overridden.push([index, index + word.length]);
          });
          await pace.step();
        }
      }
      // Its own later lines over its earlier ones (lines laid on top of each other) count as well.
      const own = new LaterWords();
      lines.forEach((line, n) => own.add(n, line));
      const plain =
        lines.length > 0 &&
        !lines.some((line) => line.left < 0 || line.top < 0 || line.right > reachX) &&
        !clipped(text, lines, win) &&
        !painters.over(text, lines) &&
        !lines.some((line, n) => laterText.meets(k, line) || own.meets(n, line));
      if (plain) {
        await pace.step();
        continue;
      }
      // Word by word: each one's boxes, and the words after it in this text, which paint over it where they meet.
      const words = wordsOf(text.data).filter(({ index }) => !overridden.some(([from, to]) => index >= from && index < to));
      // Each word's boxes in step with the interface (review B7-2, H14): a text of thousands of words is no one task.
      const measured: Array<{ index: number; length: number; boxes: Box[] }> = [];
      for (const { index, word } of words) {
        const range = doc.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + word.length);
        measured.push({ index, length: word.length, boxes: boxesOf(range, win) });
        await pace.step();
      }
      const laterWords = new LaterWords();
      measured.forEach((word, n) => word.boxes.forEach((box) => laterWords.add(n, box)));
      for (let n = 0; n < measured.length; n++) {
        const { index, length, boxes } = measured[n]!;
        const seen = wordSeen(frame, { text, start: index, end: index + length, boxes }, (x, y) => laterText.over(k, x, y) || laterWords.over(n, x, y));
        if (!seen) hide(path, offset + index, offset + index + length);
        await pace.step();
      }
    }
    // The parents' own texts, for the check that the reader's tree is the frame's.
    for (const [element, length] of offsets) {
      const path = elementPath(element, body);
      const entry = path === null ? undefined : out.parents.get(path);
      if (!entry || entry.text) continue;
      entry.text = Array.from(element.childNodes).filter((child) => child.nodeType === 3).map((child) => (child as Text).data).join("");
      if (entry.text.length !== length) entry.text = "";
    }
  } finally {
    frame.remove();
  }
}

/**
 * The words the engine hides of a reader frame document (`buildMailFrameDoc`), at every reader width; null where
 * there is no engine to ask. Between steps the interface gets its turn.
 */
export async function engineHiddenWords(frameDoc: string, widths: readonly number[] = engineWidths(), budgetMs: number = ENGINE_BUDGET_MS): Promise<EngineHidden | null> {
  // No layout engine at all — the one place the walk's reading stands (a test runner; no runtime of the app).
  if (!hasLayoutEngine()) return null;
  if (!document.body) throw new Error("no document to lay the mail out in");
  const out: EngineHidden = { parents: new Map() };
  const pace = new Pace(now() + budgetMs);
  for (const width of widths) {
    await hiddenAt(frameDoc, width, out, pace);
    await pace.step();
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
