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

const HTML_COMMENT_NODE_RE = /^\s*(?:<!--[\s\S]*?-->\s*)+$/;

interface MdastNodeLike {
  type?: string;
  value?: unknown;
  children?: MdastNodeLike[];
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
        (child) => !(child.type === "html" && HTML_COMMENT_NODE_RE.test(String(child.value ?? "")))
      );
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}

const HIGHLIGHT_RE = /==([^=\n]+?)==/g;

/**
 * remark plugin: removes the `==` markers of `==highlight==` from text nodes so
 * they no longer show — nor get copied — as literal `==` in the reading view.
 * Read mode has no raw-HTML support to render an actual <mark>, so this drops
 * the markers to plain text (the editor's live preview still highlights).
 * Only `text` nodes are touched; `inlineCode`/`code` nodes stay verbatim.
 */
export function remarkStripHighlightMarks() {
  return (tree: MdastNodeLike) => {
    const walk = (node: MdastNodeLike) => {
      if (!Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string" && child.value.includes("==")) {
          child.value = child.value.replace(HIGHLIGHT_RE, "$1");
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
