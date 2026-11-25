/**
 * Where the note budget of the parse budget comes from (`NOTE_BUDGET`,
 * `DESKTOP_NOTE_BUDGET` and `noteLineCost` in `src/inlineParseBudget.ts`).
 *
 *   pnpm --filter @plainva/core perf:notes -- --calibrate [forms] --shell <name> [--out <file>] [--hint-factor <k>] [--safe-at <x>] [--child-ms <ms>]   # per form: where main runs out, where the budget begins (long)
 *   pnpm --filter @plainva/core perf:notes -- --check [--shell phone|desktop] [--group k/n] [--forms a,b]   # every form at its threshold and far over it (minutes)
 *   pnpm --filter @plainva/core perf:notes -- --hunt <n> [--shell <name>] [--seed <s>] [--minutes <m>]
 *   pnpm --filter @plainva/core perf:notes -- --features <forms> <units>   # what a unit of each form weighs by each weight (for a fit)
 *
 * A shell (`noteBudgetShells.json`) is a heap, the readers it reads a note
 * with and its budget as a multiple of `NOTE_BUDGET`: the phone the index (the
 * parse, and the reading of its links and tags) and the note source (the
 * parse, its headings and block ids) under 128 MB; the desktop those and the
 * reading view as the core can run it (the note prepared, its own ranges and
 * the note's, GFM, the HTML tree) under 512 MB; the editor's own parse of the
 * whole note as a named limit. Each reader reads the note in a process of its
 * own whose V8 old space is capped at the heap.
 *
 * `--calibrate`: for each form (or the forms named), the most units the
 * shell's readers read with the note's budget off under the heap — the inline
 * and table budgets kept, as `main` reads: where it runs out of memory —,
 * searched from the last limit of the phone (times `--hint-factor`), beside
 * the most the shell's budget reads with no block as text (its threshold), and
 * the ratio of the two, one JSON line a form to `--out`. At 1 or more a note at
 * the threshold passes (the safe side); above 1 the budget reads a note as text
 * that `main` still reads formatted under the heap. `--safe-at <x>`: only
 * whether the readers read x times the threshold, for a form whose exact limit
 * does not bind the shell's budget. A reader slower than `--child-ms` counts
 * as one that does not read the note, apart from one that runs out of memory.
 * The weights are fitted with `--features` to bring every form to 1.13 or a
 * little more (`main`'s limit is measured to some 5 to 8 %) and the early side
 * as low as weights of countable parts allow, and held at three and ten times
 * over every form by `--check` (2026-11-25 on the phone: 1.14 to 2.82).
 *
 * `--check`: for each form of the shell, the note at its threshold times 1.05
 * — times its ratio for a form measured on its safe side alone — is read
 * formatted in three runs, as `main` reads it; on the phone each reader reads
 * the note at its threshold as the app does under the least heap `main`'s
 * reader needs there (no more need than `main`); notes of three and of ten
 * times the threshold are read as the app reads them, and the scan with the
 * note's budget takes at most `SCAN_FACTOR` times the scan without it. Each
 * must pass under the heap — V8 close to the end of its heap varies, and a form
 * that passes in some runs and not in others is named —, and the ratio of
 * `main`'s limit to the threshold must stay between 1.0 and the measured ratio
 * plus 5 %, so that a change of the weights that reads a form as text earlier
 * than calibrated shows.
 *
 * `--hunt`: generated notes of a seed drawn anew (or given), blocks of every
 * kind mixed — prose, words, link literals, lists plain, linked, nested and
 * of tasks, quotes, headings, fenced code, small tables, blank lines or none
 * between them — from a tenth to five times the shell's budget, each read as
 * the app reads it under the shell's heap — the reading view up to 5 MB of note
 * at 128 MB, the index and the note parse up to 10 MB —, in time
 * (`HUNT_PARSE_MS`), and with a scan whose time grows with the note (eight
 * times the note, at most sixteen times the time). A note that does not pass
 * prints its seed and number.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { boundMarkdownInRanges, NOTE_BUDGET, NOTE_READING, overBudgetInlineRanges, READER_READING, noteWeights, restoreBoundedTree, setNoteBudget, unitedRanges, withNoteWeights, type MarkdownReading, type NoteWeights } from "../../src/inlineParseBudget.js";
import { parseMarkdownAst } from "../../src/markdown-parser.js";
import { extractLinksAndTags } from "../../src/ast-scanner.js";
import { analyzeNoteSource, prepareReaderSource } from "../../src/noteSource.js";
import { tablesNote } from "./many-tables.js";

export const HEAP_MB = 128;
/** The heap the parses run under, and the multiple of `NOTE_BUDGET` the app reads with (`--heap`, `--factor`). */
let heapMb = HEAP_MB;
/**
 * The readers the calibration and the check read a note with: a shell's own
 * (`--parses`). The phone reads with the index and the note parse (its read
 * mode is its editor); the desktop with those and the reading view.
 */
