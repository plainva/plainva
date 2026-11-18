import createDOMPurify from "dompurify";
import { keptMailStyle, MailShaper, visibleDocumentOf, visibleDocumentSteps, WHITE_SHEET, type ShapeState, type VisibleDocument } from "@plainva/core";
import { domReader, treeAccess } from "./mailTree";

// The package's default export is a FACTORY in module environments: each pass
// binds its own to the window (desktop + jsdom tests both have one at call
// time), so a pass in steps and one made at once never share hooks.

/**
 * E-mail HTML sanitizer (PIM stage 5): the sandbox viewer renders FOREIGN,
 * attacker-controlled HTML — the single largest new attack surface of the
 * PIM expansion. Defense in depth:
 *
 *   1. DOMPurify strips scripts/event handlers/forms entirely.
 *   2. REMOTE CONTENT IS HARD-BLOCKED (tracking pixels, remote images, css
 *      url() loaders): every fetching attribute with a remote target is
 *      removed and counted; only self-contained data: images survive.
 *      Links KEEP their (DOMPurify-vetted, safe-scheme) href; the reader routes
 *      a click to the SYSTEM browser (MailView.handleFrameLoad) — a bare
 *      target=_blank never opens inside a Tauri WebView. No scripts and no
 *      remote content run, so a link can only navigate on an explicit click.
 *   3. Inline styles keep only the declarations `MAIL_STYLE` (core) knows and
 *      reads — no positions, transforms or clipping paths, no escapes — and
 *      the tree is shaped so that no box reaches past the frame and no colour
 *      outlives the background it was set on (`MailShaper`, core): nothing
 *      can take words off the screen that the visible-text walk does not see
 *      taken off. The walk reads the very tree the reader is given
 *      (`MailHtmlView`).
 *   4. The caller renders the result into an allow-same-origin sandboxed
 *      <iframe> that has NO allow-scripts (so the mail HTML cannot execute any
 *      code) plus a default-src 'none' CSP meta — belt and braces should 1+2
 *      miss.
 */

export interface SanitizedEmail {
  html: string;
  /** Number of removed remote references (shown as a "blocked" hint). */
  blockedRemote: number;
}

export interface SanitizeEmailOptions {
  /** Explicit user opt-in (per message or the global setting): https: image
   * sources are allowed to load. This is the ONLY relaxation — loading a
   * remote image is by definition a tracking beacon (sender sees IP and open
   * time), which is why the default stays blocked. Everything else (scripts,
   * forms, css url(), srcset/poster/background, non-https schemes, links)
   * remains hard-blocked even with the opt-in. */
  allowRemoteImages?: boolean;
}

const FETCHING_ATTRS = new Set(["src", "srcset", "poster", "background", "xlink:href", "action", "formaction", "ping"]);
const DATA_IMAGE = /^\s*data:image\//i;
const HTTPS_URL = /^\s*https:\/\//i;

/**
 * DOMPurify's own list of schemes a link may keep (3.x, `IS_ALLOWED_URI`),
 * plus Plainva's note links (`plainva://open?…`, ADR 0037): a mail may point
 * at a note, and the reader opens it in the app — never through the system.
 */
const MAIL_ALLOWED_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|plainva(?:-dev|-labs)?):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/** Attributes the shaper reads as the mail wrote them and gives the reader anew (`MailShaper`). */
const SHAPED_ATTRS = new Set(["style", "hidden", "nowrap", "bgcolor", "width", "height", "cellpadding", "cellspacing", "hspace", "vspace", "border"]);

/** A sanitized mail together with what the reader shows of it, read once and shared by everything that asks. */
export interface MailHtmlView extends SanitizedEmail {
  /** The text and links the reader shows, read off the tree it is given. */
  document(): VisibleDocument;
  /** Whether the reader shows anything at all — a word or a picture. */
  shows(): boolean;
}

/** Passes made last: the reader, the quote and the assistant ask about the same message. */
const PASSES = new Map<string, Pass>();
const PASSES_MAX = 4;

