/**
 * Where the note budget of the parse budget comes from (Gesamtplan Leistung
 * L14; `NOTE_BUDGET` and `noteLineCost` in `src/inlineParseBudget.ts`).
 *
 *   pnpm --filter @plainva/core perf:notes -- --calibrate [forms]   # per form: where main runs out, where the budget begins (long)
 *   pnpm --filter @plainva/core perf:notes -- --check             # every form, at the budget and far over it (minutes)
 *   pnpm --filter @plainva/core perf:notes -- --hunt <n> [--seed <s>] [--minutes <m>]
 *
 * The criterion, the table budget's one for a whole note: the index parse
 * (`parseMarkdownAst` with Obsidian syntax), the note-source parse
 * (`parseMarkdownTree`) and the reading view as the core can run it (the note
 * prepared, its own ranges and the note's, GFM, the HTML tree) each read the
 * note in a process whose V8 old space is capped at `HEAP_MB`.
 *
 * `--check`: for each form, the largest note the scan reads as it is (no range
 * of the note's budget) is read with the note's budget OFF at 1.3 times its
 * size — the margin — and a note of three and of ten times that size is read
 * WITH it, as the app reads it.
 *
 * `--calibrate`: for each form (or the forms named, comma-separated), the
 * most units the three parses read with the note's budget off under the capped
 * heap — the inline and table budgets kept, as `main` reads before L14: where
 * it runs out of memory — beside the most
 * the scan reads as it is, and the ratio of the two. Above 1 the budget reads
 * a note as text that `main` still reads formatted under the heap; the margin
 * of `--check` holds it at 1.3 or more, so that a note at the budget passes
 * with room to spare.
 *
 * `--hunt`: generated notes of a seed drawn anew (or given), blocks of every
 * kind mixed — prose, words, link literals, lists plain, linked, nested and
 * of tasks, quotes, headings, fenced code, small tables, blank lines or none
 * between them — from a tenth to five times the budget, each read as the app
 * reads it under the capped heap, in time (`HUNT_PARSE_MS`), and with a scan
 * whose time grows with the note (eight times the note, at most sixteen times
 * the time). A note that does not pass prints its seed and number.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { boundMarkdownInRanges, NOTE_BUDGET, NOTE_READING, overBudgetInlineRanges, READER_READING, restoreBoundedTree, unitedRanges, type MarkdownReading } from "../../src/inlineParseBudget.js";
import { parseMarkdownAst, parseMarkdownTree } from "../../src/markdown-parser.js";
import { prepareReaderSource } from "../../src/noteSource.js";
import { tablesNote } from "./many-tables.js";

export const HEAP_MB = 128;
const HUNT_PARSE_MS = 20_000;
/** The largest note `--check` reads: beyond it a note's text alone, read as one line of stand-ins, outgrows the heap (Performance_Notes.md). */
const FAR_CHARS = 10_000_000;
const HERE = fileURLToPath(import.meta.url);
const CORE = path.resolve(path.dirname(HERE), "../..");

const W = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"];
const words = (i: number, n: number) => Array.from({ length: n }, (_, k) => W[(i + k * 7) % W.length]).join(" ");

