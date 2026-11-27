import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { NOTE_BUDGET, overBudgetInlineRanges, setNoteBudget } from "../src/inlineParseBudget.ts";
import { NOTE_FORMS, readAsItIs } from "../scripts/perf/note-budget.ts";

const CORE = new URL("..", import.meta.url).pathname;

/**
 * Notes that ran a reader of the phone out of 128 MB, each read again by the
 * index and the note source in a process of its own under that heap
 * (`scripts/perf/note-budget.ts --child`).
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

const underHeap = (note: string, units: number) => {
  for (const parse of ["index", "tree"]) {
    const run = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "scripts/perf/note-budget.ts", "--child", note, String(units), "1", parse, "bounded"], { cwd: CORE, encoding: "utf8", timeout: 240_000 });
    expect(run.status, `${parse}: ${(run.stderr ?? "").slice(-300)}`).toBe(0);
    expect(run.stdout).toMatch(/^ok \d+/m);
  }
};

describe("notes the performance workflow's hunt found", () => {
  // 2026-11-26, each of which ran the phone's index out of 128 MB while pieces were read with the definitions of the
  // note behind them: `:12`, `:27` and `:13` paragraphs of references and blocks of definitions, `gen:382803:4` a
  // definition beside a paragraph of megabytes.
  for (const note of ["gen:936455:12", "gen:936455:27", "gen:936455:13", "gen:382803:4"]) {
    it(`${note} is read by the phone's index and note source under 128 MB`, () => {
      expect.hasAssertions();
      underHeap(note, 0);
    }, 300_000);
  }
});

/**
 * A quote of one paragraph whose depth changes from line to line (review of
 * L14, 2026-11-26): over the inline budget it was weighed by its characters
 * alone, but such a stretch keeps its markers and the parser opens their
 * quotes on every line. The weight fell as the note grew — 10 000 lines 200 M,
 * read as text; 20 000 lines 9.7 M, read formatted, and the index ran out of
 * 128 MB (on `main` as well: there is no note budget there).
 */
describe("a quote whose depth changes from line to line", () => {
  for (const [form, lines] of [["quotedepth", 20_000], ["mailthread", 40_000]] as const) {
    it(`${form}: weighs more as it grows, is read as text over the budget, and read under 128 MB`, () => {
      expect.hasAssertions();
      setNoteBudget(NOTE_BUDGET);
      const weight = (n: number) => {
        let total = 0;
        overBudgetInlineRanges(NOTE_FORMS[form](n), { note: (value) => (total = value) });
        return total;
      };
      expect(weight(lines), "twice the lines").toBeGreaterThan(weight(lines / 2));
      expect(weight(lines)).toBeGreaterThan(NOTE_BUDGET);
      expect(overBudgetInlineRanges(NOTE_FORMS[form](lines)).some((range) => range.block), "read as text").toBe(true);
      underHeap(form, lines);
    }, 300_000);
  }
});

/**
 * The weight is an upper bound (review of L14, round three): what the note's
 * budget reads formatted parses under the heap. Short paragraphs each with a
 * link, a picture and a wiki link, references with a destination whose
 * definitions are read as text, and paragraphs full of brackets ran the
 * phone's readers out of 128 MB — 4 400 short paragraphs (0.42 MB) at the most
 * the budget read formatted, 20 000 references (2 MB) with their definitions
 * read as text. Each at that most, and at three times it, read by the index and
 * the note source under 128 MB, and the references at the review's size. The edge search of the
 * performance workflow draws such notes from every building block
 * (`note-budget.ts --edge`).
 */
describe("what the note's budget reads formatted parses under the heap", () => {
  for (const form of ["shortlinks", "bracketparas", "refslinked"] as const) {
    it(`${form}: at the most the budget reads formatted, and at three times that`, () => {
      expect.hasAssertions();
      setNoteBudget(NOTE_BUDGET);
      const most = readAsItIs(form);
      expect(most).toBeGreaterThan(0);
      underHeap(form, most);
      underHeap(form, 3 * most);
      // The review's references: 20 000 of them in paragraphs of fifty, their definitions read as text (2 MB).
      if (form === "refslinked") underHeap(form, 20_000);
    }, 600_000);
  }
});
