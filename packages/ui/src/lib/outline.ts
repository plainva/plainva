/**
 * Document outline (#10): extract the heading structure of a markdown note for
 * the right-sidebar "Gliederung" section. Pure + unit-tested.
 */
export interface Heading {
  level: number; // 1..6
  text: string;
  line: number; // 1-based (matches CodeMirror line numbers)
  slug: string;
}

/** GitHub-ish slug used both here and as the read-view heading id (for scroll). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * What stands above a line (TestFlight feedback Build 91, P7): the heading
 * chain from the document's top down to the line, and the list items the line
 * is nested under. A backlink or a search hit shown with this is readable
 * without opening the note — the reading the better-search-views plugin
 * gives Obsidian. Pure; `line` is 1-based like the headings.
 */
export interface OutlineContext {
  /** Heading texts, outermost first — the chain of levels that contains `line`. */
  headings: string[];
  /** Parent list items, outermost first — without their markers. */
  listParents: string[];
  /** The line itself, trimmed of its list marker. */
  lineText: string;
}

const LIST_ITEM_RE = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

export function outlineContextFor(content: string, line: number): OutlineContext {
  const lines = content.split("\n");
  const idx = Math.min(Math.max(line, 1), lines.length) - 1;

  // Heading chain: walk the headings above the line, keeping a stack by level.
  const stack: Heading[] = [];
  for (const h of parseHeadings(content)) {
    if (h.line > line) break;
    if (h.line === line) break; // a link ON a heading line has that heading as its line text
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
  }

  // List parents: from the line upwards, every list item with a smaller
  // indent than the last one collected; a heading or an unindented non-list
  // line ends the nesting.
  const own = LIST_ITEM_RE.exec(lines[idx] ?? "");
  const listParents: string[] = [];
  if (own) {
    let indent = own[1].length;
    for (let i = idx - 1; i >= 0 && indent > 0; i--) {
      const text = lines[i];
      if (/^#{1,6}\s/.test(text)) break;
      const m = LIST_ITEM_RE.exec(text);
      if (!m) {
        if (text.trim() !== "" && !/^\s/.test(text)) break; // prose at column 0 ends the list
        continue;
      }
      if (m[1].length < indent) {
        listParents.unshift(m[2].trim());
        indent = m[1].length;
      }
    }
  }

  return {
    headings: stack.map((h) => h.text),
    listParents,
    lineText: (own ? own[2] : (lines[idx] ?? "")).trim(),
  };
}

/** Parse ATX headings, skipping YAML frontmatter and fenced code blocks. */
export function parseHeadings(content: string): Heading[] {
  const lines = content.split("\n");
  const out: Heading[] = [];
  let inFence = false;
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line.trim() === "---") inFrontmatter = false; continue; }
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const text = m[2].trim();
      out.push({ level: m[1].length, text, line: i + 1, slug: slugify(text) });
    }
  }
  return out;
}