let shellParses: readonly string[] = ["index", "tree", "reader"];
let budgetFactor = Number(process.env.PLAINVA_NOTE_BUDGET_FACTOR ?? 1);
if (budgetFactor !== 1) setNoteBudget(NOTE_BUDGET * budgetFactor);
/**
 * How long a parse of the hunt may take: linear in the note, for a parse that grows faster than the note is what it
 * looks for. micromark reads 2 to 4 µs a character on the runner (a note of 6 MB in about 25 s, which on `main`
 * runs out of 128 MB instead), and what a shell's budget reads formatted grows with the budget.
 */
const HUNT_PARSE_MS = 5_000;
const HUNT_PARSE_MS_PER_MB = 6_000;
/** The largest note `--check` reads: beyond it a note's text alone, read as one line of stand-ins, outgrows the heap (Performance_Notes.md). */
const FAR_CHARS = 10_000_000;
/**
 * The largest note the hunt reads in the reading view under the heap: the
 * reading view exists on the desktop only, and from about 6 MB of a mixed note
 * the copies of its text alone fill 128 MB there (the hunt of seed 823320,
 * 2026-11-19: three notes of 6.3 to 9.0 MB); the index and the note parse are
 * held up to `FAR_CHARS`.
 */
const READER_HELD_CHARS = 5_000_000;
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

/** The forms whose unit is a whole table. */
const TABLE_FORMS = new Set(["densetables", "bigtables", "manytables", "tables50"]);

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
  const lines = Math.floor(((0.1 + r() * 4.9) * NOTE_BUDGET * budgetFactor) / 500) * scale;
  const blocks: string[] = [];
  let made = 0;
  let chars = 0;
  while (made < lines) {
    const kind = kinds[Math.floor(r() * kinds.length)];
    // A unit of a table form is a whole table (of 50 or 1 200 rows): a few of them make a note of megabytes.
    const most = TABLE_FORMS.has(kind) ? 4 : r() < 0.1 ? 20_000 : 200;
    const size = 1 + Math.floor(r() * most);
    const block = kind === "xwords" || kind === "xbrackets" ? NOTE_FORMS[kind](size * 20) : NOTE_FORMS[kind](size);
    // At most the 10 MB the note's budget is measured for (`FAR_CHARS`), at `scale` times that for the scan's time.
    if (chars + block.length > FAR_CHARS * scale) break;
    blocks.push(block);
    chars += block.length + 2;
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

/**
 * The readers as the app runs them: the index parses the note and reads its
 * links and tags, a block read as text in pieces (`extractLinksAndTags` with
 * the note); the note source parses it and reads its headings and block ids,
 * the same way (`analyzeNoteSource`); the reading view (`boundedReader`).
 */
const asTheAppReads = {
  index: (text: string) => {
    const ast = parseMarkdownAst(text, { preserveObsidianSyntax: true });
    extractLinksAndTags(ast, text);
  },
  tree: (text: string) => analyzeNoteSource(text),
  reader: (text: string) => boundedReader(text),
};

/** The same readers with the note's budget off (`--calibrate`, the margin of `--check`): as `main` reads before L14. */
const withoutNoteBudget = {
  index: (text: string) => {
    const ast = parseMarkdownAst(text, { preserveObsidianSyntax: true, reading: WITHOUT_NOTES });
    extractLinksAndTags(ast);
  },
  tree: (text: string) => {
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    analyzeNoteSource(text);
  },
  reader: (text: string) => boundedReader(text, false),
};

/**
 * The editor's own parse of a note, as both shells build their editor
 * (`editorSession.ts`): CodeMirror's Markdown with the app's syntax extensions,
 * its tree over the whole text. The note's budget does not change it — the
 * editor parses every note whole, as on `main` —, so it is measured for its
 * own limit, not for the budget's. What the live preview draws is built for
 * the lines in view only and is not measured.
 */
async function editorParse(text: string): Promise<void> {
  const ui = createRequire(path.resolve(path.dirname(HERE), "../../../ui/package.json"));
  const load = async (name: string) => import(pathToFileURL(ui.resolve(name)).href);
  const { EditorState } = await load("@codemirror/state");
  const { ensureSyntaxTree } = await load("@codemirror/language");
  const { markdown, markdownLanguage } = await load("@codemirror/lang-markdown");
  // The app's own syntax extensions, from the UI package (by their path: the core's type check does not read the UI's).
  const fromUi = async (file: string) => import(pathToFileURL(path.resolve(path.dirname(HERE), "../../../ui/src", file)).href);
  const { frontmatterBlock } = await fromUi("components/frontmatterBlockParser.ts");
  const { boundedInlineSyntax } = await fromUi("lib/boundedMarkdown.ts");
  const { wikiLinkInlineSyntax } = await fromUi("components/wikiLinkInline.ts");
  const state = EditorState.create({ doc: text, extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterBlock, boundedInlineSyntax, wikiLinkInlineSyntax] })] });
  if (!ensureSyntaxTree(state, state.doc.length, 600_000)) throw new Error("the editor's parse did not finish");
}

