/**
 * Pure helpers of the read mode (Nachbesserung 2026-07-04): resolving the
 * standard relative/bundle-absolute markdown links that generated index.md
 * listings use, and hiding HTML comments AST-side (react-markdown v10 renders
 * raw HTML as literal text; Obsidian's reading view hides comments too, and
 * the managed-index marker must stay invisible).
 */

export interface RelativeTarget {
  kind: "file" | "folder";
  path: string; // vault-relative, "" = vault root (folders only)
}

/**
 * Percent-encodes a wiki target for use inside a generated markdown link
 * destination (`[x](wiki://…)`). encodeURIComponent leaves `( ) ! ' *` raw —
 * an unbalanced `(` in a note name (or nesting depth ≥ 2) makes the CommonMark
 * destination swallow the link's closing paren, so the whole link renders as
 * literal text in read mode. decodeURIComponent reverses all of these.
 */
export function encodeWikiTarget(target: string): string {
  return encodeURIComponent(target).replace(/[()!'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Resolves a markdown href against the source file's folder. Returns null for
 * anchors, URLs with a scheme (http, mailto, wiki://, …) and paths that would
 * escape the vault — those keep their existing handling. A leading "/" is
 * bundle-absolute (OKF SPEC recommendation) and resolves from the vault root.
 */
export function resolveRelativeTarget(sourcePath: string, href: string): RelativeTarget | null {
  if (!href || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let raw: string;
  try {
    raw = decodeURI(href.split("#")[0]);
  } catch {
    return null;
  }
  if (!raw) return null;
  const isFolder = raw.endsWith("/");
  const rootRelative = raw.startsWith("/");
  const segs = rootRelative || !sourcePath.includes("/")
    ? []
    : sourcePath.replace(/\\/g, "/").split("/").slice(0, -1);
  for (const part of raw.replace(/\/+$/, "").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segs.length === 0) return null; // would escape the vault
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  if (segs.length === 0) return isFolder ? { kind: "folder", path: "" } : null;
  return { kind: isFolder ? "folder" : "file", path: segs.join("/") };
}

/** True if `s` is nothing but HTML comments and whitespace. Linear scan (no
 * regex backtracking) so a crafted node value cannot cause catastrophic
 * matching — replaces the ReDoS-prone /^\s*(?:<!--[\s\S]*?-->\s*)+$/. */
export function isHtmlCommentOnly(s: string): boolean {
  const n = s.length;
  let i = 0;
  let sawComment = false;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++; // per-char test is O(1), no backtracking
    if (i >= n) break;
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) return false; // unterminated comment
      i = end + 3;
      sawComment = true;
    } else {
      return false; // non-comment, non-whitespace content
    }
  }
  return sawComment;
}

interface MdastNodeLike {
  type?: string;
  value?: unknown;
  children?: MdastNodeLike[];
  data?: { hName?: string };
}

/**
 * remark plugin: drops mdast `html` nodes that consist solely of comments.
 * Code blocks are separate `code` nodes and stay untouched.
 */
export function remarkStripHtmlComments() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.filter(
        (child) => !(child.type === "html" && isHtmlCommentOnly(String(child.value ?? "")))
      );
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}

const HIGHLIGHT_RE = /==([^=\n]+?)==/g;

/**
 * remark plugin: renders `==highlight==` as a real <mark> in the reading view,
 * matching the live preview. mdast has no highlight node, so the marked span
 * becomes an `emphasis` node whose `data.hName` overrides the hast tag to
 * `mark` (mdast-util-to-hast honors hName — no raw HTML involved); the `==`
 * markers themselves disappear, so they are never shown or copied literally.
 * Only `text` nodes are touched; `inlineCode`/`code` nodes stay verbatim.
 */
export function remarkStripHighlightMarks() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === "text" && typeof child.value === "string" && child.value.includes("==")) {
          const value = child.value;
          const parts: MdastNodeLike[] = [];
          let last = 0;
          HIGHLIGHT_RE.lastIndex = 0;
          for (let m = HIGHLIGHT_RE.exec(value); m; m = HIGHLIGHT_RE.exec(value)) {
            if (m.index > last) parts.push({ type: "text", value: value.slice(last, m.index) });
            parts.push({ type: "emphasis", data: { hName: "mark" }, children: [{ type: "text", value: m[1] }] });
            last = m.index + m[0].length;
          }
          if (parts.length > 0) {
            if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
            node.children.splice(i, 1, ...parts);
            i += parts.length - 1;
            continue;
          }
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

const HTML_BR_NODE_RE = /^<br\s*\/?>$/i;

/**
 * remark plugin: renders literal `<br>` tags as hard line breaks. Without
 * rehype-raw, react-markdown shows raw HTML as literal text — but `<br>` is
 * the only way to break a line inside a GFM table cell, so it must work.
 * Code blocks/spans are separate node types and stay untouched.
 */
export function remarkBrToBreak() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child.type === "html" && HTML_BR_NODE_RE.test(String(child.value ?? "").trim())) {
          child.type = "break";
          delete child.value;
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
