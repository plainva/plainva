/**
 * Why the note budget weighs countable parts of the text and not what the
 * parser makes of it, measured at the phone's limits of `main`
 * (`noteBudgetShells.json`, `shells.phone.forms[form].main`):
 *
 *   pnpm --filter @plainva/core exec tsx scripts/perf/note-budget-fit.ts --counts   # events and nodes at each form's limit
 *   pnpm --filter @plainva/core exec tsx scripts/perf/note-budget-fit.ts --lp       # the best a weighting of the countable parts can do
 *
 * `--counts`: each form's note at the most units `main` reads under 128 MB,
 * parsed as `main` parses it (the note's budget off): how many micromark
 * events it makes, how many nodes its tree has, its characters and what it
 * weighs to the note's budget. At the same memory the events range over a
 * factor of six and the nodes from none to a hundred thousand and more, so
 * neither is a measure of the memory a note takes.
 *
 * `--lp`: a linear program over the weights of the parts the scan counts
 * (`noteWeights`; a character keeps the weight of its class): every form must
 * weigh at least 1.13 budgets at `main`'s limit (its safe side, `main`'s limit
 * measured to some 5 to 8 %), and the largest ratio of `main`'s limit to the
 * threshold, `t`, is made as small as weights can make it. The program is
 * written to `noteBudgetFit.lp` and solved with lp_solve; its solution, the
 * ratios it gives each form and the ratios of the weights in use go to
 * `noteBudgetFit.json`. The bound it finds is what no weighting of these parts
 * goes below; it fits pure forms only, and a weighting that is tight on pure
 * forms weighs the parts of mixed notes too light (see Performance_Notes.md,
 * "Calibration per shell").
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NOTE_BUDGET, NOTE_READING, boundMarkdownForParse, noteWeights, overBudgetInlineRanges, withNoteWeights, type NoteWeights } from "../../src/inlineParseBudget.js";
import { parseMarkdownTree } from "../../src/markdown-parser.js";
import { wikiLinkSyntax } from "../../src/wikiLinkSyntax.js";
import { noteOf } from "./note-budget.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
/** The safe side every form must keep at `main`'s limit. */
const SAFE = 1.13;
const WITHOUT_NOTES = { ...NOTE_READING, notes: false };

const phoneForms = (): Record<string, { main: number; ratio: number }> => JSON.parse(readFileSync(join(HERE, "noteBudgetShells.json"), "utf8")).shells.phone.forms;

/** What a note weighs to the note's budget under `weights`. */
function weightOf(text: string, weights?: Partial<NoteWeights>): number {
  let total = 0;
  const scan = () => overBudgetInlineRanges(text, { note: (value) => (total = value) });
  if (weights) withNoteWeights(weights, scan);
  else scan();
  return total;
}

async function counts(): Promise<Array<Record<string, number | string>>> {
  const load = async (name: string, from = require.resolve("micromark")) => import(pathToFileURL(createRequire(from).resolve(name)).href);
  const { parse, preprocess, postprocess } = await import(pathToFileURL(require.resolve("micromark")).href);
  const { gfm } = await load("micromark-extension-gfm", require.resolve("remark-gfm"));
  const { frontmatter } = await load("micromark-extension-frontmatter", require.resolve("remark-frontmatter"));
  const rows: Array<Record<string, number | string>> = [];
  for (const [form, { main, ratio }] of Object.entries(phoneForms())) {
    const text = noteOf(form, main);
    const bounded = boundMarkdownForParse(text, WITHOUT_NOTES).text;
    const events = postprocess(parse({ extensions: [gfm(), frontmatter(["yaml"]), wikiLinkSyntax] }).document().write(preprocess()(bounded, undefined, true))).length;
    let nodes = 0;
    const walk = (node: { children?: unknown[] }) => {
      nodes++;
      for (const child of node.children ?? []) walk(child as { children?: unknown[] });
    };
    walk(parseMarkdownTree(text, WITHOUT_NOTES) as { children?: unknown[] });
    const weight = weightOf(text) / NOTE_BUDGET;
    rows.push({ form, main, ratio, chars: text.length, events, nodes, budgets: Math.round(weight * 100) / 100 });
    console.log(`${form.padEnd(12)} ratio ${ratio.toFixed(2)}  ${String(text.length).padStart(9)} chars  ${String(events).padStart(8)} events  ${String(nodes).padStart(7)} nodes  ${weight.toFixed(2)} budgets`);
  }
  return rows;
}

