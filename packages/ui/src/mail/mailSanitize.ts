import createDOMPurify from "dompurify";
import { keptMailStyle, MailShaper, ownsLineHeight, visibleDocumentOf, WHITE_SHEET, type MarkupReader, type ShapeState, type VisibleDocument } from "@plainva/core";
import { blanked, engineHiddenWords, engineWidths, type EngineHidden } from "./engineVisibility";
import { domReader, treeAccess, type TreeAccess } from "./mailTree";

// The package's default export is a FACTORY in module environments — bind it
// lazily to the window (desktop + jsdom tests both have one at call time).
let purifierInstance: ReturnType<typeof createDOMPurify> | null = null;
function purifier(): ReturnType<typeof createDOMPurify> {
  purifierInstance ??= createDOMPurify(window);
  return purifierInstance;
}

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
  /**
   * What the reader shows, judged by the engine of this device as well (plan Umsetzung 0.9.x, B7; F23): `document()`
   * without the words that lie where no person sees them only because of where other boxes lie — run out of their box
   * and painted over, or off the frame's edge (`engineVisibility.ts`). The assistant reads this. Where there is no
   * engine to ask (a test runner's DOM), `document()`.
   */
  engineDocument(widths?: readonly number[]): Promise<VisibleDocument>;
  /**
   * Set where the pass could not make the HTML part safe — it threw, or the
   * parse left no body (a `<frameset>`): nothing of the part is given to
   * anyone, the readers show a sentence instead (`mailBodyView`).
   */
  unreadable?: true;
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
 * Throws where there is no DOM, or where the sanitizer or the shaper throws.
 */
export function mailHtmlView(raw: string, options?: SanitizeEmailOptions): MailHtmlView {
  let pass = PASSES.get(raw);
  if (pass) PASSES.delete(raw);
  else pass = makePass(raw);
  PASSES.set(raw, pass);
  while (PASSES.size > PASSES_MAX) PASSES.delete(PASSES.keys().next().value as string);
  return options?.allowRemoteImages === true ? pass.withPictures : pass.withoutPictures;
}

/** One pass over a mail and its two views. */
interface Pass {
  withPictures: MailHtmlView;
  withoutPictures: MailHtmlView;
}

/** Elements whose text a reader never shows as words of the mail (the sanitizer takes most of them away). */
const NOT_WORDS = new Set(["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE", "TITLE", "XMP", "NOEMBED", "NOFRAMES", "IFRAME"]);
/** Blanks, no-break spaces and the characters of no width: a spacer cell's `&nbsp;` is no word. */
const NO_WORD = /^[\s\u200b-\u200d\u2060\u00ad]*$/;

/** Whether words stand anywhere inside an element of the tree being sanitized (`ShapeAccess.holdsText`). */
function holdsText(node: Node): boolean {
  const doc = node.ownerDocument;
  if (!doc) return true;
  const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!NO_WORD.test((text as Text).data) && !NOT_WORDS.has(text.parentNode?.nodeName.toUpperCase() ?? "")) return true;
  }
  return false;
}

/** Whether a word inside an element takes its line height from it (`ShapeAccess.lendsLine`): one not inside a box with a line height of its own. */
function lendsLine(node: Node): boolean {
  const doc = node.ownerDocument;
  // The tree is read past what the mail named its elements (`form name="parentNode"`).
  const view = doc?.defaultView ?? (typeof window === "undefined" ? null : window);
  const PARENT = view ? Object.getOwnPropertyDescriptor(view.Node.prototype, "parentNode")?.get : undefined;
  const ATTRIBUTE = view?.Element.prototype.getAttribute;
  if (!doc || !PARENT || !ATTRIBUTE) return true;
  const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const up = PARENT.call(text) as Node | null;
    if (NO_WORD.test((text as Text).data) || NOT_WORDS.has(up?.nodeName.toUpperCase() ?? "")) continue;
    let own = false;
    for (let at = up; at && at !== node; at = PARENT.call(at) as Node | null) {
      if (at.nodeType === 1 && ownsLineHeight(ATTRIBUTE.call(at as Element, "style") ?? "")) {
        own = true;
        break;
      }
    }
    if (!own) return true;
  }
  return false;
}

