import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTE_FORMS } from "../scripts/perf/note-budget.ts";
import { fixtureFiles } from "../scripts/perf/fixtureVault.ts";
import { HARD_FORMS } from "../scripts/perf/parserCorpusForms.ts";
import { NASTY_TABLES } from "./gfmTableCorpus.ts";
import { wikiLinkSyntax } from "../src/wikiLinkSyntax.ts";
import { parseMarkdownAst, parseMarkdownTree } from "../src/markdown-parser.ts";
import { within } from "./helpers/timeBudget.js";

/**
 * micromark's text initializer merges the adjacent `data` events of a text
 * (`resolveAllText` in lib/initialize/text.js). micromark 4.0.3 does it with a
 * `splice` on the whole event list for every run of them — quadratic in the
 * lines of a paragraph: a quiet paragraph of 40 000 lines took 17 s to parse.
 * The app patches the function into one pass that moves the events that stay
 * forward in place (`patches/micromark@4.0.3.patch`, the root package's
 * `pnpm.patchedDependencies`; docs/engineering/Dependency_Updates.md).
 *
 * The original function stays here as the oracle: a second micromark parser
 * runs it in place of the patched merge, and every event of every text of the
 * corpus — the parser corpus's hand-made forms and the same as 100-line
 * paragraphs, the fixture vault, the table corpus, the forms of the note's
 * budget, 1 000 random notes of a fixed seed — must come out the same, in kind,
 * type and place. A change of micromark's version turns the guard red until
 * the patch is proven anew.
 */

const SECONDS = 1000;
const require = createRequire(import.meta.url);
// The package's own folder: under the `development` condition `micromark` resolves to its dev/ build.
const MICROMARK = ((entry) => (entry.endsWith(`${"/"}dev`) ? dirname(entry) : entry))(dirname(require.resolve("micromark")));
const PATCHED_VERSION = "4.0.3";

type Point = { line: number; column: number; offset: number; _index: number; _bufferIndex: number };
type Token = { type: string; start: Point; end: Point };
type Event = [string, Token, unknown];

/** micromark 4.0.3's own `resolveAllText` merge (MIT, Titus Wormer), word for word but for the return. */
function originalMerge(events: Event[]): Event[] {
  let index = -1;
  let enter: number | undefined;
  while (++index <= events.length) {
    if (enter === undefined) {
      if (events[index] && events[index][1].type === "data") {
        enter = index;
        index++;
      }
    } else if (!events[index] || events[index][1].type !== "data") {
      if (index !== enter + 2) {
        events[enter][1].end = events[index - 1][1].end;
        events.splice(enter + 2, index - enter - 2);
        index = enter + 2;
      }
      enter = undefined;
    }
  }
  return events;
}

/** The parse of micromark from the build `root` (lib or dev), its text and string initializers given `merge` first. */
async function parserOf(root: string, oracle: boolean) {
  const load = (file: string) => import(pathToFileURL(join(MICROMARK, root, file)).href);
  const { combineExtensions } = await import(pathToFileURL(require.resolve("micromark-util-combine-extensions", { paths: [MICROMARK] })).href);
  const { content } = await load("lib/initialize/content.js");
  const { document } = await load("lib/initialize/document.js");
  const { flow } = await load("lib/initialize/flow.js");
  const { string, text } = await load("lib/initialize/text.js");
  const defaultConstructs = await load("lib/constructs.js");
  const { createTokenizer } = await load("lib/create-tokenizer.js");
  const { preprocess } = await load("lib/preprocess.js");
  const { postprocess } = await load("lib/postprocess.js");
  // The oracle merges with the original first; the patched merge after it finds no run left and only hands on.
  const withOracle = (initial: { resolveAll: (events: Event[], context: unknown) => Event[] }) =>
    oracle ? { ...initial, resolveAll: (events: Event[], context: unknown) => initial.resolveAll(originalMerge(events), context) } : initial;
  return (value: string, extensions: unknown[]): Event[] => {
    const constructs = combineExtensions([defaultConstructs, ...extensions]);
    const parser: Record<string, unknown> = { constructs, defined: [], lazy: {} };
    const create = (initial: unknown) => (from?: unknown) => createTokenizer(parser, initial, from);
    Object.assign(parser, { content: create(content), document: create(document), flow: create(flow), string: create(withOracle(string)), text: create(withOracle(text)) });
    return postprocess((parser.document as (from?: unknown) => { write: (chunks: unknown[]) => Event[] })().write(preprocess()(value, undefined, true)));
  };
}

