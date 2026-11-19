import { describe, expect, it } from "vitest";
import { linkTargetsOfPlainBlock, redactDeniedLinks } from "../src/ai/egressGate.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractFrontmatter } from "../src/metadata-extractor.ts";
import { frontmatterSpan } from "../src/frontmatter-block.ts";
import { linkTargetsOfBlock, plainBlock, PROPERTIES_AS_HELD, propertiesBlockOf, propertiesInView } from "../src/vault/propertiesInView.ts";

/**
 * The shortcut of a narrower reader's view of a properties block is a superset of the full way (round 10 of the
 * review of R19, wave 2): a block is read as YAML only where it can hold a link withheld from its reader, so it must
 * never take a block for one that withholds nothing where the full way — every link the views read in its text and in
 * every text YAML reads from it — finds one withheld. Random blocks of the pieces links, YAML and the views are made
 * of, three readers. `ITER` sets the number of blocks (`ITER=25000` for the long run).
 */

const ITER = Number(process.env.ITER ?? 3_000);
let seed = Number(process.env.SEED ?? 10);
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

/** Pieces of anything: links, their halves, YAML's own marks, escapes, line breaks. */
const PIECES = ["[[Aaron Kowalski]]", "[t](../Private/Aaron%20Kowalski.md)", "[r]: ../Private/Aaron.md\n[r]", "[ [Aaron] ]", "[\n  [Aaron]]", "[Aaron]\n(", "] (Aaron.md)", "[[Aaron,", " Meier]]", "[x]", "(Aaron.md)", "&#91;&#91;Aaron&#93;&#93;", "%5B%5BAaron%5D%5D", "[\t[", "[ # c\n  [Aaron]]", "x: [\n  [Aaron]\n]", "x: >\n  [\n  [Aaron]]", "x: |\n  [\n  [Aaron]]", 'x: "[\n  [Aaron]]"', "x: '[\n  [Aaron]]'", "[", "]", "[[", "]]", "(", ")", "](", "]:", ":", " ", "\t", "\n", "\n  ", "#", " # c", '"', "'", "''", "\\", "\\x5b", "\\u005b", "\\x5d", "\\t", "\\n", "\\\n", "&#91;", "%5B", "%20", "Aaron Kowalski", "Aaron", "Kowalski", "Private/", ",", "|", "!", "<", ">", "&a ", "*a", "<<: ", "- ", "? ", "|\n  ", ">\n  ", "{", "}", "x: ", "\r\n", "\r", " ", " ", "!!str "];
/** Values a block that stays plain is written with: the shortcut must read their links as the full way does. */
const VALUES = ["[[Aaron Kowalski]]", '"[[Aaron]]"', "[[n1]]", "[t](../Private/Aaron%20Kowalski.md)", "[t](<../Private/Aaron Kowalski.md>)", "[[Aaron|x]]", "[[Aaron#h]]", "plain", "[a, b]", "[[[A]], [[B, C]]]", "[[Aaron, Kowalski]]", '"x [[Aaron Kowalski]] y"', "[[Aaron  Kowalski]]", "[[ Aaron ]]", "[[Aaron,Kowalski]]", "[[Aaron ,Kowalski]]", "x [[Aaron]] # c", "'[[Aaron]]'", "[[Aaron]] [[Kowalski]]", "![[Aaron]]", "{a: [[Aaron]]}", '["[[Aaron]]", b]', "[x](Aaron.md)", "it's [[Aaron]]", "[[Private/Aaron Kowalski]]", ""];
const KEYS = ["up", "related", '"k"', "x", "- y", "  z", "tags", "- [[Aaron]]"];

const loose = () => {
  let text = "";
  for (let i = 1 + Math.floor(random() * 14); i > 0; i--) text += pick(PIECES);
  return text;
};
const blockOf = () => {
  const lines: string[] = [];
  const many = 1 + Math.floor(random() * 4);
  for (let i = 0; i < many; i++) lines.push(random() < 0.6 ? `${pick(KEYS)}: ${pick(VALUES)}` : `${pick(KEYS)}: ${loose()}`);
  return `---\n${lines.join("\n")}\n---\n`;
};

