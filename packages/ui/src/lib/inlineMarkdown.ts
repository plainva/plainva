import { bracketLinkMatcher, findInlineTags, nextWhere, readHtmlCheckbox, trimEndChars, wikiLinkMatcher } from "@plainva/core";
import { tagSegments } from "../base/propertyModel";
import { splitLinkAnchor } from "./linkAnchor";
import { tagColorAttrs } from "./tagColor";
/**
 * Minimal inline-markdown renderer for widget content (P4, 2026-07-05).
 *
 * The live-preview table widget shows cell content as plain text; this module
 * parses the inline subset (bold/italic/strikethrough/code/==highlight==,
 * wiki links, markdown links, bare URLs, <br>, backslash escapes) into a
 * token tree and renders it via DOM APIs — never innerHTML, so arbitrary HTML
 * in a cell stays inert literal text. The parser is pure (unit-testable in
 * node); only `renderInlineMarkdown` touches the DOM.
 */

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "br" }
  /** An `<input type="checkbox">` written as HTML — the only way to put a box in a table cell. */
  | { kind: "checkbox"; checked: boolean }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "strongEm" | "strike" | "highlight"; children: InlineNode[] }
  | { kind: "wikiLink"; target: string; display: string; anchor?: string }
  | { kind: "link"; href: string; label: string; external: boolean }
  | { kind: "url"; href: string };

export interface InlineLinkHandlers {
  /**
   * Open a note by wiki target / vault-relative path (newTab on Ctrl/Cmd).
   * `kind` says how the link was written: a wiki link names a note and is
   * resolved by the link rule alone, a Markdown link names a path. `fromPath`
   * is the note the link stands in, where the surface that draws it knows —
   * the rule reads a link from that note's folder.
   */
  onOpenNote?: (target: string, newTab: boolean, kind?: "wiki" | "markdown", fromPath?: string) => void;
  /** Open an external http(s) URL in the system browser. */
  onOpenUrl?: (url: string) => void;
  /** Open the notes that carry a tag - a click on a tag pill (finding 2026-09-19). */
  onOpenTag?: (tag: string) => void;
}

// The token grammar, one alternative per line. Order matters: at every
// position they are tried top to bottom and the first that matches is the
// token — escapes and comments first, *** before ** before *, __ before _.
// Case-insensitivity (the old pattern's `i` flag) is only relevant for
// <br>/<input>/https.
//
//   \\[\\`*_~=[\]()<>|#+.!{}-]    backslash escape
//   <!--[\s\S]*?-->                HTML comment (hidden, like the read view)
//   <br\s*\/?>                     <br>, <br/>, <br />
//   <input\b[^>]*>                 <input type="checkbox">
//   `[^`\n]+`                      inline code
//   !?\[\[[^\]\n]+?\]\]            wiki link (embed "!" tolerated)
//   !?\[[^\]\n]*?\]\([^)\n]+?\)    markdown link (image "!" tolerated)
//   https?:\/\/[^\s<>]+            bare URL
//   \*\*\*[^\n]+?\*\*\*            bold italic
//   \*\*[^\n]+?\*\*                bold
//   \*[^*\n]+\*                    italic (*)
//   __[^\n]+?__                    bold (__)
//   _[^_\n]+_                      italic (_), intraword guarded below
//   ~~[^\n]+?~~                    strikethrough
//   ==[^=\n]+?==                   ==highlight==
//
// GFM has no spelling for a task box inside a table cell, so people write the
// HTML tag there and Obsidian draws it (finding 2026-09-22). Exactly this one
// element with exactly these two attributes; `readHtmlCheckbox` decides, so
// the renderer and the writer never disagree.
//
// The grammar used to be one combined pattern, which looked for each closer
// again from every opener: a cell with a long run of `[` or `*` and no closer
// behind it took quadratic time (plan Befunde 24.09., E6). `tokenSpans` reads
// it by hand instead, alternative for alternative; every alternative asks its
// own cursor for its closer, and a cursor reads each character once.

const ESCAPABLE = "\\`*_~=[]()<>|#+.!{}-";
const SPACE = /\s/;
const WORD = /[A-Za-z0-9_]/;
const URL_TRAILING_PUNCT = ").,;:!?\"'";
const MAX_DEPTH = 4;

/** `word` (lowercase ASCII letters) at `at` in any case — what the `i` flag folded, and nothing else. */
function spells(text: string, at: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) if ((text.charCodeAt(at + k) | 0x20) !== word.charCodeAt(k)) return false;
  return true;
}

