import { parse, type DefaultTreeAdapterMap } from "parse5";
import { stripInvisible } from "../trust.js";
import { checkWebUrl } from "./rules.js";

/**
 * A fetched page as a reader needs it (plan KI-Harness P4): its title, its
 * text and its links — nothing that runs, nothing that loads, nothing a
 * person looking at the page would not have seen.
 *
 * The text goes to the quarantined processor (processor.ts), never to the
 * model that holds the tools. Leaving out what is hidden is therefore not the
 * defence — the fence and the processor are — but it removes the cheapest
 * place to put an instruction: a comment, a `display:none` block, a script.
 */

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** What the processor reads at most; the beginning of a page is what a reader needs of it. */
export const PAGE_TEXT_MAX = 60_000;
export const PAGE_LINKS_MAX = 150;
const TITLE_MAX = 300;
const LINK_TEXT_MAX = 160;

export interface PageLink {
  text: string;
  url: string;
}

export interface PageContent {
  title: string;
  text: string;
  /** Links a request may follow (public https addresses), each once, in page order. */
  links: PageLink[];
  /** The page had more text than a reader takes: it ends early. */
  truncated: boolean;
}

/** Never text a reader sees: code, styles, embedded documents, form controls. */
const OMIT = new Set(["script", "style", "noscript", "template", "svg", "math", "iframe", "frame", "object", "embed", "canvas", "audio", "video", "head", "select", "datalist", "textarea", "button", "dialog"]);
/** Around the content, not the content: left out when the page still has enough to say without them. */
const CHROME = new Set(["nav", "footer", "aside", "form"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "blockquote", "pre", "ul", "ol", "dl", "dt", "dd", "table", "figure", "figcaption", "address", "details", "summary", "hr", "nav", "footer", "aside", "form", "body"]);
const HEADING = /^h([1-6])$/;

const children = (node: Node): Node[] => ("childNodes" in node ? node.childNodes : []);
const attr =(node: Element, name: string): string | undefined => node.attrs.find((a) => a.name === name)?.value;

/** Markup that says "do not show this": the attributes and the inline styles a page hides text with. */
function hidden(node: Element): boolean {
  if (attr(node, "hidden") !== undefined) return true;
  if (attr(node, "aria-hidden")?.trim().toLowerCase() === "true") return true;
  if (node.tagName === "input" && attr(node, "type")?.trim().toLowerCase() === "hidden") return true;
  const style = attr(node, "style")?.toLowerCase().replace(/\s+/g, "") ?? "";
  if (!style) return false;
  return /(?:^|;)display:none/.test(style) || /(?:^|;)visibility:(?:hidden|collapse)/.test(style) || /(?:^|;)opacity:0(?:\.0+)?(?:;|!|$)/.test(style) || /(?:^|;)font-size:0(?:px|pt|em|rem|%)?(?:;|!|$)/.test(style);
}

function find(root: Node, test: (el: Element) => boolean): Element[] {
  const found: Element[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if ("tagName" in node) {
      if (OMIT.has(node.tagName) && node.tagName !== "head") continue;
      if (test(node)) found.push(node);
    }
    const nested = children(node);
    for (let i = nested.length - 1; i >= 0; i--) stack.push(nested[i]!);
  }
  return found;
}

/** The text of a subtree as a reader would take it down: blocks as paragraphs, headings and list items marked. */
function textOf(root: Node, skip: ReadonlySet<string>): string {
  const out: string[] = [];
  const walk = (node: Node, pre: boolean): void => {
    if (node.nodeName === "#text" && "value" in node) {
      out.push(pre ? node.value : node.value.replace(/\s+/g, " "));
      return;
    }
    if (!("tagName" in node)) {
      for (const child of children(node)) walk(child, pre);
      return;
    }
    const name = node.tagName;
    if (OMIT.has(name) || skip.has(name) || hidden(node)) return;
    if (name === "br") return void out.push("\n");
    const heading = HEADING.exec(name);
    if (heading) out.push(`\n\n${"#".repeat(Number(heading[1]))} `);
    else if (name === "li") out.push("\n- ");
    else if (name === "tr") out.push("\n");
    else if (name === "td" || name === "th") out.push(" | ");
    else if (BLOCK.has(name)) out.push("\n\n");
    for (const child of children(node)) walk(child, pre || name === "pre");
    if (heading || BLOCK.has(name)) out.push("\n\n");
  };
  walk(root, false);
  return tidy(out.join(""));
}