/** The forms of the calibration (2026-11-16): a note of `n` units each, behind a properties block and a heading. */
export const NOTE_FORMS: Record<string, (n: number) => string> = {
  prose: (n) => Array.from({ length: n }, (_, i) => words(i, 12)).join("\n"),
  xwords: (n) => "x ".repeat(n),
  xbrackets: (n) => "x]".repeat(n),
  paras: (n) => Array.from({ length: n }, (_, i) => words(i, 12)).join("\n\n"),
  emails: (n) => Array.from({ length: n }, (_, i) => `mail a${i}@b.cc and www.c${i}.de`).join("\n"),
  items: (n) => Array.from({ length: n }, (_, i) => `- item ${i}`).join("\n"),
  linked: (n) => Array.from({ length: n }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n"),
  tasks: (n) => Array.from({ length: n }, (_, i) => `- [ ] task ${i} due`).join("\n"),
  nested: (n) => Array.from({ length: n }, (_, i) => `${"  ".repeat(i % 6)}- item ${i}`).join("\n"),
  ordered: (n) => Array.from({ length: n }, (_, i) => `${i + 1}. item`).join("\n"),
  loose: (n) => Array.from({ length: n }, (_, i) => `- item ${i}`).join("\n\n"),
  quotes: (n) => Array.from({ length: n }, (_, i) => `> line ${i} of a quote`).join("\n"),
  quote3: (n) => Array.from({ length: n }, (_, i) => `> > > line ${i}`).join("\n"),
  headings: (n) => Array.from({ length: n }, (_, i) => `## Heading ${i}`).join("\n"),
  tables2: (n) => Array.from({ length: n }, (_, i) => `| a | b |\n|---|---|\n| ${i} | x |`).join("\n\n"),
  code: (n) => "```\n" + Array.from({ length: n }, (_, i) => `line ${i} of code`).join("\n") + "\n```",
  rules: (n) => Array.from({ length: n }, () => "---").join("\n\n"),
  links: (n) => Array.from({ length: n }, (_, i) => `see [[n${i}]] and [t](u${i})`).join("\n"),
  tagsl: (n) => Array.from({ length: n }, (_, i) => `#tag${i % 50} #a/b`).join("\n"),
  // Lines as people write them, syntax mixed (2026-11-16: the first calibration read a list of
  // 3 000 tasks with a link and emphasis as text, which the parses read without a budget up to 6 500).
  taskem: (n) => Array.from({ length: n }, (_, i) => `- [ ] task ${i} with [[link]] and *em*`).join("\n"),
  done: (n) => Array.from({ length: n }, (_, i) => `  - [x] done ${i} [[Project ${i % 40}]] 📅 2026-11-${String((i % 28) + 1).padStart(2, "0")}`).join("\n"),
  journal: (n) => Array.from({ length: n }, (_, i) => `- ${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")} Met [[Person ${i % 30}]] about #meeting, *notes* here`).join("\n"),
  emphasis: (n) => Array.from({ length: n }, (_, i) => `Sentence ${i} with *some* **bold**, _it_, ~~old~~ and \`code\`.`).join("\n"),
  urls: (n) => Array.from({ length: n }, (_, i) => `Read [the doc](https://example.com/${i}) and https://x.org/${i} today.`).join("\n"),
  sentences: (n) => Array.from({ length: n }, (_, i) => `Sentence ${i} with a [[Link ${i}]], *some* **bold** and a snake_case_name.`).join(" "),
  callouts: (n) => Array.from({ length: n }, (_, i) => `> [!note] Title ${i}\n> a line with [[x]] and *y*`).join("\n\n"),
  footnotes: (n) => Array.from({ length: n }, (_, i) => `Text with a note[^${i}] and more.\n\n[^${i}]: The note ${i}.`).join("\n\n"),
  embeds: (n) => Array.from({ length: n }, (_, i) => `![[image ${i}.png]] ![alt](pic${i}.jpg)`).join("\n"),
  html: (n) => Array.from({ length: n }, (_, i) => `<span class="a">text ${i}</span> and <b>bold</b>`).join("\n"),
  maths: (n) => Array.from({ length: n }, (_, i) => `where $x_${i}^2 + y$ holds and $\\frac{a}{b}$`).join("\n"),
  brackets: (n) => Array.from({ length: n }, () => "]".repeat(80)).join("\n\n"),
  // Paragraphs of one kind of inline syntax each, eighty characters: what a run of it weighs against a character of it alone.
  opens: (n) => Array.from({ length: n }, () => "[".repeat(80)).join("\n\n"),
  stars: (n) => Array.from({ length: n }, () => "*".repeat(80)).join("\n\n"),
  starred: (n) => Array.from({ length: n }, () => "*a".repeat(40)).join("\n\n"),
  images: (n) => Array.from({ length: n }, () => "![".repeat(40)).join("\n\n"),
  ticks: (n) => Array.from({ length: n }, () => "`a".repeat(40)).join("\n\n"),
  entities: (n) => Array.from({ length: n }, () => "&amp;".repeat(16)).join("\n\n"),
  escapes: (n) => Array.from({ length: n }, () => "\\*".repeat(40)).join("\n\n"),
  angles: (n) => Array.from({ length: n }, () => "<a".repeat(40)).join("\n\n"),
  densetables: (n) => Array.from({ length: n }, () => `| h |${" h |".repeat(15)}\n|${"---|".repeat(16)}\n${Array.from({ length: 50 }, () => `|${"a|".repeat(16)}`).join("\n")}`).join("\n\nSome prose between the tables.\n\n"),
  bigtables: (n) => Array.from({ length: n }, (_, t) => `| a | b | c |\n|---|---|---|\n${Array.from({ length: 1_200 }, (_, i) => `| ${i} | [[n${t}]] | some words |`).join("\n")}`).join("\n\nSome prose between the tables.\n\n"),
  // The performance script's note of many tables (`many-tables.ts`): 50 rows each, prose between them.
  manytables: (n) => tablesNote(n, 50),
  tables50: (n) => Array.from({ length: n }, (_, t) => `| a | b | c |\n|---|---|---|\n${Array.from({ length: 50 }, (_, i) => `| ${i} | [[n${t}]] | some words |`).join("\n")}`).join("\n\nSome prose between the tables.\n\n"),
};

const wrap = (body: string) => `---\ntitle: T\n---\n\n# Title\n\n${body}\n`;

/** A seeded generator (mulberry32). */
function random(...keys: number[]): () => number {
  let s = 0x9e3779b9;
  for (const k of keys) s = Math.imul(s ^ (k >>> 0), 0x85ebca6b) ^ (s >>> 13);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generated note `k` of `seed` at `scale` (a scale of 8 makes it eight times as long): blocks of every kind, mixed. */
function generatedNote(seed: number, k: number, scale = 1): string {
  const r = random(seed, k);
  const kinds = Object.keys(NOTE_FORMS);
  // From a tenth to five times the note's budget, at a weight of about 500 a line.
  const lines = Math.floor(((0.1 + r() * 4.9) * NOTE_BUDGET) / 500) * scale;
  const blocks: string[] = [];
  let made = 0;
  while (made < lines) {
    const kind = kinds[Math.floor(r() * kinds.length)];
    const size = 1 + Math.floor(r() * (r() < 0.1 ? 20_000 : 200));
    const block = kind === "xwords" || kind === "xbrackets" ? NOTE_FORMS[kind](size * 20) : NOTE_FORMS[kind](size);
    blocks.push(block);
    made += size;
  }
  return wrap(blocks.join(r() < 0.3 ? "\n" : "\n\n"));
}

/** A form's note, or a generated one as `gen:<seed>:<k>`. */
function noteOf(name: string, n: number, scale = 1): string {
  if (name.startsWith("gen:")) {
    const [, seed, k] = name.split(":");
    return generatedNote(Number(seed), Number(k), scale);
  }
  return wrap(NOTE_FORMS[name](n));
}

/** The reading with the note's budget off: the parse as `main` ran it before L14, the inline and the table budget kept. */
const WITHOUT_NOTES: MarkdownReading = { ...NOTE_READING, notes: false };
const READER_WITHOUT_NOTES: MarkdownReading = { ...READER_READING, notes: false };

/** The reading view as the core can run it (`boundReaderMarkdown` in packages/ui): its own ranges and the note's, the restore, the HTML tree. */
function boundedReader(text: string, notes = true): unknown {
  const source = prepareReaderSource(text);
  const own = overBudgetInlineRanges(source.text, undefined, notes ? READER_READING : READER_WITHOUT_NOTES);
  const theirs = overBudgetInlineRanges(text, undefined, notes ? NOTE_READING : WITHOUT_NOTES).map((range) => ({ ...range, from: source.toRendered(range.from), to: source.toRendered(range.to, "end") }));
  const bounded = boundMarkdownInRanges(source.text, unitedRanges(own, theirs.filter((range) => range.to > range.from)));
  const tree = unified().use(remarkParse).use(remarkGfm).parse(bounded.text);
  restoreBoundedTree(tree, bounded);
  toHast(tree as never);
  return tree;
}

/** The three parses with the note's budget off (`--calibrate`, the margin of `--check`). */
const withoutNoteBudget = {
  index: (text: string) => parseMarkdownAst(text, { preserveObsidianSyntax: true, reading: WITHOUT_NOTES }),
  tree: (text: string) => parseMarkdownTree(text, WITHOUT_NOTES),
  reader: (text: string) => boundedReader(text, false),
};

function child(name: string, n: number, scale: number, parse: string, bounded: boolean): void {
  const text = noteOf(name, n, scale);
  const started = performance.now();
  if (bounded) {
    if (parse === "index") parseMarkdownAst(text, { preserveObsidianSyntax: true });
    else if (parse === "tree") parseMarkdownTree(text);
    else boundedReader(text);
  } else {
    withoutNoteBudget[parse as keyof typeof withoutNoteBudget](text);
  }
  console.log(`ok ${Math.round(performance.now() - started)}`);
}

/** Whether all three parses read the note under the capped heap, each in a process of its own; the slowest's time. */
function passes(name: string, n: number, bounded: boolean, scale = 1): { ok: boolean; slowest: number; why: string } {
  let slowest = 0;
  for (const parse of ["index", "tree", "reader"]) {
    const run = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, "--import", "tsx", HERE, "--child", name, String(n), String(scale), parse, bounded ? "bounded" : "unbounded"], { cwd: CORE, encoding: "utf8", timeout: 300_000 });
    const out = /^ok (\d+)/m.exec(run.stdout ?? "");
    if (run.status !== 0 || !out) return { ok: false, slowest, why: `${parse}: ${/heap out of memory|Allocation failed/i.test(run.stderr ?? "") ? "out of memory" : `exit ${run.status}`}` };
    slowest = Math.max(slowest, Number(out[1]));
  }
  return { ok: true, slowest, why: "" };
}