export function sanitizeEmailHtml(raw: string, options?: SanitizeEmailOptions): SanitizedEmail {
  return mailHtmlView(raw, options);
}

/**
 * The mail's HTML as the reader is given it (`sanitizeEmailHtml`), and what the
 * reader shows of it: ONE pass of the sanitizer and the shaper over the mail,
 * and one walk over the tree they leave — for the reader of either shell, the
 * quote, the filed note and the assistant alike (review of 2026-11-17: each of
 * them sanitized and read the same mail again, a newsletter of 500 KB took the
 * assistant seconds). The pass does not hang on the remote-image choice: it
 * keeps the address of a picture beside the tree, and each choice is a view of
 * it — the reader with pictures and the assistant without share one pass.
 * Throws where there is no DOM.
 */
export function mailHtmlView(raw: string, options?: SanitizeEmailOptions): MailHtmlView {
  let pass = PASSES.get(raw);
  if (!pass) {
    const steps = passSteps(raw);
    let step = steps.next();
    while (!step.done) step = steps.next();
    pass = step.value;
  }
  return keep(raw, pass, options);
}

/** Keeps the pass of `raw` as the one made last, and gives the view asked for. */
function keep(raw: string, pass: Pass, options?: SanitizeEmailOptions): MailHtmlView {
  PASSES.delete(raw);
  PASSES.set(raw, pass);
  while (PASSES.size > PASSES_MAX) PASSES.delete(PASSES.keys().next().value as string);
  return options?.allowRemoteImages === true ? pass.withPictures : pass.withoutPictures;
}

/**
 * A turn for the interface: a message to itself rather than a timer, which a
 * browser holds back by some milliseconds once timers nest.
 */