/** Lines trimmed, runs of blanks as one, at most one empty line between two paragraphs. Line by line, so its cost stays linear in what a page sends. */
function tidy(text: string): string {
  const lines = stripInvisible(text)
    .text.replace(/\r\n?/g, "\n")
    .replace(/\xa0/g, " ")
    .split("\n")
    .map((line) => line.trim().split(/[ \t]+/).join(" "));
  const out: string[] = [];
  for (const line of lines) if (line || (out.length > 0 && out[out.length - 1] !== "")) out.push(line);
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

const oneLine = (text: string, max: number) => tidy(text).replace(/\s+/g, " ").slice(0, max).trim();

function cut(text: string): { text: string; truncated: boolean } {
  if (text.length <= PAGE_TEXT_MAX) return { text, truncated: false };
  // End at a paragraph where one is near, so the processor does not read half a sentence as a whole one.
  const at = text.lastIndexOf("\n\n", PAGE_TEXT_MAX);
  return { text: text.slice(0, at > PAGE_TEXT_MAX * 0.8 ? at : PAGE_TEXT_MAX).trimEnd(), truncated: true };
}

/**
 * The page's main text. A page that marks its content (`<main>`, `<article>`)
 * is taken at its word when that part has enough to say; otherwise the body
 * without its navigation, and the whole body when even that is next to
 * nothing.
 */
function mainText(document: Node): string {
  const marked = find(document, (el) => el.tagName === "main" || el.tagName === "article" || attr(el, "role")?.trim().toLowerCase() === "main")
    .filter((el) => !hidden(el))
    .map((el) => textOf(el, CHROME))
    .sort((a, b) => b.length - a.length)[0];
  if (marked && marked.length >= 600) return marked;
  const body = find(document, (el) => el.tagName === "body")[0] ?? document;
  const lean = textOf(body, CHROME);
  return lean.length >= 200 ? lean : textOf(body, new Set());
}

function linksOf(document: Node, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  // A page's own base element decides what its relative links mean.
  const baseHref = find(document, (el) => el.tagName === "base")[0];
  let base = baseUrl;
  try {
    const declared = baseHref ? attr(baseHref, "href") : undefined;
    if (declared) base = new URL(declared, baseUrl).href;
  } catch {
    base = baseUrl;
  }
  for (const anchor of find(document, (el) => el.tagName === "a")) {
    if (links.length >= PAGE_LINKS_MAX) break;
    if (hidden(anchor)) continue;
    const href = attr(anchor, "href")?.trim();
    if (!href || href.startsWith("#")) continue;
    let absolute: string;
    try {
      absolute = new URL(href, base).href;
    } catch {
      continue;
    }
    const checked = checkWebUrl(absolute);
    if (!checked.ok || seen.has(checked.target.url)) continue;
    seen.add(checked.target.url);
    links.push({ text: oneLine(textOf(anchor, new Set()), LINK_TEXT_MAX), url: checked.target.url });
  }
  return links;
}

/** Title, text and links of an HTML page. `baseUrl` is the address it was fetched from, after redirects. */
export function extractPage(html: string, baseUrl: string): PageContent {
  const document = parse(html);
  const titleEl = find(document, (el) => el.tagName === "title")[0];
  const heading = find(document, (el) => el.tagName === "h1" && !hidden(el))[0];
  // The heading's text without the mark `textOf` gives a heading.
  const named = (el: Element | undefined) => oneLine(el ? textOf(el, new Set()).replace(/^#+\s*/, "") : "", TITLE_MAX);
  const title = named(titleEl) || named(heading);
  const { text, truncated } = cut(mainText(document));
  return { title, text, links: linksOf(document, baseUrl), truncated };
}

/**
 * What a fetched body is to a reader, by its content type: HTML is extracted,
 * anything else that is text is taken as it is. Links are only read from
 * HTML — an address inside a text file is text.
 */
export function extractContent(body: string, contentType: string, baseUrl: string): PageContent {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml" || (!type && /<html[\s>]/i.test(body.slice(0, 2000)))) return extractPage(body, baseUrl);
  const { text, truncated } = cut(tidy(body));
  return { title: "", text, links: [], truncated };
}