const targetsOf = (text: string): string[] => {
  const found: string[] = [];
  redactDeniedLinks(text, (target) => {
    found.push(target);
    return false;
  });
  return found;
};
function textsIn(value: unknown, out: string[], depth = 0): void {
  if (typeof value === "string") out.push(value);
  else if (depth < 64 && value !== null && typeof value === "object") {
    if (Array.isArray(value)) for (const item of value) textsIn(item, out, depth + 1);
    else for (const [key, item] of Object.entries(value)) {
      out.push(key);
      textsIn(item, out, depth + 1);
    }
  }
}
/** The full way: every link the views read in the block's text and in every text YAML reads from it. */
const fullTargets = (block: string): string[] => {
  const read = extractFrontmatter(parseMarkdownAst(block, { preserveObsidianSyntax: true }));
  const texts: string[] = [];
  if (read.success && read.data) textsIn(read.data, texts);
  return [...targetsOf(block), ...texts.flatMap(targetsOf)];
};

const READERS: readonly ((target: string) => boolean)[] = [(target) => target.includes("Aaron"), (target) => target === "Aaron Kowalski" || target === "Private/Aaron Kowalski", () => true];

describe("the shortcut of a narrower reader's view of a properties block", () => {
  it("never takes a block for one that withholds nothing where the full way withholds a link, for three readers", () => {
    let plain = 0;
    let withheld = 0;
    let held = 0;
    const wrong: string[] = [];
    for (let i = 0; i < ITER; i++) {
      const written = blockOf();
      // Where no properties block stands, the index reads none either.
      if (!frontmatterSpan(`${written}# n\n`)) continue;
      const block = propertiesBlockOf(`${written}# n\n`);
      const full = fullTargets(block ?? written);
      if (block === null) {
        // A block that cannot hold a link holds none for the full way either.
        if (full.length) wrong.push(`no link? ${JSON.stringify(written)} -> ${JSON.stringify(full)}`);
        continue;
      }
      const short = linkTargetsOfBlock(block);
      if (plainBlock(block)) {
        plain++;
        // The lean reading of a plain block reads what the views read in it.
        const lean = new Set(linkTargetsOfPlainBlock(block));
        const views = new Set(targetsOf(block));
        if (lean.size !== views.size || [...views].some((target) => !lean.has(target))) wrong.push(`lean ${JSON.stringify(block)}: ${JSON.stringify([...lean])} vs ${JSON.stringify([...views])}`);
      }
      for (const denied of READERS) {
        const fullWithholds = full.some(denied);
        if (fullWithholds) withheld++;
        if (fullWithholds && !short.some(denied)) wrong.push(`missed ${JSON.stringify(block)} -> ${JSON.stringify(full.filter(denied))}`);
        const view = propertiesInView(block, denied);
        if (view === PROPERTIES_AS_HELD) {
          held++;
          if (fullWithholds) wrong.push(`held ${JSON.stringify(block)}`);
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    // The blocks reach every case: plain ones, ones the full way withholds a link of, ones that withhold nothing.
    expect(plain).toBeGreaterThan(ITER / 10);
    expect(withheld).toBeGreaterThan(ITER / 10);
    expect(held).toBeGreaterThan(ITER / 10);
  }, 120_000);

  it("reads a plain block as text, and every other one as YAML", () => {
    expect(plainBlock('---\nowner: "[[Board/n1]]"\nrel: [[n2]]\nrelated:\n  - [[n3|next]]\ntags: [a, b]\n---\n')).toBe(true);
    for (const block of ['---\nx: "[[Aa\\x72on]]"\n---\n', "---\nx: '[[O''Brien]]'\n---\n", "---\nup: [[Meier,\n  Kowalski]]\n---\n", "---\nx: |\n  [[Aaron]]\n---\n", "---\n[r]: Aaron.md\n---\n", "---\nx: *a\n---\n", "---\nx: !!str [[Aaron]]\n---\n", "---\nx:\ta\n---\n"]) {
      expect(plainBlock(block)).toBe(false);
    }
  });
});