/** Every event as kind, type and its two places — what the tree is built from. */
const shape = (events: Event[]) => events.map(([kind, token]) => `${kind} ${token.type} ${JSON.stringify(token.start)} ${JSON.stringify(token.end)}`);

function corpus(): Array<[string, string]> {
  const texts: Array<[string, string]> = [];
  for (const [name, form] of Object.entries(HARD_FORMS)) {
    texts.push([`form ${name}`, form]);
    texts.push([`form ${name} x100`, Array.from({ length: 100 }, () => form).join("\n")]);
  }
  for (const file of fixtureFiles({ count: 1000 })) if (file.path.endsWith(".md") && !file.path.endsWith("Long table note.md")) texts.push([file.path, file.data as string]);
  for (const [name, table] of Object.entries(NASTY_TABLES)) texts.push([`table ${name}`, table]);
  for (const [name, make] of Object.entries(NOTE_FORMS)) texts.push([`note form ${name}`, `---\ntitle: T\n---\n\n# Title\n\n${make(name.includes("tables") ? 2 : 60)}\n`]);
  // Random notes of a fixed seed: every kind of block and inline mark, with and without blank lines between.
  const pieces = ["# H [[A]]", "- item [[B]] #tag", "- [ ] task *em* ^b1", "  - nested `code`", "> quote **b** [x](E.md)", "```js\nconst a = '[[F]]';\n```", "| a | b |\n|---|---|\n| [[G\\|g]] | `c` |", "Text ![[img.png]] https://x.org <b>h</b> &amp; ~~s~~  ", "1. ordered", "    indented", "<!-- c -->", "x[^1]\n\n[^1]: note", "---", "$x$ and \\* esc", "a `b\nc` d", "line with trailing blanks   ", "a_b_c and *a*b*c*", "[ref]\n\n[ref]: u"];
  let seed = 11;
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 1_000; k++) {
    const parts: string[] = [];
    const count = 3 + Math.floor(random() * 60);
    for (let i = 0; i < count; i++) parts.push(pieces[Math.floor(random() * pieces.length)] + (random() < 0.5 ? "\n\n" : "\n"));
    texts.push([`random ${k}`, parts.join("")]);
  }
  return texts;
}