function nextTurn(): Promise<void> {
  if (typeof MessageChannel !== "function") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** The longest the pass works at a stretch when it lets the interface in between (`mailHtmlViewSoon`). */
const SLICE_MS = 6;

/**
 * `mailHtmlView` for a reader that is not on screen — the assistant reading
 * mails nobody opened (review of 2026-11-17, round 5): the same pass, step for
 * step, but it hands the interface its turn whenever it has worked
 * `SLICE_MS`, so no mail blocks the app longer than one step of it. Its view
 * is the reader's: the pass is kept for both.
 */
export async function mailHtmlViewSoon(raw: string, options?: SanitizeEmailOptions): Promise<MailHtmlView> {
  let pass = PASSES.get(raw);
  if (!pass) {
    // The pass begins in a turn of its own, and the reading of what it leaves has one too.
    await nextTurn();
    const steps = passSteps(raw);
    let since = performance.now();
    let step = steps.next();
    while (!step.done) {
      if (performance.now() - since > SLICE_MS) {
        await nextTurn();
        since = performance.now();
      }
      step = steps.next();
    }
    pass = PASSES.get(raw) ?? step.value;
    since = performance.now();
    const reading = pass.readSteps();
    for (let next = reading.next(); !next.done; next = reading.next()) {
      if (performance.now() - since > SLICE_MS) {
        await nextTurn();
        since = performance.now();
      }
    }
    await nextTurn();
  }
  return keep(raw, pass, options);
}

/** What an empty mail shows. */
const NOTHING: VisibleDocument = { text: "", links: [], shows: false };

/** One pass over a mail and its two views. */
interface Pass {
  withPictures: MailHtmlView;
  withoutPictures: MailHtmlView;
  /** What the reader shows of it read in steps, for `mailHtmlViewSoon`; afterwards `document()` has it. */
  readSteps(): Generator<void, void, void>;
}

/** Elements whose text a reader never shows as words of the mail (the sanitizer takes most of them away). */
const NOT_WORDS = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE", "TITLE", "XMP", "NOEMBED", "NOFRAMES", "IFRAME"]);
/** Blanks, no-break spaces and the characters of no width: a spacer cell's `&nbsp;` is no word. */
const NO_WORD = /^[\s\u200b-\u200d\u2060\u00ad]*$/;

/**
 * How the pass asks the tree it is given — the mail's own, before the
 * sanitizer: through the prototypes, never the nodes, since a mail names its
 * elements as it likes (`<img name="body">` answers `document.body`, an input
 * named `childNodes` answers its form's).
 */
interface RawTree {
  read: NonNullable<ReturnType<typeof treeAccess>>;
  body(doc: Document): Element;
  ownerDocument(node: Node): Document | null;
  firstChild(node: Node): Node | null;
  nextSibling(node: Node): Node | null;
  cloneShallow(node: Node): Node;
  append(parent: Node, child: Node): void;
  remove(parent: Node, child: Node): void;
  fragment(doc: Document): DocumentFragment;
  element(doc: Document, name: string): Element;
  textNode(doc: Document, text: string): Text;
  walker(doc: Document, root: Node): TreeWalker;
}

let rawTree: RawTree | undefined;
function rawAccess(): RawTree {
  if (rawTree) return rawTree;
  const read = treeAccess();
  if (!read) throw new Error("no DOM to sanitize mail with");
  const getter = (prototype: object, name: string): ((this: unknown) => unknown) => {
    for (let at: object | null = prototype; at; at = Object.getPrototypeOf(at)) {
      const descriptor = Object.getOwnPropertyDescriptor(at, name);
      if (descriptor?.get) return descriptor.get;
    }
    throw new Error(`no ${name} to sanitize mail with`);
  };
  const body = getter(Document.prototype, "body");
  const ownerDocument = getter(Node.prototype, "ownerDocument");
  const firstChild = getter(Node.prototype, "firstChild");
  const nextSibling = getter(Node.prototype, "nextSibling");
  const { cloneNode, appendChild, removeChild } = Node.prototype;
  const { createDocumentFragment, createElement, createTextNode, createTreeWalker } = Document.prototype;
  rawTree = {
    read,
    body: (doc) => body.call(doc) as Element,
    ownerDocument: (node) => (ownerDocument.call(node) as Document | null) ?? null,
    firstChild: (node) => (firstChild.call(node) as Node | null) ?? null,
    nextSibling: (node) => (nextSibling.call(node) as Node | null) ?? null,
    cloneShallow: (node) => cloneNode.call(node, false),
    append: (parent, child) => void appendChild.call(parent, child),
    remove: (parent, child) => void removeChild.call(parent, child),
    fragment: (doc) => createDocumentFragment.call(doc),
    element: (doc, name) => createElement.call(doc, name),
    textNode: (doc, text) => createTextNode.call(doc, text),
    walker: (doc, root) => createTreeWalker.call(doc, root, 4 /* NodeFilter.SHOW_TEXT */),
  };
  return rawTree;
}

/** Whether words stand anywhere inside an element of the tree being sanitized (`ShapeAccess.holdsText`). */
function holdsText(node: Node): boolean {
  const tree = rawAccess();
  const doc = tree.ownerDocument(node);
  if (!doc) return true;
  const walker = tree.walker(doc, node);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const parent = tree.read.parentNode(text);
    if (!NO_WORD.test(tree.read.text(text)) && !NOT_WORDS.has(parent ? tree.read.nodeName(parent).toUpperCase() : "")) return true;
  }
  return false;
}

/** Elements one call of the sanitizer takes at most: a step of the pass. */
const BATCH = 150;

/** The sanitizer's settings, for every step of every pass. */
const PURIFY = {
  // <style> blocks can url()-fetch; forms/meta/base have no business in
  // a read-only viewer. A canvas shows its inner text only where scripts
  // do not run, a marquee moves its words off the screen, and an option
  // outside a list is drawn by one engine and not by another: their words
  // stand as plain text.
  FORBID_TAGS: ["style", "link", "form", "input", "button", "select", "textarea", "meta", "base", "canvas", "marquee", "option", "optgroup"],
  USE_PROFILES: { html: true },
  ALLOWED_URI_REGEXP: MAIL_ALLOWED_URI,
  FORBID_ATTR: ["class"],
  ALLOW_DATA_ATTR: false,
  // Each step is sanitized where it stands, in the tree the pass parsed: no copy into a document of its own.
  IN_PLACE: true,
};