function lp(): Record<string, unknown> {
  const forms = phoneForms();
  const keys = Object.keys(noteWeights()) as Array<keyof NoteWeights>;
  const zero = Object.fromEntries(keys.map((key) => [key, 0])) as Partial<NoteWeights>;
  // Per form at its limit: what its characters weigh alone, and what one unit of each weight adds.
  const parts = Object.entries(forms).map(([form, { main }]) => {
    const text = noteOf(form, main);
    const base = weightOf(text, zero);
    const per: Record<string, number> = {};
    for (const key of keys) per[key] = weightOf(text, { ...zero, [key]: 1 }) - base;
    return { form, main, base, per };
  });
  const lines = ["/* The note budget's weights: the least largest ratio of main's limit to the threshold (note-budget-fit.ts). */", "min: t;"];
  for (const { form, base, per } of parts) {
    const expr = keys.filter((key) => per[key] !== 0).map((key) => `${per[key].toFixed(3)} w_${key}`).join(" + ") || "0";
    lines.push(`lo_${form}: ${expr} >= ${(SAFE * NOTE_BUDGET - base).toFixed(3)};`);
    lines.push(`hi_${form}: ${expr} - ${NOTE_BUDGET} t <= ${(-base).toFixed(3)};`);
  }
  const file = join(HERE, "noteBudgetFit.lp");
  writeFileSync(file, `${lines.join("\n")}\n`);
  const solved = spawnSync("lp_solve", ["-S4", file], { encoding: "utf8" });
  if (solved.error) throw new Error(`lp_solve is needed to solve ${file}: ${solved.error.message}`);
  const values: Record<string, number> = {};
  // The values of the variables only: lp_solve prints the constraints and the dual values after them.
  const section = solved.stdout.split("Actual values of the variables:")[1]?.split("Actual values of the constraints:")[0] ?? "";
  for (const line of section.split("\n")) {
    const [name, value] = line.trim().split(/\s+/);
    if (name && value !== undefined && (name === "t" || name.startsWith("w_")) && !Number.isNaN(Number(value))) values[name] = Number(value);
  }
  const fitted = Object.fromEntries(keys.map((key) => [key, Math.round((values[`w_${key}`] ?? 0) * 10) / 10]));
  const inUse = noteWeights();
  const ratio = (base: number, per: Record<string, number>, weights: Record<string, number>) => Math.round(((base + keys.reduce((sum, key) => sum + per[key] * weights[key], 0)) / NOTE_BUDGET) * 100) / 100;
  const ratios = Object.fromEntries(parts.map(({ form, base, per }) => [form, { fitted: ratio(base, per, fitted), inUse: ratio(base, per, inUse as unknown as Record<string, number>) }]));
  const span = (which: "fitted" | "inUse") => {
    const all = Object.values(ratios).map((r) => r[which]);
    return [Math.min(...all), Math.max(...all)];
  };
  console.log(`lp bound (largest ratio no weighting of the counted parts goes below): ${values.t?.toFixed(2)}`);
  console.log(`ratios fitted ${span("fitted").join(" to ")}, in use ${span("inUse").join(" to ")}`);
  return { safeSide: SAFE, bound: Math.round((values.t ?? 0) * 100) / 100, weights: fitted, weightsInUse: inUse, ratios };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const out = join(HERE, "noteBudgetFit.json");
  const kept = (() => {
    try {
      return JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const result: Record<string, unknown> = { ...kept, measured: "phone, 128 MB, main's limits of noteBudgetShells.json" };
  if (args.includes("--counts")) result.counts = await counts();
  if (args.includes("--lp")) result.lp = lp();
  if (!args.includes("--counts") && !args.includes("--lp")) {
    console.log("usage: note-budget-fit.ts --counts | --lp");
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
}