/** Every token of `text`, left to right, as `[index, end)`. */
function* tokenSpans(text: string): Generator<{ index: number; end: number }> {
  const n = text.length;
  const next = (hit: (i: number) => boolean) => nextWhere(n, hit);
  const seq = (s: string) => next((i) => text.startsWith(s, i));
  const either = (a: string, b: string) => next((i) => text[i] === a || text[i] === b);
  const commentEnd = seq("-->");
  const inputEnd = next((i) => text[i] === ">");
  const codeEnd = either("`", "\n");
  const wikiAt = wikiLinkMatcher(text, { bang: true, innerStops: "\n" });
  const linkAt = bracketLinkMatcher(text, { bang: true, labelStops: "\n", destinationStops: "\n", destinationMin: 1 });
  const lineEnd = next((i) => text[i] === "\n");
  const boldItalicEnd = seq("***");
  const boldEnd = seq("**");
  const italicEnd = either("*", "\n");
  const underBoldEnd = seq("__");
  const underItalicEnd = either("_", "\n");
  const strikeEnd = seq("~~");
  const highlightEnd = either("=", "\n");

  /**
   * `open[^\n]+?close` with `close` as long as `open`: the first closer at
   * least one character in, before the line ends. The opener holds no line
   * break, so the line ending after it is the one ending at `at`.
   */
  const lazyToCloser = (at: number, length: number, closer: (from: number) => number): number => {
    const close = closer(at + length + 1);
    return close < lineEnd(at) ? close + length : -1;
  };
  /** `open[^open\n]+open` for a one-character marker: the first marker or line break decides. */
  const runToMarker = (at: number, stop: (from: number) => number): number => {
    const close = stop(at + 1);
    return close > at + 1 && text[close] === text[at] ? close + 1 : -1;
  };

  const tokenEnd = (at: number): number => {
    switch (text[at]) {
      case "\\":
        return at + 1 < n && ESCAPABLE.includes(text[at + 1]) ? at + 2 : -1;
      case "<": {
        if (text.startsWith("<!--", at)) {
          const close = commentEnd(at + 4);
          if (close < n) return close + 3;
        }
        if (spells(text, at + 1, "br")) {
          let end = at + 3;
          while (end < n && SPACE.test(text[end])) end++;
          if (text[end] === "/" && text[end + 1] === ">") return end + 2;
          if (text[end] === ">") return end + 1;
        }
        if (spells(text, at + 1, "input") && !(at + 6 < n && WORD.test(text[at + 6]))) {
          const close = inputEnd(at + 6);
          if (close < n) return close + 1;
        }
        return -1;
      }
      case "`":
        return runToMarker(at, codeEnd);
      case "!":
      case "[":
        return (wikiAt(at) ?? linkAt(at))?.end ?? -1;
      case "h":
      case "H": {
        if (!spells(text, at, "http")) return -1;
        let scheme = at + 4;
        if ((text.charCodeAt(scheme) | 0x20) === 0x73) scheme++; // "s"
        if (!text.startsWith("://", scheme)) return -1;
        let end = scheme + 3;
        while (end < n && !SPACE.test(text[end]) && text[end] !== "<" && text[end] !== ">") end++;
        return end > scheme + 3 ? end : -1;
      }
      case "*":
        if (text.startsWith("***", at)) {
          const end = lazyToCloser(at, 3, boldItalicEnd);
          if (end >= 0) return end;
        }
        if (text[at + 1] === "*") {
          const end = lazyToCloser(at, 2, boldEnd);
          if (end >= 0) return end;
        }
        return runToMarker(at, italicEnd);
      case "_":
        if (text[at + 1] === "_") {
          const end = lazyToCloser(at, 2, underBoldEnd);
          if (end >= 0) return end;
        }
        return runToMarker(at, underItalicEnd);
      case "~":
        return text[at + 1] === "~" ? lazyToCloser(at, 2, strikeEnd) : -1;
      case "=": {
        if (text[at + 1] !== "=") return -1;
        const close = highlightEnd(at + 2);
        return close > at + 2 && text[close] === "=" && text[close + 1] === "=" ? close + 2 : -1;
      }
      default:
        return -1;
    }
  };

  for (let at = 0; at < n; ) {
    const end = tokenEnd(at);
    if (end > at) {
      yield { index: at, end };
      at = end;
    } else at++;
  }
}

export function parseInlineMarkdown(text: string): InlineNode[] {
  return parseRange(text, 0);
}