/** The number of elements of each element's subtree, the element counted. */
function subtreeSizes(tree: RawTree, root: Node): Map<Node, number> {
  const sizes = new Map<Node, number>();
  const order: Node[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const element = stack.pop()!;
    order.push(element);
    for (let child = tree.firstChild(element); child; child = tree.nextSibling(child)) if (tree.read.nodeType(child) === 1) stack.push(child);
  }
  for (let index = order.length - 1; index >= 0; index--) {
    const element = order[index];
    let size = 1;
    for (let child = tree.firstChild(element); child; child = tree.nextSibling(child)) size += sizes.get(child) ?? 0;
    sizes.set(element, size);
  }
  return sizes;
}

/**
 * The pass over a mail, in steps (round 5): the mail is parsed once, in the
 * mode the reader's frame is (`<!doctype html>`; without a doctype the parser
 * reads by the old rules, and `<p><table>` nests the table in the paragraph
 * there but not in the frame), and the sanitizer takes it in document order,
 * at most `BATCH` elements a call. A subtree larger than that goes first on
 * its own — the element, sanitized and shaped as it stands — and its children
 * after it, each with the state of the element they stand in. The reader and
 * the assistant run the same steps; only the assistant, reading in the
 * background, lets the interface in between (`mailHtmlViewSoon`).
 */