/** The most units of a form the scan reads as it is: no range of the note's budget. */
function readAsItIs(form: string): number {
  // Read as it is: no range at all — of the note's budget, or of a paragraph's or a table's.
  const bounded = (n: number) => overBudgetInlineRanges(noteOf(form, n)).length > 0;
  let lo = 0;
  let hi = 64;
  while (!bounded(hi) && hi < 1 << 22) {
    lo = hi;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bounded(mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}

function check(): boolean {
  let all = true;
  console.log(`check    note budget ${NOTE_BUDGET}, ${HEAP_MB} MB; ${Object.keys(NOTE_FORMS).length} forms`);
  for (const form of Object.keys(NOTE_FORMS)) {
    const n = readAsItIs(form);
    const margin = passes(form, Math.ceil(n * 1.3), false);
    // Three and ten times as large, at most the 10 MB the note's budget is measured for.
    const within = (factor: number) => Math.max(n, Math.min(n * factor, Math.floor((n * FAR_CHARS) / Math.max(1, noteOf(form, n).length))));
    const over = passes(form, within(3), true);
    const far = passes(form, within(10), true);
    const ok = margin.ok && over.ok && far.ok;
    all &&= ok;
    console.log(`         ${form.padEnd(10)} read as it is up to ${String(n).padStart(7)}   at 1.3 x without the note budget ${margin.ok ? "pass" : `FAIL (${margin.why})`}   at 3 x ${over.ok ? "pass" : `FAIL (${over.why})`}   at 10 x ${far.ok ? "pass" : `FAIL (${far.why})`}`);
  }
  console.log(`check    ${all ? "every form passes" : "FAILED"}`);
  return all;
}

/** The most units of a form the three parses read without the budget under the capped heap, searched from `from` up. */
function readUnbounded(form: string, from: number): number {
  let lo = Math.max(1, Math.floor(from / 2));
  if (!passes(form, lo, false).ok) return 0;
  let hi = lo * 2;
  while (passes(form, hi, false).ok) {
    lo = hi;
    hi *= 2;
    if (noteOf(form, hi).length > FAR_CHARS) return hi;
  }
  // To within 2 %: each step reads the note three times, each in a process of its own.
  while (hi - lo > Math.max(1, Math.floor(lo / 50))) {
    const mid = (lo + hi) >> 1;
    if (passes(form, mid, false).ok) lo = mid;
    else hi = mid;
  }
  return lo;
}

function calibrate(args: string[]): void {
  const named = args[args.indexOf("--calibrate") + 1];
  const forms = named && !named.startsWith("--") ? named.split(",") : Object.keys(NOTE_FORMS);
  console.log(`calibrate note budget ${NOTE_BUDGET}, ${HEAP_MB} MB; ${forms.length} forms (units: lines, items, blocks or tables of the form)`);
  for (const form of forms) {
    const budget = readAsItIs(form);
    const main = readUnbounded(form, budget);
    const ratio = budget > 0 ? main / budget : Infinity;
    console.log(`         ${form.padEnd(10)} read as it is up to ${String(budget).padStart(7)}   without the note budget up to ${String(main).padStart(7)}   ratio ${ratio.toFixed(2)}`);
  }
}

/** Whether the scan's time grows with the note and not faster: the note and the same note eight times as long, the faster of two runs each. */
function scanIsLinear(name: string): string | null {
  const time = (text: string) => {
    let best = Infinity;
    for (let run = 0; run < 2; run++) {
      const started = performance.now();
      overBudgetInlineRanges(text);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const small = time(noteOf(name, 0));
  const large = time(noteOf(name, 0, 8));
  return large <= 16 * small + 200 ? null : `the scan took ${Math.round(small)} ms and ${Math.round(large)} ms at eight times the size`;
}

function hunt(args: string[]): boolean {
  const at = (flag: string, fallback: number) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
  const count = at("--hunt", 40);
  const minutes = at("--minutes", 20);
  const seed = at("--seed", Date.now() % 1_000_000);
  const started = performance.now();
  const failed: string[] = [];
  let tried = 0;
  console.log(`hunt     ${count} generated notes, seed ${seed}, at most ${minutes} min; note budget ${NOTE_BUDGET}`);
  for (let k = 0; k < count && performance.now() - started < minutes * 60_000; k++) {
    const name = `gen:${seed}:${k}`;
    const run = passes(name, 0, true);
    tried++;
    const why = !run.ok ? run.why : run.slowest > HUNT_PARSE_MS ? `a parse took ${run.slowest} ms` : scanIsLinear(name);
    if (why) {
      failed.push(name);
      console.log(`FAIL     ${name} (${noteOf(name, 0).length} chars): ${why}`);
    }
  }
  console.log(`hunt     ${tried} notes in ${Math.round((performance.now() - started) / 1000)} s: ${failed.length ? `${failed.length} FAILED (${failed.join(", ")})` : "every note passes"}`);
  return failed.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--child") child(args[1], Number(args[2]), Number(args[3]), args[4], args[5] === "bounded");
  else if (args.includes("--calibrate")) calibrate(args);
  else if (args.includes("--hunt")) {
    if (!hunt(args)) process.exitCode = 1;
  } else if (!check()) process.exitCode = 1;
}
