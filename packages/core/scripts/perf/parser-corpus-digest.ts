/**
 * Parser corpus digest (Sammelplan § 3.185 Nr. 8): a hash per text and per reading, so that two installs of the
 * markdown parser can be compared without keeping their trees.
 *
 *   tsx scripts/perf/parser-corpus-digest.ts out.json [--spec commonmark-spec.json] [--vaults <dir>] [--skip-long-table]
 *   tsx scripts/perf/parser-corpus-compare.ts out-old.json out-new.json
 *
 * Run it once in a checkout of each release (`git worktree add ../x v0.8.7`, `pnpm install --frozen-lockfile`), so
 * every side parses with the micromark its own lock file pins. Texts: the hand-made forms (parserCorpusForms.ts),
 * the perf fixture vault's notes, the table corpus (test/gfmTableCorpus.ts), optionally the examples of a
 * CommonMark spec JSON (`[{ example, section, markdown }]`) and every `.md` of a vault directory (named by a hash of
 * its path only: a private vault's names and words stay out of the output).
 *
 * Readings per text: the index's AST (parseMarkdownAst), the editor's tree, the CommonMark tree, the reading view's
 * hast from the raw and from the prepared source, and what the index takes from the AST (links, tags, front matter).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { extractLinksAndTags } from "../../src/ast-scanner.js";
import { extractFrontmatter } from "../../src/metadata-extractor.js";
import { parseCommonMarkTree, parseMarkdownAst, parseMarkdownTree } from "../../src/markdown-parser.js";
import { prepareReaderSource } from "../../src/noteSource.js";
import { NASTY_TABLES } from "../../test/gfmTableCorpus.js";
import { fixtureFiles } from "./fixtureVault.js";
import { HARD_FORMS } from "./parserCorpusForms.js";

const args = process.argv.slice(2);
const out = args[0];
const option = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!out || out.startsWith("--")) throw new Error("usage: parser-corpus-digest.ts out.json [--spec file] [--vaults dir] [--skip-long-table]");

const texts = new Map<string, string>();
for (const [name, text] of Object.entries(HARD_FORMS)) {
  texts.set(`A:${name}`, text);
  // The same form as a paragraph of many lines: the flanking of a form next to the lines around it.
  if (!text.includes("\n") && text.length < 120) texts.set(`A-para:${name}`, Array.from({ length: 100 }, () => text).join("\n"));
}
for (const file of fixtureFiles({ count: 1000, longTableNote: !args.includes("--skip-long-table") })) {
  if (file.path.endsWith(".md") && typeof file.data === "string") texts.set(`B:${file.path}`, file.data);
}
for (const [name, text] of Object.entries(NASTY_TABLES)) texts.set(`C:${name}`, text);
const spec = option("--spec");
if (spec) {
  for (const ex of JSON.parse(readFileSync(spec, "utf8")) as Array<{ example: number; section: string; markdown: string }>) {
    texts.set(`D:cm:${ex.example}:${ex.section}`, ex.markdown);
  }
}
const vaults = option("--vaults");
if (vaults) {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".")) return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith(".md") ? [full] : [];
  });
  for (const file of walk(vaults)) {
    const rel = path.relative(vaults, file);
    texts.set(`E:${createHash("sha256").update(rel).digest("hex").slice(0, 16)}`, readFileSync(file, "utf8"));
  }
}

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const reader = unified().use(remarkParse).use(remarkGfm);
const result: Record<string, Record<string, string>> = {};
const began = performance.now();
for (const [name, text] of texts) {
  const index = parseMarkdownAst(text, { preserveObsidianSyntax: true });
  const found = extractLinksAndTags(index);
  result[name] = {
    index: sha(index),
    tree: sha(parseMarkdownTree(text)),
    commonmark: sha(parseCommonMarkTree(text)),
    rawHast: sha(toHast(reader.parse(text))),
    preparedHast: sha(toHast(reader.parse(prepareReaderSource(text, { tables: true }).text))),
    facts: sha({ links: found.links, tags: found.tags, frontmatter: extractFrontmatter(index) }),
  };
}
writeFileSync(out, JSON.stringify({ count: texts.size, elapsedMs: Math.round(performance.now() - began), result }, null, 2));
console.log(`${texts.size} texts -> ${out}`);