function makePass(raw: string): Pass {
  const read = treeAccess();
  if (!read) throw new Error("no DOM to sanitize mail with");
  /** Fetches held back in either view, and https pictures the opt-in lets load. */
  let blockedRemote = 0;
  let pictures = 0;
  let paints = false;
  /** What the mail wrote in the attributes the shaper gives anew, per element. */
  const written = new WeakMap<Node, Map<string, string>>();
  /** Images whose picture was held back. */
  const heldBack = new WeakSet<Node>();
  const states = new WeakMap<Node, ShapeState>();
  const shaper = new MailShaper<Node>({
    written: (node) => written.get(node),
    // Only what changes is written: setting a style makes the engine read it again.
    give: (node, name, value) => {
      const now = read.attribute(node, name);
      if (value === null) {
        if (now !== null) read.removeAttribute(node, name);
      } else if (now !== value) read.setAttribute(node, name, value);
    },
    holdsText,
    lendsLine,
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
    const parent = read.parentNode(node);
    const above = (parent && states.get(parent)) || root;
    states.set(node, shaper.element(node, read.nodeName(node).toLowerCase(), above));
    // Whether the mail paints itself, read off the tree as `mailHtmlPaintsItself` reads the markup.
    if (!paints) {
      const style = read.attribute(node, "style");
      paints =
        (style !== null && paintsInStyle(style)) ||
        read.attribute(node, "bgcolor") !== null ||
        read.attribute(node, "background") !== null ||
        (read.nodeName(node).toLowerCase() === "font" && read.attribute(node, "color") !== null);
    }
  };

  const dp = purifier();
  dp.addHook("uponSanitizeAttribute", onAttribute);
  dp.addHook("afterSanitizeAttributes", afterAttributes);
  let body: Node | null;
  try {
    // Read in the mode the reader's frame is (`<!doctype html>`): without a
    // doctype the parser reads by the old rules, and `<p><table>` nests the
    // table in the paragraph there but not in the frame (review of 2026-11-17).
    body = dp.sanitize(`<!doctype html>${raw}`, {
      // <style> blocks can url()-fetch; forms/meta/base have no business in
      // a read-only viewer. A canvas shows its inner text only where scripts
      // do not run, a marquee moves its words off the screen, and an option
      // outside a list is drawn by one engine and not by another: their words
      // stand as plain text.
      FORBID_TAGS: ["style", "link", "form", "input", "button", "select", "textarea", "meta", "base", "canvas", "marquee", "option", "optgroup"],
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP: MAIL_ALLOWED_URI,
      RETURN_DOM: true,
      FORBID_ATTR: ["class"],
      ALLOW_DATA_ATTR: false,
    }) as Node | null;
  } finally {
    dp.removeHook("uponSanitizeAttribute");
    dp.removeHook("afterSanitizeAttributes");
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
  /** The engine's readings, per set of widths (the readers' by default). */
  const engine = new Map<string, Promise<VisibleDocument>>();
  const view = (withPictures: boolean): MailHtmlView => {
    let html: string | undefined;
    const shown = () => (html ??= markup(withPictures));
    // Colours are compared where the reader paints the mail on its white sheet;
    // a mail that sets none reads in the theme's colours, all of them readable.
    const canvas = () => (paints ? WHITE_SHEET : null);
    return {
      ...(body ? {} : { unreadable: true as const }),
      get html() {
        return shown();
      },
      blockedRemote: blockedRemote + (withPictures ? 0 : pictures),
      // One reading for both views, the one without pictures: a picture that
      // may not show makes no link visible, so the assistant reads no more than either shows.
      document: () => (document ??= body ? visibleDocumentOf(body, reader, { canvas: canvas() }) : { text: "", links: [], shows: false }),
      // One reading for both views too: the one without pictures, laid out as its frame is (F23).
      engineDocument: (widths = engineWidths()) => {
        const key = widths.join(",");
        let reading = engine.get(key);
        if (!reading) {
          reading = (async () => {
            const walked = (document ??= body ? visibleDocumentOf(body, reader, { canvas: canvas() }) : { text: "", links: [], shows: false });
            if (!body || !walked.shows) return walked;
            // Throws where the engine cannot finish: the caller reads nothing then (fail closed). `null` only where
            // there is no layout engine at all (a test runner), and the walk's reading stands.
            const hidden = await engineHiddenWords(buildMailFrameDoc(markup(false), { canvas: null }), widths);
            if (!hidden || hidden.parents.size === 0) return walked;
            return visibleDocumentOf(body, withoutHiddenWords(read, reader, body, hidden), { canvas: canvas() });
          })();
          engine.set(key, reading);
        }
        return reading;
      },
      shows: () => (shows ??= document ? document.shows : body ? visibleDocumentOf(body, reader, { canvas: canvas(), untilShown: true }).shows : false),
    };
  };
  return { withPictures: view(true), withoutPictures: view(false) };
}

/**
 * The walk's reader of the sanitized tree, with the words the engine hides blanked (F23). A text is found in the
 * engine's answer by its parent's path from the body and where it starts in that parent's own text — the frame was
 * parsed from this tree's markup, so the paths are the same; two texts side by side here are one there, and their
 * parent's own text is the same. Where it is not the same, all of that parent's own words count as hidden: in doubt,
 * the assistant reads less, never what nobody saw.
 */
function withoutHiddenWords(read: TreeAccess, reader: MarkupReader<Node>, body: Node, hidden: EngineHidden): MarkupReader<Node> {
  const paths = new Map<Node, string | null>();
  const pathOf = (element: Node): string | null => {
    if (element === body) return "";
    const known = paths.get(element);
    if (known !== undefined) return known;
    const parent = read.parentNode(element);
    let path: string | null = null;
    if (parent) {
      const above = pathOf(parent);
      if (above !== null) {
        let index = 0;
        const siblings = read.childNodes(parent);
        for (let i = 0; i < siblings.length && siblings[i] !== element; i++) if (read.nodeType(siblings[i]!) === 1) index++;
        path = above === "" ? String(index) : `${above}/${index}`;
      }
    }
    paths.set(element, path);
    return path;
  };
  /** Per parent: its own text, and where each of its texts starts in it. */
  const owns = new Map<Node, { text: string; starts: Map<Node, number> }>();
  const ownOf = (parent: Node) => {
    let own = owns.get(parent);
    if (!own) {
      let text = "";
      const starts = new Map<Node, number>();
      const children = read.childNodes(parent);
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        if (read.nodeType(child) !== 3) continue;
        starts.set(child, text.length);
        text += read.text(child);
      }
      owns.set(parent, (own = { text, starts }));
    }
    return own;
  };
  return {
    kind: (node) => reader.kind(node),
    children: (node) => reader.children(node),
    attribute: (node, name) => reader.attribute(node, name),
    ...(reader.heldBack ? { heldBack: (node: Node) => reader.heldBack!(node) } : {}),
    text: (node) => {
      const text = reader.text(node);
      const parent = read.parentNode(node);
      const path = parent ? pathOf(parent) : null;
      const entry = path === null ? undefined : hidden.parents.get(path);
      if (!entry || !parent) return text;
      const own = ownOf(parent);
      // Not the tree the frame laid out: every own word of this parent counts as hidden.
      if (entry.text !== own.text) return " ".repeat(text.length);
      return blanked(text, entry.hidden, own.starts.get(node) ?? 0);
    },
  };
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

/**
 * Whether a style names a colour, as `mailHtmlPaintsItself` finds one in the markup: `background` or `color` as a word
 * before a `:` that no `;` or quote stands between — what `/\b(background|color)\b[^:;"']*:/i` matches. Read once,
 * stretch by stretch between those marks: the expression read the rest of the stretch again from every `color` in it,
 * quadratic in a long style (code scanning, js/polynomial-redos).
 */
function paintsInStyle(style: string): boolean {
  let from = 0;
  for (let at = 0; at < style.length; at++) {
    const mark = style[at];
    if (mark !== ":" && mark !== ";" && mark !== '"' && mark !== "'") continue;
    if (mark === ":" && COLOUR_WORD.test(style.slice(from, at))) return true;
    from = at + 1;
  }
  return false;
}
const COLOUR_WORD = /\b(?:background|color)\b/i;

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
  // What `/<[a-z][^>]*\s(bgcolor|background)\s*=/i` and `/<font\b[^>]*\scolor\s*=/i` match, read once: a match
  // never crosses a `>`, so each stretch between two is looked at from the first tag opening in it. The expressions
  // read the rest of the stretch again from every `<a` in it (code scanning, js/polynomial-redos).
  for (const stretch of sanitizedHtml.split(">")) {
    const tag = stretch.search(/<[a-z]/i);
    if (tag < 0) continue;
    if (/\s(?:bgcolor|background)\s*=/i.test(stretch.slice(tag + 2))) return true;
    const font = stretch.search(/<font\b/i);
    if (font >= 0 && /\scolor\s*=/i.test(stretch.slice(font + 5))) return true;
  }
  // A `style` attribute's value, up to its closing quote (or the end), that names a colour.
  const styles = /\sstyle\s*=\s*(["'])/gi;
  for (let found = styles.exec(sanitizedHtml); found; found = styles.exec(sanitizedHtml)) {
    const start = found.index + found[0].length;
    const close = sanitizedHtml.indexOf(found[1]!, start);
    if (paintsInStyle(sanitizedHtml.slice(start, close < 0 ? sanitizedHtml.length : close))) return true;
  }
  return false;
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