function pushText(out: InlineNode[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

function parseRange(text: string, depth: number): InlineNode[] {
  const out: InlineNode[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, text);
    return out;
  }
  let last = 0;
  for (const { index, end } of tokenSpans(text)) {
    const tok = text.slice(index, end);
    if (index > last) pushText(out, text.slice(last, index));
    last = end;

    if (tok.startsWith("\\")) {
      pushText(out, tok.slice(1));
    } else if (tok.startsWith("<!--")) {
      // dropped — comments stay invisible, matching the read view
    } else if (/^<br/i.test(tok)) {
      out.push({ kind: "br" });
    } else if (/^<input/i.test(tok)) {
      const box = readHtmlCheckbox(tok);
      if (box) out.push({ kind: "checkbox", checked: box.checked });
      else out.push({ kind: "text", text: tok });
    } else if (tok.startsWith("`")) {
      out.push({ kind: "code", text: tok.slice(1, -1) });
    } else if (/^!?\[\[/.test(tok)) {
      const inner = tok.replace(/^!?\[\[/, "").slice(0, -2);
      const [rawTarget, ...aliasParts] = inner.split("|");
      // The anchor stays with the link (issue #92): `[[#Heading]]` is a link
      // to a place in the same note, not text.
      const { target, anchor } = splitLinkAnchor(rawTarget);
      const display = (aliasParts.join("|") || rawTarget).trim() || target;
      if (target || anchor) out.push(anchor ? { kind: "wikiLink", target, display, anchor } : { kind: "wikiLink", target, display });
      else pushText(out, tok);
    } else if (/^!?\[/.test(tok)) {
      const lm = /^!?\[([^\]\n]*?)\]\(([^)\n]+?)\)$/.exec(tok);
      if (lm) {
        const href = lm[2].trim().split(/\s+/)[0]; // strip optional "title"
        const label = lm[1].trim() || href;
        out.push({ kind: "link", href, label, external: /^https?:\/\//i.test(href) });
      } else {
        pushText(out, tok);
      }
    } else if (/^https?:/i.test(tok)) {
      const trimmed = trimEndChars(tok, URL_TRAILING_PUNCT);
      out.push({ kind: "url", href: trimmed });
      pushText(out, tok.slice(trimmed.length));
    } else if (tok.startsWith("***")) {
      out.push({ kind: "strongEm", children: parseRange(tok.slice(3, -3), depth + 1) });
    } else if (tok.startsWith("**")) {
      out.push({ kind: "strong", children: parseRange(tok.slice(2, -2), depth + 1) });
    } else if (tok.startsWith("*")) {
      out.push({ kind: "em", children: parseRange(tok.slice(1, -1), depth + 1) });
    } else if (tok.startsWith("__") || tok.startsWith("_")) {
      // CommonMark: intraword underscores never open/close emphasis.
      const before = text[index - 1];
      const after = text[last];
      if ((before && /\w/.test(before)) || (after && /\w/.test(after))) {
        pushText(out, tok);
      } else if (tok.startsWith("__")) {
        out.push({ kind: "strong", children: parseRange(tok.slice(2, -2), depth + 1) });
      } else {
        out.push({ kind: "em", children: parseRange(tok.slice(1, -1), depth + 1) });
      }
    } else if (tok.startsWith("~~")) {
      out.push({ kind: "strike", children: parseRange(tok.slice(2, -2), depth + 1) });
    } else if (tok.startsWith("==")) {
      out.push({ kind: "highlight", children: parseRange(tok.slice(2, -2), depth + 1) });
    } else {
      pushText(out, tok);
    }
  }
  if (last < text.length) pushText(out, text.slice(last));
  return out;
}

/** Clickable link element; swallows mousedown so host widgets (e.g. the
 *  table cell editor, which opens on mousedown) don't react to link clicks. */
function makeLink(label: string, onActivate: (e: MouseEvent) => void): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "cm-md-cell-link";
  a.textContent = label;
  return wireActivation(a, onActivate);
}

/**
 * A tag in a rendered cell (finding 2026-09-19): the same pill the editor and
 * the reading view draw. Without a handler it is a look and nothing else, and
 * the host keeps its own mousedown (the cell editor opens as before).
 */
function makeTagPill(tag: string, onOpenTag?: (tag: string) => void): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.className = "pv-tag-pill";
  pill.setAttribute("data-tag", tag);
  pill.setAttribute("data-tag-color", tagColorAttrs(tag)["data-tag-color"]);
  const { parent, leaf } = tagSegments(tag);
  if (parent) {
    const path = document.createElement("span");
    path.className = "pv-tag-parent";
    path.textContent = `#${parent}`;
    pill.append(path, leaf);
  } else {
    pill.textContent = `#${tag}`;
  }
  return onOpenTag ? wireActivation(pill, () => onOpenTag(tag)) : pill;
}

function wireActivation<T extends HTMLElement>(a: T, onActivate: (e: MouseEvent) => void): T {
  a.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  // Touch: the cell editor opens on mousedown and native WebViews (WKWebView)
  // don't reliably synthesize a click on the link, so open on a genuine tap
  // here. preventDefault() suppresses the synthetic click; the timestamp dedupes
  // any click that still slips through so the link never opens twice.
  let tapX = 0;
  let tapY = 0;
  let lastTapAt = -1;
  a.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (t) {
        tapX = t.clientX;
        tapY = t.clientY;
      }
    },
    { passive: true },
  );
  a.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    if (!t || Math.hypot(t.clientX - tapX, t.clientY - tapY) > 10) return; // scroll, not a tap
    e.preventDefault();
    e.stopPropagation();
    lastTapAt = e.timeStamp;
    onActivate(e as unknown as MouseEvent);
  });
  a.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (lastTapAt >= 0 && e.timeStamp - lastTapAt < 700) return; // already handled by the tap
    onActivate(e);
  });
  return a;
}