describe("the patch of micromark's text initializer", () => {
  it("is proven for the micromark it patches: a new version is red here until the patch is proven anew", () => {
    expect.hasAssertions();
    const version = (JSON.parse(readFileSync(join(MICROMARK, "package.json"), "utf8")) as { version: string }).version;
    expect(version, "micromark changed: prove the patch of resolveAllText against the oracle anew, then move PATCHED_VERSION").toBe(PATCHED_VERSION);
    const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { pnpm?: { patchedDependencies?: Record<string, string> } };
    expect(root.pnpm?.patchedDependencies?.[`micromark@${PATCHED_VERSION}`]).toBe(`patches/micromark@${PATCHED_VERSION}.patch`);
    // Both builds carry the one-pass merge (a patch that does not apply fails the install).
    for (const build of ["lib/initialize/text.js", "dev/lib/initialize/text.js"]) {
      const source = readFileSync(join(MICROMARK, build), "utf8");
      expect(source, build).toContain("Merge adjacent `data` events in one pass");
      expect(source, build).not.toContain("events.splice(enter + 2");
    }
  });

  for (const build of ["", "dev/"]) {
    it(`gives every event of the corpus as the original does (${build || "lib/"})`, async () => {
      expect.hasAssertions();
      const patched = await parserOf(build, false);
      const oracle = await parserOf(build, true);
      const readings: Array<[string, unknown[]]> = [
        ["gfm and wiki links", [(await import(pathToFileURL(createRequire(require.resolve("remark-gfm")).resolve("micromark-extension-gfm")).href)).gfm(), wikiLinkSyntax]],
        ["commonmark", []],
      ];
      const differing: string[] = [];
      let compared = 0;
      for (const [name, text] of corpus()) {
        for (const [reading, extensions] of readings) {
          const a = shape(patched(text, extensions));
          const b = shape(oracle(text, extensions));
          compared++;
          if (a.length !== b.length || a.some((line, i) => line !== b[i])) differing.push(`${name} (${reading})`);
        }
      }
      expect(compared).toBeGreaterThan(4_500);
      expect(differing.slice(0, 5)).toEqual([]);
    }, 600 * SECONDS);
  }

  for (const build of ["", "dev/"]) {
    it(`merges the data events of a long paragraph in time linear in its lines (${build || "lib/"})`, async () => {
      expect.hasAssertions();
      // Measured 2026-11-26 on the original and the patched merge alike (lib/, the build the app ships):
      // the merge of 100 000 runs of data events 8.5 s before, 91 ms after; the parse of a quiet paragraph of
      // 40 000 lines 17 s before, 0.7 s after; 10 000 lines 2.1 s before, 0.21 s after.
      const { string, text } = await import(pathToFileURL(join(MICROMARK, build, "lib/initialize/text.js")).href);
      const point = (offset: number) => ({ line: 1, column: offset + 1, offset, _index: 0, _bufferIndex: offset });
      // Runs of three data events between line endings — what a paragraph of words gives with GFM.
      const runs = (count: number) => {
        const events: Event[] = [];
        let offset = 0;
        for (let run = 0; run < count; run++) {
          for (const type of ["data", "data", "data", "lineEnding"]) {
            const token = { type, start: point(offset), end: point(++offset) } as Token;
            events.push(["enter", token, {}], ["exit", token, {}]);
          }
        }
        return events;
      };
      const merged = within(1 * SECONDS, () => string.resolveAll(runs(200_000), {}) as Event[]);
      expect(merged.length).toBe(200_000 * 4);
      expect(merged[0][1].end.offset).toBe(3);
      expect(text.resolveAll).toBeTypeOf("function");
      const parse = await parserOf(build, false);
      const extensions = [(await import(pathToFileURL(createRequire(require.resolve("remark-gfm")).resolve("micromark-extension-gfm")).href)).gfm(), wikiLinkSyntax];
      const paragraph = (lines: number) => Array.from({ length: lines }, (_, i) => `a quiet line ${i} with words`).join("\n");
      for (const lines of [5_000, 10_000]) within(1.5 * SECONDS, () => parse(paragraph(lines), extensions));
      within(4 * SECONDS, () => parse(paragraph(40_000), extensions));
      // Behind an unclosed `---` in its first line the rest of a note is read as it comes: a paragraph of 40 000 lines.
      const { frontmatter } = await import(pathToFileURL(createRequire(require.resolve("remark-frontmatter")).resolve("micromark-extension-frontmatter")).href);
      within(4 * SECONDS, () => parse(`---\n${paragraph(40_000)}\n`, [...extensions, frontmatter(["yaml"])]));
    }, 300 * SECONDS);
  }

  it("reads a long paragraph and a note behind an unclosed `---` in the app's parsers in time", () => {
    expect.hasAssertions();
    const paragraph = (lines: number) => Array.from({ length: lines }, (_, i) => `a quiet line ${i} with words`).join("\n");
    within(1.5 * SECONDS, () => parseMarkdownTree(paragraph(5_000)));
    within(3 * SECONDS, () => parseMarkdownTree(paragraph(10_000)));
    within(3 * SECONDS, () => parseMarkdownAst(`---\n${paragraph(10_000)}\n`, { preserveObsidianSyntax: true }));
    const dashed = `---\n${Array.from({ length: 8_000 }, (_, i) => `- item ${i}`).join("\n")}\n`;
    within(3 * SECONDS, () => parseMarkdownAst(dashed, { preserveObsidianSyntax: true }));
  }, 120 * SECONDS);
});