function* passSteps(mail: string): Generator<void, Pass, void> {
  const tree = rawAccess();
  const read = tree.read;
  /** Fetches held back in either view, and https pictures the opt-in lets load. */
  let blockedRemote = 0;
  let pictures = 0;
  let paints = false;
  /** What the mail wrote in the attributes the shaper gives anew, per element. */
  const written = new WeakMap<Node, Map<string, string>>();
  /** Images whose picture was held back. */
  const heldBack = new WeakSet<Node>();
  const states = new WeakMap<Node, ShapeState>();
  /** Whether words stand inside an element that goes on its own, read off the whole subtree before. */
  const holdsWords = new WeakMap<Node, boolean>();
  /** The mark carrying that answer to the sanitized copy: a name no mail can know. */
  const mark = `data-pv${Math.random().toString(36).slice(2)}`;
  /** The state of the element a step's top elements stand in, and the box that holds a step while it is sanitized. */
  let stepParent: ShapeState | null = null;
  let holder: Node | null = null;
  const shaper = new MailShaper<Node>({
    written: (node) => written.get(node),
    // Only what changes is written: setting a style makes the engine read it again.
    give: (node, name, value) => {
      const now = read.attribute(node, name);
      if (value === null) {
        if (now !== null) read.removeAttribute(node, name);
      } else if (now !== value) read.setAttribute(node, name, value);
    },
    // A subtree that goes in steps is not whole when its element is shaped: whether it holds words is read beforehand.
    holdsText: (node) => holdsWords.get(node) ?? holdsText(node),
  });

  const record = (node: Node, name: string, value: string): void => {
    let attrs = written.get(node);
    if (!attrs) written.set(node, (attrs = new Map()));
    attrs.set(name, value);
  };

  const onAttribute = (node: unknown, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue ?? "";
    const element = node as Node;
    if (name === mark) {
      holdsWords.set(element, value === "1");
      data.keepAttr = false;
      return;
    }
    const tag = (): string => read.nodeName(element).toLowerCase();
    if (FETCHING_ATTRS.has(name)) {
      // Only self-contained data: images may load; everything else is a
      // network fetch (tracking) or a foreign scheme — cut and count.
      if (name === "src" && DATA_IMAGE.test(value)) return;
      // Opt-in: https images on actual <img> elements (never srcset/poster/
      // background, never other schemes — the frame CSP mirrors this). The
      // address stays in the tree; the view without pictures leaves it out.
      if (name === "src" && HTTPS_URL.test(value) && tag() === "img") {
        heldBack.add(element);
        pictures++;
        return;
      }
      if (name === "src" && value.trim() !== "" && tag() === "img") heldBack.add(element);
      // A background picture that is not shown: the colours set on it go with it (`MailShaper`).
      if (name === "background") record(element, name, value);
      blockedRemote++;
      data.keepAttr = false;
      return;
    }
    // href is KEPT: DOMPurify's default URI policy already drops javascript:/
    // data: and other unsafe schemes, leaving safe http/https/mailto/tel links.
    // Opening is handled by the reader (MailView.handleFrameLoad routes a click
    // to the system browser) — no target/rel rewriting needed here.
    if (name === "style" && /url\s*\(/i.test(value)) {
      // css url() is a fetch too (background-image tracking pixels et al.); it is never kept.
      blockedRemote++;
    }
    if (SHAPED_ATTRS.has(name) || (name === "color" && tag() === "font")) {
      // Given anew by the shaper, from what the mail wrote (`MailShaper`).
      record(element, name, value);
      if (name === "style") {
        // The style stays in the meantime as the list keeps it — most often
        // that is what the shaper gives, and the engine reads it once.
        const kept = keptMailStyle(value);
        if (kept) data.attrValue = kept;
        else data.keepAttr = false;
      } else data.keepAttr = false;
    }
  };
  const root = shaper.root();
  const afterAttributes = (node: Node) => {
    if (read.nodeType(node) !== 1) return;
    // The box that holds a step is not the mail's: what stands in it stands in the element the step goes into.
    if (node === holder) {
      states.set(node, stepParent ?? root);
      return;
    }
    const parent = read.parentNode(node);
    const above = (parent && states.get(parent)) || stepParent || root;
    states.set(node, shaper.element(node, read.nodeName(node).toLowerCase(), above));
    // Whether the mail paints itself, read off the tree as `mailHtmlPaintsItself` reads the markup.
    if (!paints) {
      const style = read.attribute(node, "style");
      paints =
        (style !== null && PAINTS_IN_STYLE.test(style)) ||
        read.attribute(node, "bgcolor") !== null ||
        read.attribute(node, "background") !== null ||
        (read.nodeName(node).toLowerCase() === "font" && read.attribute(node, "color") !== null);
    }
  };

  const dp = createDOMPurify(window);
  dp.setConfig(PURIFY);
  dp.addHook("uponSanitizeAttribute", onAttribute);
  dp.addHook("afterSanitizeAttributes", afterAttributes);

  const doc = new DOMParser().parseFromString(`<!doctype html>${mail}`, "text/html");
  const docBody = tree.body(doc);
  yield;
  const sizes = subtreeSizes(tree, docBody);
  yield;
  /**
   * Sanitizes `input` (a node or a run of siblings) as the content of the
   * element whose state is `parent`, in a box of its own; what the sanitizer
   * leaves stands in that box.
   */
  const sanitize = (input: Node, parent: ShapeState | null): Node => {
    const box = tree.element(doc, "div");
    tree.append(box, input);
    stepParent = parent;
    holder = box;
    try {
      dp.sanitize(box, PURIFY);
    } finally {
      stepParent = null;
      holder = null;
    }
    return box;
  };
  /** One element on its own, without its children: its sanitized copy, or whether its content stays in its place. */
  const PROBE = "\u0001";
  const isProbe = (node: Node | null): node is Text => node !== null && read.nodeType(node) === 3 && read.text(node) === PROBE;
  const alone = (element: Node, parent: ShapeState | null): { copy: Node | null; contentStays: boolean } => {
    const shallow = tree.cloneShallow(element);
    read.setAttribute(shallow, mark, holdsText(element) ? "1" : "0");
    // A word of its own shows whether the sanitizer keeps the content of an element it takes away.
    tree.append(shallow, tree.textNode(doc, PROBE));
    const out = sanitize(shallow, parent);
    let copy: Node | null = null;
    let contentStays = false;
    for (let child = tree.firstChild(out); child; child = tree.nextSibling(child)) {
      if (read.nodeType(child) === 1) copy = child;
      else if (isProbe(child)) contentStays = true;
    }
    const probe = copy ? tree.firstChild(copy) : null;
    if (copy && isProbe(probe)) tree.remove(copy, probe);
    return { copy, contentStays };
  };

  // The page first: it is the walk's root, which the sanitizer never takes away.
  const page = tree.cloneShallow(docBody);
  stepParent = null;
  dp.sanitize(page, PURIFY);
  const body: Node | null = page;
  yield;
  /** Runs of siblings still to go, each into the element it stands in. */
  const frames: Array<{ into: Node; nodes: Node[]; at: number }> = [{ into: page, nodes: Array.from(read.childNodes(docBody)), at: 0 }];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.at >= frame.nodes.length) {
      frames.pop();
      continue;
    }
    const parent = states.get(frame.into) ?? root;
    const first = frame.nodes[frame.at];
    if ((sizes.get(first) ?? 0) > BATCH) {
      // Too large for one step: the element, then its children.
      frame.at++;
      const { copy, contentStays } = alone(first, parent);
      if (copy) tree.append(frame.into, copy);
      if (copy || contentStays) frames.push({ into: copy ?? frame.into, nodes: Array.from(read.childNodes(first)), at: 0 });
      yield;
      continue;
    }
    // A run of siblings that fits one step.
    const run = tree.fragment(doc);
    let count = 0;
    while (frame.at < frame.nodes.length) {
      const node = frame.nodes[frame.at];
      const size = sizes.get(node) ?? 0;
      if (size > BATCH || (count > 0 && count + size > BATCH)) break;
      tree.append(run, node);
      count += size;
      frame.at++;
    }
    const out = sanitize(run, parent);
    for (let child = tree.firstChild(out); child; child = tree.firstChild(out)) tree.append(frame.into, child);
    yield;
  }
  const reader = domReader(read, heldBack);
  /** The markup with the addresses of the pictures, and without them. */
  const markup = (withPictures: boolean): string => {
    if (!body) return "";
    if (withPictures || pictures === 0) return read.innerHTML(body);
    const taken: Array<[Node, string]> = [];
    const walk = (node: Node): void => {
      const children = read.childNodes(node);
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (read.nodeType(child) !== 1) continue;
        if (heldBack.has(child)) {
          const src = read.attribute(child, "src");
          if (src !== null) {
            taken.push([child, src]);
            read.removeAttribute(child, "src");
          }
        }
        walk(child);
      }
    };
    walk(body);
    try {
      return read.innerHTML(body);
    } finally {
      for (const [node, src] of taken) read.setAttribute(node, "src", src);
    }
  };
  let document: VisibleDocument | undefined;
  let shows: boolean | undefined;
  const view = (withPictures: boolean): MailHtmlView => {
    let html: string | undefined;
    const shown = () => (html ??= markup(withPictures));
    // Colours are compared where the reader paints the mail on its white sheet;
    // a mail that sets none reads in the theme's colours, all of them readable.
    const canvas = () => (paints ? WHITE_SHEET : null);
    return {
      get html() {
        return shown();
      },
      blockedRemote: blockedRemote + (withPictures ? 0 : pictures),
      // One reading for both views, the one without pictures: a picture that
      // may not show makes no link visible, so the assistant reads no more than either shows.
      document: () => (document ??= body ? visibleDocumentOf(body, reader, { canvas: canvas() }) : NOTHING),
      shows: () => (shows ??= document ? document.shows : body ? visibleDocumentOf(body, reader, { canvas: canvas(), untilShown: true }).shows : false),
    };
  };
  function* readSteps(): Generator<void, void, void> {
    if (document || !body) return;
    const read = visibleDocumentSteps(body, reader, { canvas: paints ? WHITE_SHEET : null });
    let next = read.next();
    while (!next.done) {
      yield;
      next = read.next();
    }
    document ??= next.value;
  }
  return { withPictures: view(true), withoutPictures: view(false), readSteps };
}