function appendInlineNodes(parent: Node, nodes: InlineNode[], handlers: InlineLinkHandlers) {
  for (const n of nodes) {
    switch (n.kind) {
      case "text": {
        // A text token is what the index reads as a text node, so the index's
        // rule applies as it stands (core/tagRule.ts).
        let last = 0;
        for (const tag of n.text.includes("#") ? findInlineTags(n.text) : []) {
          if (tag.from > last) parent.appendChild(document.createTextNode(n.text.slice(last, tag.from)));
          parent.appendChild(makeTagPill(tag.name, handlers.onOpenTag));
          last = tag.to;
        }
        if (last < n.text.length) parent.appendChild(document.createTextNode(n.text.slice(last)));
        break;
      }
      case "checkbox": {
        // Drawn, never operated: a card and a table cell are places one READS.
        // Ticking happens in the note's read view, where the target is a real
        // control with a writer behind it.
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = n.checked;
        box.disabled = true;
        box.className = "pv-inline-box";
        parent.appendChild(box);
        break;
      }
      case "br":
        parent.appendChild(document.createElement("br"));
        break;
      case "code": {
        const el = document.createElement("code");
        el.textContent = n.text;
        el.style.background = "var(--code-bg)";
        el.style.borderRadius = "var(--radius-xs)";
        el.style.padding = "0 3px";
        el.style.fontSize = "0.9em";
        parent.appendChild(el);
        break;
      }
      case "strong":
      case "em":
      case "strike":
      case "strongEm":
      case "highlight": {
        let el: HTMLElement;
        if (n.kind === "strong") el = document.createElement("strong");
        else if (n.kind === "em") el = document.createElement("em");
        else if (n.kind === "strike") el = document.createElement("del");
        else if (n.kind === "highlight") {
          el = document.createElement("mark");
          el.style.background = "var(--highlight-bg)";
          el.style.color = "inherit";
          el.style.borderRadius = "var(--radius-xs)";
        } else {
          el = document.createElement("strong");
          const em = document.createElement("em");
          el.appendChild(em);
          appendInlineNodes(em, n.children, handlers);
          parent.appendChild(el);
          break;
        }
        appendInlineNodes(el, n.children, handlers);
        parent.appendChild(el);
        break;
      }
      case "wikiLink":
        parent.appendChild(makeLink(n.display, (e) => handlers.onOpenNote?.(n.target, e.ctrlKey || e.metaKey, "wiki")));
        break;
      case "link":
        if (n.external) parent.appendChild(makeLink(n.label, () => handlers.onOpenUrl?.(n.href)));
        else parent.appendChild(makeLink(n.label, (e) => handlers.onOpenNote?.(n.href, e.ctrlKey || e.metaKey, "markdown")));
        break;
      case "url":
        parent.appendChild(makeLink(n.href, () => handlers.onOpenUrl?.(n.href)));
        break;
    }
  }
}

/** Renders inline markdown to a DocumentFragment (DOM APIs only, no innerHTML). */
export function renderInlineMarkdown(text: string, handlers: InlineLinkHandlers = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendInlineNodes(frag, parseInlineMarkdown(text), handlers);
  return frag;
}
