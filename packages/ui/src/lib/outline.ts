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
