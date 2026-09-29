/**
 * Notes as sections, for the harness: the body without its frontmatter, the
 * ATX headings outside fenced code, and a section by its handle (the heading
 * chain, "Costs > 2026"). One definition for the tools (`read_note`,
 * `get_outline`) and the context package, so a handle the model saw in one
 * place opens the same section in the other.
 */

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** The note without its frontmatter block. */
/**
 * An ATX heading ("## Title", closing hashes allowed), or null. Linear on any
 * input — it also reads untrusted model output — so the closing hashes are cut
 * in code instead of by a pattern whose quantifiers could trade characters.
 */
export function atxHeading(line: string): { level: number; text: string } | null {
  const m = /^ {0,3}(#{1,6})[ \t]([^\n]*)$/.exec(line);
  if (!m) return null;
  let text = m[2]!.trim();
  const closing = /(?:^|[ \t])#+$/.exec(text);
  if (closing) text = text.slice(0, closing.index).trim();
  return { level: m[1]!.length, text };
}

export function noteBody(content: string): string {
  return content.replace(FRONTMATTER, "");
}

/** The frontmatter block without its fences, or null. */
export function frontmatterText(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  return match ? match[1]! : null;
}

export interface OutlineHeading {
  level: number;
  text: string;
  /** The section handle: the heading chain, "Costs > 2026". */
  chain: string;
  /** 0-based line of the heading in the body (frontmatter removed). */
  line: number;
}

/** The ATX headings of a body, outside fenced code. */
export function outlineOf(body: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  const stack: { level: number; text: string }[] = [];
  let fence: string | null = null;
  body.split("\n").forEach((line, index) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const heading = atxHeading(line);
    if (!heading) return;
    const { level, text } = heading;
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, text });
    out.push({ level, text, chain: stack.map((s) => s.text).join(" > "), line: index });
  });
  return out;
}

/** One section by its handle (the heading chain, or a unique heading text). */
export function sectionOf(body: string, handle: string): string | null {
  const headings = outlineOf(body);
  const wanted = handle.trim().toLowerCase();
  let found = headings.findIndex((h) => h.chain.toLowerCase() === wanted);
  if (found < 0) {
    const byText = headings.filter((h) => h.text.toLowerCase() === wanted);
    if (byText.length !== 1) return null;
    found = headings.indexOf(byText[0]!);
  }
  const head = headings[found]!;
  const end = headings.slice(found + 1).find((h) => h.level <= head.level);
  const lines = body.split("\n");
  return lines.slice(head.line, end ? end.line : lines.length).join("\n");
}

/**
 * The section around a 0-based body line: from the nearest heading at or
 * above it to the next heading of the same or a higher level. Text before the
 * first heading is its own section. The chain names it ("" for the preamble).
 */
export function sectionAt(body: string, line: number): { chain: string; text: string } {
  const headings = outlineOf(body);
  const lines = body.split("\n");
  let index = -1;
  for (let i = 0; i < headings.length; i++) if (headings[i]!.line <= line) index = i;
  if (index < 0) {
    const end = headings[0]?.line ?? lines.length;
    return { chain: "", text: lines.slice(0, end).join("\n") };
  }
  const head = headings[index]!;
  const end = headings.slice(index + 1).find((h) => h.level <= head.level);
  return { chain: head.chain, text: lines.slice(head.line, end ? end.line : lines.length).join("\n") };
}

/**
 * The first body line that contains one of the terms (case-blind), or -1.
 * Terms shorter than three characters are ignored: they match everywhere.
 */
export function firstLineWith(body: string, terms: readonly string[]): number {
  const wanted = terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
  if (wanted.length === 0) return -1;
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    if (wanted.some((term) => lower.includes(term))) return i;
  }
  return -1;
}
