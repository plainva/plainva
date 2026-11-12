/**
 * What reading a note with many GFM tables costs (Gesamtplan Leistung L13).
 *
 *   pnpm --filter @plainva/core perf:tables -- [--json out.json] [--quick] [--no-fixture]
 *   pnpm --filter @plainva/core perf:tables -- --calibrate | --check   (the table budget, `table-budget.ts`)
 *
 * Parses generated notes through the entry points the app reads a note with:
 * `parseMarkdownAst(…, { preserveObsidianSyntax: true })` (the index pass and
 * the workspace worker) and `parseMarkdownTree` (the note source: journal,
 * outline, embedded sections, the reading view's anchors). `parseCommonMarkTree`
 * reads the same text without the GFM extensions, as the floor.
 *
 * Three series separate what the time grows with:
 * - `tables`: 1 … 80 tables of 50 rows, 20 lines of prose between them;
 * - `rows`: one table of 400 … 6 400 rows;
 * - `before`: one table of 50 rows behind 0 … 8 000 lines of prose.
 * Plus the fixture vault's long note (80 tables of 200 rows, `fixtureVault.ts`).
 *
 * Each case takes the median of up to five parses (fewer once they took ten
 * seconds together). With `--expose-gc` in `NODE_OPTIONS` the heap is collected
 * before each parse, so one case does not pay for the garbage of the one before.
 * Deterministic text: a seeded generator, no clock.
 */
import * as fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { parseCommonMarkTree, parseMarkdownAst, parseMarkdownTree } from "../../src/markdown-parser.js";
import { fixtureFiles } from "./fixtureVault.js";
import { runTableBudget } from "./table-budget.js";

const WORDS = ["project", "review", "garden", "meeting", "budget", "draft", "owner", "status", "plan", "notes", "report", "idea", "task", "week", "travel"];
const STATUS = ["open", "done", "waiting", "blocked"];

function generator(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)],
  };
}
type Random = ReturnType<typeof generator>;

const sentence = (r: Random, words: number) => {
  const parts = Array.from({ length: words }, () => r.pick(WORDS));
  return parts.join(" ") + ".";
};

const table = (r: Random, rows: number) => {
  const lines = ["| Item | Owner | Status | Note |", "|---|:---|:---:|---:|"];
  for (let i = 0; i < rows; i++) lines.push(`| ${r.pick(WORDS)} ${i} | [[Note ${r.int(1, 999)}]] | ${r.pick(STATUS)} | ${sentence(r, r.int(3, 9))} |`);
  return lines.join("\n");
};

/** A note: `tables` tables of `rows` rows, `prose` lines of prose in front of each. */
export function tablesNote(tables: number, rows: number, prose = 20, seed = 1): string {
  const r = generator(seed);
  const out = ["# Many tables", ""];
  for (let t = 0; t < tables; t++) {
    out.push(`## Section ${t + 1}`, "");
    for (let p = 0; p < prose; p++) out.push(sentence(r, r.int(8, 20)), "");
    out.push(table(r, rows), "");
  }
  return out.join("\n");
}

const PARSERS = {
  index: (text: string) => parseMarkdownAst(text, { preserveObsidianSyntax: true }),
  tree: (text: string) => parseMarkdownTree(text),
  commonMark: (text: string) => parseCommonMarkTree(text),
} as const;
type ParserName = keyof typeof PARSERS;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(parse: (text: string) => unknown, text: string, rounds: number): number {
  const times: number[] = [];
  let spent = 0;
  for (let i = 0; i < rounds && spent < 10_000; i++) {
    // A collection left over from the case before would land in this one's time.
    (globalThis as { gc?: () => void }).gc?.();
    const t = performance.now();
    parse(text);
    times.push(performance.now() - t);
    spent += times[times.length - 1];
  }
  return Number(median(times).toFixed(1));
}

interface Row { series: string; case: string; lines: number; kb: number; ms: Record<ParserName, number> }

async function main(): Promise<void> {
const args = process.argv.slice(2);
// The table budget's calibration under a capped heap (`table-budget.ts`).
if (args.includes("--calibrate") || args.includes("--check")) {
  runTableBudget(args);
  return;
}
const quick = args.includes("--quick");
const rounds = quick ? 1 : 5;
const cases: Array<{ series: string; name: string; text: () => string }> = [];
for (const n of [1, 10, 20, 40, 80]) cases.push({ series: "tables", name: `${n} x 50 rows`, text: () => tablesNote(n, 50) });
for (const n of [400, 1600, 6400]) cases.push({ series: "rows", name: `1 x ${n} rows`, text: () => tablesNote(1, n, 0) });
for (const n of [0, 2000, 8000]) cases.push({ series: "before", name: `${n} prose lines + 1 x 50 rows`, text: () => tablesNote(1, 50, n) });
if (!args.includes("--no-fixture")) cases.push({
  series: "fixture",
  name: "Long table note (80 x 200 rows)",
  text: () => {
    for (const file of fixtureFiles({ count: 20 })) if (file.path.endsWith("Long table note.md")) return file.data as string;
    throw new Error("The fixture has no long table note");
  },
});

// Warm the parsers up once, so the first case does not pay the JIT.
for (const parse of Object.values(PARSERS)) parse(tablesNote(2, 20));

const results: Row[] = [];
for (const c of cases) {
  const text = c.text();
  const ms = {} as Record<ParserName, number>;
  for (const [name, parse] of Object.entries(PARSERS) as Array<[ParserName, (t: string) => unknown]>) ms[name] = measure(parse, text, rounds);
  const row = { series: c.series, case: c.name, lines: text.split("\n").length, kb: Math.round(text.length / 1024), ms };
  results.push(row);
  console.log(`${c.series.padEnd(8)} ${c.name.padEnd(34)} ${String(row.lines).padStart(6)} lines ${String(row.kb).padStart(5)} KB  index ${ms.index} ms  tree ${ms.tree} ms  commonMark ${ms.commonMark} ms`);
}
const jsonAt = args.indexOf("--json");
if (jsonAt >= 0) await fs.writeFile(args[jsonAt + 1], JSON.stringify({ node: process.version, results }, null, 2) + "\n");
}

// Run when called as a script; a profile or a test imports `tablesNote` alone.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