async function child(name: string, n: number, scale: number, parse: string, bounded: boolean): Promise<void> {
  const text = noteOf(name, n, scale);
  const started = performance.now();
  if (parse === "editor") await editorParse(text);
  else if (bounded) asTheAppReads[parse as keyof typeof asTheAppReads](text);
  else withoutNoteBudget[parse as keyof typeof withoutNoteBudget](text);
  console.log(`ok ${Math.round(performance.now() - started)}`);
}

/** Whether all three parses read the note under the capped heap, each in a process of its own; the slowest's time. */
function passes(name: string, n: number, bounded: boolean, scale = 1, parses: readonly string[] = shellParses): { ok: boolean; slowest: number; why: string } {
  let slowest = 0;
  for (const parse of parses) {
    const run = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, "--import", "tsx", HERE, "--child", name, String(n), String(scale), parse, bounded ? "bounded" : "unbounded"], { cwd: CORE, encoding: "utf8", timeout: 300_000, env: { ...process.env, PLAINVA_NOTE_BUDGET_FACTOR: String(budgetFactor) } });
    const out = /^ok (\d+)/m.exec(run.stdout ?? "");
    if (run.status !== 0 || !out) return { ok: false, slowest, why: `${parse}: ${/heap out of memory|Allocation failed/i.test(run.stderr ?? "") ? "out of memory" : `exit ${run.status}`}` };
    slowest = Math.max(slowest, Number(out[1]));
  }
  return { ok: true, slowest, why: "" };
}

/**
 * The most units of a form the note's budget reads as they are: no block read
 * as text. A paragraph's or a table's own budget may read part of it as
 * written below that, as on `main`, which has them too.
 */