/**
 * The reading canvas of the app's theme, for a mail that paints nothing itself
 * (finding X3, review 2026-11-10). Plain colour values: the frame is its own
 * document, where the app's custom properties do not resolve.
 */
export interface MailCanvas {
  text: string;
  background: string;
  link: string;
  /** Whether the canvas is dark, so scrollbars and controls follow it. */
  dark: boolean;
}

/** A colour in a style, as `mailHtmlPaintsItself` finds one in the markup. */
const PAINTS_IN_STYLE = /\b(background|color)\b[^:;"']*:/i;

/** A colour value as computed styles report it — nothing that could close the rule. */
const SAFE_COLOUR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([0-9a-z.,%\s/+-]*\)|[a-z]+)$/i;

/**
 * Whether a sanitized mail sets colours of its own: a background or a text
 * colour in a `style`, a `bgcolor`/`background` attribute or a `<font color>`.
 *
 * Such a mail is designed against a light page (dark text, a white or coloured
 * table), and a dark canvas would leave its text unreadable — it keeps the
 * white sheet every mail client gives it. A mail that sets nothing is text
 * with markup, and that reads in the app's own colours, exactly like a
 * plain-text mail. Conservative on purpose: any colour at all counts.
 * `<style>` blocks never reach this point (the sanitizer removes them).
 */
