/**
 * Copy-as-rich-text (HTML) companion to markdownToPlainText.
 *
 * When copying out of the live preview, CodeMirror only puts text/plain on the
 * clipboard, so pasting into a rich-text target (Google Docs, Word, ...) loses
 * all formatting. editorSession adds a copy/cut handler that ALSO writes the
 * text/html produced here, so rich targets keep the formatting while plain
 * targets still receive markdownToPlainText's output.
 *
 * Dependency-free: reuses the shared parseInlineMarkdown tokenizer and mirrors
 * the block grammar of markdownToPlainText. The output is a self-contained HTML
 * fragment with no styling; wiki links and non-web links degrade to their
 * display text (they have no meaning outside the vault) and every text/URL is
 * escaped, so nothing can inject markup. Nested lists are flattened to one
 * level (acceptable for a clipboard paste). Pure and unit-testable.
 */

import { createFenceTracker, readAtxHeading, readBlockquoteLine, readMarkdownListItem, readQuoteDepth, stripQuoteMarkers, type FenceLineKind } from "@plainva/core";
import { parseInlineMarkdown, type InlineNode } from "./inlineMarkdown";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Render parsed inline nodes to an HTML string, preserving formatting. */
export function inlineNodesToHtml(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.kind) {
      case "text":
        out += escapeHtml(n.text);
        break;
      case "br":
        out += "<br>";
        break;
      case "code":
        out += `<code>${escapeHtml(n.text)}</code>`;
        break;
      case "strong":
        out += `<strong>${inlineNodesToHtml(n.children)}</strong>`;
        break;
      case "em":
        out += `<em>${inlineNodesToHtml(n.children)}</em>`;
        break;
      case "strongEm":
        out += `<strong><em>${inlineNodesToHtml(n.children)}</em></strong>`;
        break;
      case "strike":
        out += `<del>${inlineNodesToHtml(n.children)}</del>`;
        break;
      case "highlight":
        out += `<mark>${inlineNodesToHtml(n.children)}</mark>`;
        break;
      case "wikiLink":
        out += escapeHtml(n.display); // no resolvable target outside the vault
        break;
      case "link":
        out += n.external
          ? `<a href="${escapeAttr(n.href)}">${escapeHtml(n.label)}</a>`
          : escapeHtml(n.label);
        break;
      case "url":
        out += `<a href="${escapeAttr(n.href)}">${escapeHtml(n.href)}</a>`;
        break;
    }
  }
  return out;
}

function inlineToHtml(line: string): string {
  return inlineNodesToHtml(parseInlineMarkdown(line));
}

const THEMATIC_BREAK_RE = /^\s{0,3}([-*_=])(?:[ \t]*\1){2,}[ \t]*$/;

function isTableSeparatorRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes("|") || !s.includes("-")) return false;
  return /^[|\s:-]+$/.test(s);
}

function isTableRow(line: string): boolean {
  const s = line.trim();
  return s.startsWith("|") || s.endsWith("|");
}

function splitTableCells(line: string): string[] {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s.split("|").map((c) => c.trim());
}

/** Convert a copied Markdown fragment to a self-contained HTML fragment. */
export function markdownToHtml(md: string): string {
  if (!md) return "";
  const lines = md.split("\n");
  // Fenced code by the one rule every scanner reads (core `markdownFence.ts`;
  // open-items plan 3.159 no. 4, decision E16): a fence in a quote or a
  // callout included. A pattern of its own here knew no quote, so the code of
  // a fenced block in a callout went into a mail as Markdown read as text.
  const fence = createFenceTracker();
  const fenceKinds: Array<FenceLineKind | null> = lines.map((line) => fence.step(line));
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inlineToHtml).join("<br>")}</p>`);
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];

    // Fenced code block — content emitted verbatim (escaped), never inline-parsed;
    // in a quote, without the quote's markers and inside a quote.
    if (fenceKinds[i] === "open") {
      flushPara();
      const depth = readQuoteDepth(raw).depth;
      i++;
      const code: string[] = [];
      while (i < lines.length && fenceKinds[i] === "code") {
        code.push(stripQuoteMarkers(lines[i], depth));
        i++;
      }
      if (fenceKinds[i] === "close") i++; // skip the closing fence
      const block = `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
      out.push(depth > 0 ? `<blockquote>${block}</blockquote>` : block);
      continue;
    }

    if (raw.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    if (THEMATIC_BREAK_RE.test(raw)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    // Heading and quote lines come from the shared readers (plan Befunde
    // 24.09., E6): the same grammar as the plain-text copy, in one pass.
    const atx = readAtxHeading(raw);
    if (atx) {
      flushPara();
      const level = atx.level;
      out.push(`<h${level}>${inlineToHtml(atx.text)}</h${level}>`);
      i++;
      continue;
    }

    // Table: a header row immediately followed by a separator row.
    if (isTableRow(raw) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      flushPara();
      const header = splitTableCells(raw);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparatorRow(lines[i])) {
        body.push(splitTableCells(lines[i]));
        i++;
      }
      let t = "<table><thead><tr>";
      t += header.map((c) => `<th>${inlineToHtml(c)}</th>`).join("");
      t += "</tr></thead><tbody>";
      for (const r of body) t += "<tr>" + r.map((c) => `<td>${inlineToHtml(c)}</td>`).join("") + "</tr>";
      t += "</tbody></table>";
      out.push(t);
      continue;
    }

    const bq = readBlockquoteLine(raw);
    if (bq) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length) {
        // A fence in the quote is code of its own (above), not quoted prose.
        if (fenceKinds[i] !== null) break;
        const quote = readBlockquoteLine(lines[i]);
        if (!quote) break;
        inner.push(quote.text);
        i++;
      }
      out.push(`<blockquote>${inner.map(inlineToHtml).join("<br>")}</blockquote>`);
      continue;
    }

    // The shared list reader (plan Befunde 24.09., E6): the same grammar as the
    // plain-text copy and the editor, one pass instead of three patterns.
    const first = readMarkdownListItem(raw);
    if (first) {
      flushPara();
      const ordered = first.ordered;
      const items: string[] = [];
      while (i < lines.length) {
        const item = readMarkdownListItem(lines[i]);
        if (!item) break;
        if (item.box !== null) {
          // done, in progress, cancelled, open — four shapes, as in the app (E12).
          const state = item.box;
          const box = state.toLowerCase() === "x" ? "☑" : state === "/" ? "◪" : state === "-" ? "☒" : "☐";
          items.push(`${box} ${inlineToHtml(item.text)}`);
        } else {
          items.push(inlineToHtml(item.text));
        }
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${it}</li>`).join("")}</${tag}>`);
      continue;
    }

    para.push(raw);
    i++;
  }
  flushPara();
  return out.join("");
}
