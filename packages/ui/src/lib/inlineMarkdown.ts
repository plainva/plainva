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
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "strongEm" | "strike" | "highlight"; children: InlineNode[] }
  | { kind: "wikiLink"; target: string; display: string }
  | { kind: "link"; href: string; label: string; external: boolean }
  | { kind: "url"; href: string };

export interface InlineLinkHandlers {
  /** Open a note by wiki target / vault-relative path (newTab on Ctrl/Cmd). */
  onOpenNote?: (target: string, newTab: boolean) => void;
  /** Open an external http(s) URL in the system browser. */
  onOpenUrl?: (url: string) => void;
}

// Alternation order matters: escapes and comments first, *** before ** before *,
// __ before _. Case-insensitivity is only relevant for <br>/https.
const TOKEN_SRC = [
  /\\[\\`*_~=[\]()<>|#+.!{}-]/.source, // backslash escape
  /<!--[\s\S]*?-->/.source, // HTML comment (hidden, like the read view)
  /<br\s*\/?>/.source, // <br>, <br/>, <br />
  /`[^`\n]+`/.source, // inline code
  /!?\[\[[^\]\n]+?\]\]/.source, // wiki link (embed "!" tolerated)
  /!?\[[^\]\n]*?\]\([^)\n]+?\)/.source, // markdown link (image "!" tolerated)
  /https?:\/\/[^\s<>]+/.source, // bare URL
  /\*\*\*[^\n]+?\*\*\*/.source, // bold italic
  /\*\*[^\n]+?\*\*/.source, // bold
  /\*[^*\n]+\*/.source, // italic (*)
  /__[^\n]+?__/.source, // bold (__)
  /_[^_\n]+_/.source, // italic (_), intraword guarded below
  /~~[^\n]+?~~/.source, // strikethrough
  /==[^=\n]+?==/.source, // ==highlight==
].join("|");

const URL_TRAILING_PUNCT_RE = /[).,;:!?"']+$/;
const MAX_DEPTH = 4;

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
  const re = new RegExp(TOKEN_SRC, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (m.index > last) pushText(out, text.slice(last, m.index));
    last = m.index + tok.length;

    if (tok.startsWith("\\")) {
      pushText(out, tok.slice(1));
    } else if (tok.startsWith("<!--")) {
      // dropped — comments stay invisible, matching the read view
    } else if (/^<br/i.test(tok)) {
      out.push({ kind: "br" });
    } else if (tok.startsWith("`")) {
      out.push({ kind: "code", text: tok.slice(1, -1) });
    } else if (/^!?\[\[/.test(tok)) {
      const inner = tok.replace(/^!?\[\[/, "").slice(0, -2);
      const [rawTarget, ...aliasParts] = inner.split("|");
      const target = rawTarget.split("#")[0].trim();
      const display = (aliasParts.join("|") || rawTarget).trim() || target;
      if (target) out.push({ kind: "wikiLink", target, display });
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
      const trimmed = tok.replace(URL_TRAILING_PUNCT_RE, "");
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
      const before = text[m.index - 1];
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
      case "text":
        parent.appendChild(document.createTextNode(n.text));
        break;
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
        parent.appendChild(makeLink(n.display, (e) => handlers.onOpenNote?.(n.target, e.ctrlKey || e.metaKey)));
        break;
      case "link":
        if (n.external) parent.appendChild(makeLink(n.label, () => handlers.onOpenUrl?.(n.href)));
        else parent.appendChild(makeLink(n.label, (e) => handlers.onOpenNote?.(n.href, e.ctrlKey || e.metaKey)));
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