export function mailHtmlPaintsItself(sanitizedHtml: string): boolean {
  if (/<[a-z][^>]*\s(bgcolor|background)\s*=/i.test(sanitizedHtml)) return true;
  if (/<font\b[^>]*\scolor\s*=/i.test(sanitizedHtml)) return true;
  return /\sstyle\s*=\s*("[^"]*|'[^']*)\b(background|color)\b[^:;"']*:/i.test(sanitizedHtml);
}

export interface MailFrameOptions extends SanitizeEmailOptions {
  /**
   * The app theme's reading canvas. Used only for a mail that paints nothing
   * itself; without it, or for a mail that does, the frame is the white sheet.
   */
  canvas?: MailCanvas | null;
}

/** The colours of the frame's body: the theme's canvas where it may, else the white sheet. */
export function mailCanvasRules(canvas: MailCanvas | null | undefined, sanitizedHtml: string): string {
  const white = "body{color:#222;background:#fff}";
  if (!canvas || mailHtmlPaintsItself(sanitizedHtml)) return white;
  const text = canvas.text.trim();
  const background = canvas.background.trim();
  const link = canvas.link.trim();
  if (![text, background, link].every((value) => SAFE_COLOUR.test(value))) return white;
  return `:root{color-scheme:${canvas.dark ? "dark" : "light"}}body{color:${text};background:${background}}a{color:${link}}`;
}

/** Full srcdoc for the sandboxed iframe: hardened CSP + readable defaults.
 * With the remote-image opt-in the CSP widens img-src to https: — exactly
 * mirroring what the sanitizer lets through; everything else stays 'none'.
 *
 * The color/font-size literals in the embedded <style> are a documented
 * design-token exception, not an oversight: this string becomes the iframe's
 * OWN document via srcdoc, a separate CSS scope that never inherits the
 * parent app's :root custom properties (var(--bg-primary) etc. would simply
 * fail to resolve here) — so there is no app token to reference. A mail that
 * sets colours of its own gets a fixed reading canvas (dark text on white),
 * as in any mail client's message pane. A mail that sets none gets the app
 * theme's canvas when the host passes one (`options.canvas`, read from the
 * theme by `readMailCanvas`): in the dark design it used to be a white sheet
 * as well, although nothing in it asked for one (finding X3). */
export function buildMailFrameDoc(sanitizedHtml: string, options?: MailFrameOptions): string {
  const imgSrc = options?.allowRemoteImages ? "data: https:" : "data:";
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'">` +
    // Never leak the referrer if a link ever does navigate.
    `<meta name="referrer" content="no-referrer">` +
    `<style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;margin:12px;word-break:break-word}` +
    mailCanvasRules(options?.canvas, sanitizedHtml) +
    // -webkit-touch-callout: a held link shows the APP's sheet with its target
    // (mailLinks.ts), not the system's link preview — which would load the page.
    // A line that runs past the frame stays as the mail sets it: the frame scrolls to it (`frameFit.ts`).
    `img{max-width:100%;height:auto}table{max-width:100%}a{text-decoration:underline;cursor:pointer;-webkit-touch-callout:none}</style>` +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}