function readAsItIs(form: string): number {
  const bounded = (n: number) => overBudgetInlineRanges(noteOf(form, n)).some((range) => range.block);
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

/** The shells the note's budget is calibrated for, and what was measured for each (`noteBudgetShells.json`). */
interface ShellCalibration {
  /** The heap the shell's readers are held to, in MB. */
  heap: number;
  /** The readers the shell reads a note with (`asTheAppReads`). */
  parses: string[];
  /** The shell's note budget, a multiple of `NOTE_BUDGET` (`setNoteBudget` at its start). */
  factor: number;
  measured: string;
  /** Per form: `main`'s limit under the heap (the readers with the note's budget off), the threshold at the calibration, their ratio. */
  forms: Record<string, { main: number; branch: number; ratio: number; lowerBound?: boolean }>;
}
const SHELLS_FILE = path.join(path.dirname(HERE), "noteBudgetShells.json");
const shellsCalibrated = (): Record<string, ShellCalibration> => JSON.parse(readFileSync(SHELLS_FILE, "utf8")).shells as Record<string, ShellCalibration>;

/** The heaps the least heap of a reader is searched among (`leastHeap`). */
const HEAPS = [32, 48, 64, 96, 128, 192, 256, 384, 512];

/** The least heap of `HEAPS` up to the shell's that `parse` reads the note under, the note's budget on or off; 0 where none. */
function leastHeap(name: string, n: number, parse: string, bounded: boolean): number {
  const kept = heapMb;
  try {
    for (const heap of HEAPS.filter((mb) => mb <= kept)) {
      heapMb = heap;
      if (passes(name, n, bounded, 1, [parse]).ok) return heap;
    }
    return 0;
  } finally {
    heapMb = kept;
  }
}

/**
 * Whether the scan of the note's budget costs its note no more than the scan
 * without it, in time: the note far over its budget scanned with and without
 * the note's budget, the faster of three runs each.
 */
function scanTime(text: string): { with: number; without: number } {
  const best = (run: () => void) => {
    let fastest = Infinity;
    for (let k = 0; k < 3; k++) {
      const started = performance.now();
      run();
      fastest = Math.min(fastest, performance.now() - started);
    }
    return fastest;
  };
  return { with: best(() => overBudgetInlineRanges(text)), without: best(() => overBudgetInlineRanges(text, undefined, WITHOUT_NOTES)) };
}
/** How much longer the scan with the note's budget may take than without it: the weighing reads every character once more. */
const SCAN_FACTOR = 3;
const SCAN_SLACK_MS = 30;

/** The shell named by `--shell` (the phone unless named): its heap, its readers and its note budget, for this run. */
function useShell(args: string[]): { name: string; calibration: ShellCalibration } {
  const name = args.includes("--shell") ? args[args.indexOf("--shell") + 1] : "phone";
  const calibration = shellsCalibrated()[name];
  if (!calibration) throw new Error(`no shell ${name} in noteBudgetShells.json`);
  heapMb = calibration.heap;
  shellParses = calibration.parses;
  budgetFactor = calibration.factor;
  setNoteBudget(NOTE_BUDGET * budgetFactor);
  return { name, calibration };
}

function check(args: string[]): boolean {
  const { name, calibration } = useShell(args);
  const only = args.includes("--forms") ? args[args.indexOf("--forms") + 1].split(",") : null;
  // `--group k/n`: the k-th of n parts of the forms, every n-th from the k-th (the performance workflow runs them side by side).
  const [part, parts] = args.includes("--group") ? args[args.indexOf("--group") + 1].split("/").map(Number) : [1, 1];
  const forms = Object.entries(calibration.forms).filter(([form], i) => (!only || only.includes(form)) && i % parts === part - 1);
  let all = true;
  console.log(`check    ${name}: note budget ${NOTE_BUDGET * budgetFactor}, ${heapMb} MB, ${shellParses.join(" ")}; ${forms.length} forms`);
  for (const [form, { main, ratio, lowerBound }] of forms) {
    const n = readAsItIs(form);
    // The safe side, stable rather than close: the note at its threshold times 1.05, read formatted (the note's
    // budget off, as `main` reads it), passes in three runs of three, each a process of its own.
    // A form measured on its safe side alone (`lowerBound`) is read at the ratio it holds to, 1.13: each check measures
    // that lower bound anew.
    const margin = lowerBound ? ratio : 1.05;
    const runs = [0, 1, 2].map(() => passes(form, Math.ceil(n * margin), false));
    const passed = runs.filter((run) => run.ok).length;
    const at1 = { ok: passed === 3, why: passed === 0 ? runs[0].why : `${3 - passed} of 3 runs ${runs.find((run) => !run.ok)?.why}, the form varies` };
    // No more need than main: each reader of the app reads the note at its threshold, nothing of it read as text,
    // under the least heap main's reader reads it under — where memory is short, on the phone's 128 MB.
    const more: string[] = [];
    for (const parse of heapMb <= HEAP_MB ? shellParses : []) {
      const least = leastHeap(form, n, parse, false);
      const kept = heapMb;
      heapMb = least;
      // Close to its heap's end V8 varies, and at the threshold the app's reader runs main's way (nothing is read as
      // text): both are read five times under main's least heap, and the app's may pass twice less than main's (with
      // three runs each, one form in a run of the workflow failed where the run before passed it).
      const count = (bounded: boolean) => [0, 1, 2, 3, 4].filter(() => passes(form, n, bounded, 1, [parse]).ok).length;
      const own = least > 0 && count(true) >= count(false) - 2;
      heapMb = kept;
      if (!own) more.push(`${parse} needs more than ${least} MB`);
    }
    // Three and ten times as large, at most the 10 MB the note's budget is measured for.
    const within = (factor: number) => Math.max(n, Math.min(n * factor, Math.floor((n * FAR_CHARS) / Math.max(1, noteOf(form, n).length))));
    const over = passes(form, within(3), true);
    const far = passes(form, within(10), true);
    const now = main / Math.max(1, n);
    // A form measured on its safe side only (`lowerBound`) has a lower bound for `main`, no ratio to hold it to.
    const inRatio = now >= 1 && (lowerBound || now <= ratio * 1.05);
    // The scan's time far over the budget, with the note's budget against without it.
    const scan = scanTime(noteOf(form, within(10)));
    const scanOk = scan.with <= SCAN_FACTOR * scan.without + SCAN_SLACK_MS;
    const ok = at1.ok && more.length === 0 && over.ok && far.ok && inRatio && scanOk;
    all &&= ok;
    console.log(
      `         ${form.padEnd(11)} formatted up to ${String(n).padStart(7)}   main ${String(main).padStart(7)}   ratio ${now.toFixed(2)} (calibrated ${ratio.toFixed(2)})${inRatio ? "" : " FAIL"}` +
        `   at it x ${margin} ${at1.ok ? "pass 3/3" : `FAIL (${at1.why})`}   at it ${more.length ? `FAIL (${more.join(", ")})` : heapMb <= HEAP_MB ? "no more than main" : "(need not measured)"}` +
        `   at 3 x ${over.ok ? "pass" : `FAIL (${over.why})`}   at 10 x ${far.ok ? "pass" : `FAIL (${far.why})`}` +
        `   scan ${Math.round(scan.with)} / ${Math.round(scan.without)} ms${scanOk ? "" : " FAIL"}`,
    );
  }
  console.log(`check    ${all ? "every form passes" : "FAILED"}`);
  return all;
}

/** The most units of a form the three parses read without the budget under the capped heap, searched from `from` up. */
/** One reader on one note in a process of its own under the capped heap, the others beside it (`passesTogether`). */
function readerRun(name: string, n: number, parse: string, bounded: boolean): Promise<boolean> {
  return readerOutcome(name, n, parse, bounded).then((outcome) => outcome === "ok");
}

/** How one reader on one note ends: it read the note, ran out of memory, took longer than `childMs`, or ended otherwise. */
function readerOutcome(name: string, n: number, parse: string, bounded: boolean): Promise<"ok" | "memory" | "time" | "exit"> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, "--import", "tsx", HERE, "--child", name, String(n), "1", parse, bounded ? "bounded" : "unbounded"], { cwd: CORE, env: { ...process.env, PLAINVA_NOTE_BUDGET_FACTOR: String(budgetFactor) } });
    let out = "";
    let err = "";
    let late = false;
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-2000)));
    // A reader slower than this counts as one that does not read the note (`--child-ms`): under 512 MB a paragraph of
    // 100 000 lines takes micromark minutes (its text initializer merges in the square of the lines).
    const timer = setTimeout(() => {
      late = true;
      child.kill("SIGKILL");
    }, childMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && /^ok \d+/m.test(out)) resolve("ok");
      else if (late) resolve("time");
      else resolve(/heap out of memory|Allocation failed/i.test(err) ? "memory" : "exit");
    });
  });
}

/** How long a reader of the calibration may take before it counts as one that does not read the note (`--child-ms`). */
let childMs = 300_000;

/** Whether every reader of the shell reads the note under the heap: the readers side by side, each its own process. */
async function passesTogether(name: string, n: number, bounded: boolean): Promise<boolean> {
  return (await Promise.all(shellParses.map((parse) => readerRun(name, n, parse, bounded)))).every(Boolean);
}

/**
 * The most units of a form the shell's readers read without the note's budget
 * under the capped heap: from `hint` (the limit of an earlier calibration,
 * scaled to this heap) a bracket of a quarter at a time up or down, then
 * halved to within 2 %; without a hint from `from` up, doubling.
 */
async function readUnbounded(form: string, from: number, hint?: number): Promise<number> {
  const far = (n: number) => noteOf(form, n).length > FAR_CHARS;
  let lo: number;
  let hi: number;
  if (hint) {
    const start = Math.max(1, Math.round(hint));
    if (await passesTogether(form, start, false)) {
      lo = start;
      hi = Math.ceil(start * 1.25);
      while (await passesTogether(form, hi, false)) {
        lo = hi;
        if (far(hi)) return hi;
        hi = Math.ceil(hi * 1.25);
      }
    } else {
      hi = start;
      lo = Math.max(1, Math.floor(start / 1.25));
      while (!(await passesTogether(form, lo, false))) {
        hi = lo;
        if (lo === 1) return 0;
        lo = Math.max(1, Math.floor(lo / 1.25));
      }
    }
  } else {
    lo = Math.max(1, Math.floor(from / 2));
    if (!(await passesTogether(form, lo, false))) return 0;
    hi = lo * 2;
    while (await passesTogether(form, hi, false)) {
      lo = hi;
      hi *= 2;
      if (far(hi)) return hi;
    }
  }
  // To within 2 %.
  while (hi - lo > Math.max(1, Math.floor(lo / 50))) {
    const mid = (lo + hi) >> 1;
    if (await passesTogether(form, mid, false)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * `--features <forms> <units>`: what a unit of each form weighs by each of the
 * note's weights — the note weighed with that weight 1 and every other 0 —,
 * and by its characters alone (every weight 0), as JSON lines: the parts a
 * fit of the weights against `--calibrate`'s limits reads.
 */
function features(args: string[]): void {
  const at = args.indexOf("--features");
  const forms = args[at + 1].split(",");
  const units = args[at + 2].split(",").map(Number);
  const zero = Object.fromEntries(Object.keys(noteWeights()).map((key) => [key, 0])) as Partial<NoteWeights>;
  forms.forEach((form, f) => {
    const n = units[f] ?? units[0];
    const text = noteOf(form, n);
    const total = (weights: Partial<NoteWeights>) => withNoteWeights(weights, () => {
      let found = 0;
      overBudgetInlineRanges(text, { note: (value) => (found = value) });
      return found;
    });
    const base = total(zero);
    const parts: Record<string, number> = { chars: base / n };
    for (const key of Object.keys(zero)) parts[key] = (total({ ...zero, [key]: 1 }) - base) / n;
    console.log(JSON.stringify({ form, n, parts }));
  });
}

async function calibrate(args: string[]): Promise<void> {
  const { name } = useShell(args);
  // Where to begin each form's search: the phone's limits of the last calibration, times `--hint-factor`.
  const hints = shellsCalibrated().phone.forms;
  const hintFactor = args.includes("--hint-factor") ? Number(args[args.indexOf("--hint-factor") + 1]) : 1;
  if (args.includes("--child-ms")) childMs = Number(args[args.indexOf("--child-ms") + 1]);
  // `--safe-at <x>`: no search, only whether the readers read the note at x times its threshold with the note's budget
  // off — the safe side of a form whose exact limit does not bind the shell's budget.
  const safeAt = args.includes("--safe-at") ? Number(args[args.indexOf("--safe-at") + 1]) : 0;
  const named = args[args.indexOf("--calibrate") + 1];
  const forms = named && !named.startsWith("--") ? named.split(",") : Object.keys(NOTE_FORMS);
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  console.log(`calibrate ${name}: note budget ${NOTE_BUDGET * budgetFactor}, ${heapMb} MB, ${shellParses.join(" ")}; ${forms.length} forms (units: lines, items, blocks or tables of the form)`);
  for (const form of forms) {
    const budget = readAsItIs(form);
    if (safeAt) {
      const at = Math.ceil(budget * safeAt);
      const outcomes = await Promise.all(shellParses.map((parse) => readerOutcome(form, at, parse, false)));
      const ok = outcomes.every((outcome) => outcome === "ok");
      console.log(`         ${form.padEnd(10)} read as it is up to ${String(budget).padStart(7)}   without the note budget at ${safeAt} times that, ${at}: ${ok ? "pass" : `FAIL (${shellParses.map((parse, i) => `${parse} ${outcomes[i]}`).join(", ")})`}`);
      if (out) appendFileSync(out, `${JSON.stringify({ shell: name, form, main: at, branch: budget, ratio: safeAt, lowerBound: true, outcomes: Object.fromEntries(shellParses.map((parse, i) => [parse, outcomes[i]])) })}\n`);
      continue;
    }
    const main = await readUnbounded(form, budget, hints[form] ? hints[form].main * hintFactor : undefined);
    const ratio = budget > 0 ? main / budget : Infinity;
    console.log(`         ${form.padEnd(10)} read as it is up to ${String(budget).padStart(7)}   without the note budget up to ${String(main).padStart(7)}   ratio ${ratio.toFixed(2)}`);
    if (out) appendFileSync(out, `${JSON.stringify({ shell: name, form, main, branch: budget, ratio: Math.round(ratio * 100) / 100 })}\n`);
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
  // The shell's heap, readers and budget (`--shell`, the phone unless named); the notes are drawn to its budget.
  const { name: shell } = useShell(args);
  const started = performance.now();
  const failed: string[] = [];
  let tried = 0;
  console.log(`hunt     ${shell}: ${count} generated notes, seed ${seed}, at most ${minutes} min; note budget ${NOTE_BUDGET * budgetFactor}, ${heapMb} MB, ${shellParses.join(" ")}`);
  for (let k = 0; k < count && performance.now() - started < minutes * 60_000; k++) {
    const name = `gen:${seed}:${k}`;
    // The reading view exists on the desktop only; under 128 MB it is held up to 5 MB of note (`READER_HELD_CHARS`), under a larger heap in proportion.
    const parses = noteOf(name, 0).length > (READER_HELD_CHARS * heapMb) / HEAP_MB ? shellParses.filter((parse) => parse !== "reader") : shellParses;
    const run = passes(name, 0, true, 1, parses);
    tried++;
    // The time of a parse grows with what a shell's budget reads formatted: at four times the phone's, the desktop reads
    // notes of 10 MB formatted that took the phone's readers no more than the phone's budget — on main as long.
    const most = (HUNT_PARSE_MS + (HUNT_PARSE_MS_PER_MB * noteOf(name, 0).length) / 1e6) * budgetFactor;
    const why = !run.ok ? run.why : run.slowest > most ? `a parse took ${run.slowest} ms, more than ${Math.round(most)}` : scanIsLinear(name);
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
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (flag("--parses")) shellParses = flag("--parses")!.split(",");
  if (flag("--heap") && !args.includes("--check") && !args.includes("--calibrate")) heapMb = Number(flag("--heap"));
  if (args[0] === "--child") await child(args[1], Number(args[2]), Number(args[3]), args[4], args[5] === "bounded");
  else if (args.includes("--calibrate")) await calibrate(args);
  else if (args.includes("--features")) features(args);
  else if (args.includes("--hunt")) {
    if (!hunt(args)) process.exitCode = 1;
  } else if (!check(args)) process.exitCode = 1;
}
