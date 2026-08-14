#!/usr/bin/env node
/**
 * One command for the performance measurement that DoD 5 has been waiting on.
 *
 *   node scripts/measure-performance.mjs              # 1k + 5k
 *   node scripts/measure-performance.mjs --sizes 1000,5000,20000
 *   node scripts/measure-performance.mjs --runs 5 --keep-vaults
 *
 * It generates the test vaults, runs the core benchmark over each size TWICE
 * (once unbatched, once with `--batch`), checks that both produced the same
 * index, and writes the numbers into `docs/engineering/Performance_Notes.md`
 * between the markers below. Nothing else in that file is touched, so the
 * earlier baselines stay where they are and stay comparable.
 *
 * WHY BOTH MODES. The open question behind DoD 5 is whether the Rust bulk
 * insert (`db_batch`) closes the 20k cold-index budget break of 151 s. That
 * command sits behind Tauri IPC and cannot be reached from here — but the
 * indexer's chunk-flushing path can, and the difference between the two runs is
 * the share of the gain that comes from SQLite rather than from saved IPC hops.
 * It is a floor for the native improvement, not a substitute for measuring it.
 *
 * WHAT THIS CANNOT MEASURE, and therefore never claims: Tauri IPC, the SQL
 * plugin, WebView rendering, the file watcher, network vaults, React. Those are
 * the rows of the "Native measurements" table further down in the notes; they
 * need the running app and stay the maintainer's to fill.
 *
 * Also writes the three vaults for those native runs (via gen-test-vault.mjs)
 * unless --no-native-vaults is passed, so opening one in the app is the only
 * remaining manual step.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES = path.join(ROOT, "docs", "engineering", "Performance_Notes.md");
const START = "<!-- perf:auto-start -->";
const END = "<!-- perf:auto-end -->";

// ---- arguments -------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const sizes = arg("--sizes", "1000,5000")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const runs = Number(arg("--runs", "3"));
const keepVaults = argv.includes("--keep-vaults");
const nativeVaults = !argv.includes("--no-native-vaults");
if (sizes.length === 0) {
  console.error("no usable --sizes given");
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "plainva-perf-"));
const say = (s) => console.log(s);

// ---- run one benchmark -----------------------------------------------------
function runBenchmark(files, batched) {
  const out = path.join(work, `bench-${files}-${batched ? "batch" : "plain"}.json`);
  const args = ["tsx", "scripts/benchmark.ts", "--files", String(files), "--runs", String(runs), "--json", out];
  if (batched) args.push("--batch");
  say(`  ${files} files, ${batched ? "batched" : "unbatched"} — ${runs} runs…`);
  execFileSync("npx", args, {
    cwd: path.join(ROOT, "packages", "core"),
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const pick = (res, name) => res.results.find((r) => r.name === name)?.medianMs ?? null;
const cell = (v) => (v === null ? "—" : fmt(v));

// ---- measure ---------------------------------------------------------------
const rows = [];
for (const files of sizes) {
  say(`\n${files} notes:`);
  const plain = runBenchmark(files, false);
  const batch = runBenchmark(files, true);

  // The two timings are only comparable if both runs built the same index.
  // Guarding this is the whole reason the benchmark reports its shape — and it
  // has to cover every table the cold pass writes, not just `files`: a first
  // version counted notes alone and stayed green while the batch dropped a
  // statement per chunk.
  const a = JSON.stringify(plain.shape);
  const b = JSON.stringify(batch.shape);
  if (a !== b) {
    console.error(`\nindex shapes differ at ${files} notes — refusing to publish these numbers:`);
    console.error(`  unbatched ${a}`);
    console.error(`  batched   ${b}`);
    process.exit(3);
  }

  const cold = pick(plain, "full index (cold)");
  const coldBatched = pick(batch, "full index (cold)");
  rows.push({
    files,
    cold,
    coldBatched,
    gain: cold && coldBatched ? Math.round((1 - coldBatched / cold) * 100) : null,
    warm: pick(plain, "full index (warm, no changes)"),
    incremental: pick(plain, "incremental (1 changed file)"),
    search: Math.max(
      ...["Standard", "quick brown", "tag3"].map((t) => pick(plain, `search "${t}"`) ?? 0),
    ),
    shape: plain.shape,
  });
}

// ---- test vaults for the native runs ---------------------------------------
let nativeNote = "";
if (nativeVaults) {
  const base = path.join(os.tmpdir(), "plainva-vaults");
  fs.mkdirSync(base, { recursive: true });
  const made = [];
  for (const files of sizes) {
    const dir = path.join(base, `vault-${files}`);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      made.push(`${dir} (already there, left alone)`);
      continue;
    }
    execFileSync("node", [path.join(ROOT, "scripts", "gen-test-vault.mjs"), dir, String(files)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    made.push(dir);
  }
  nativeNote = made.map((m) => `- \`${m}\``).join("\n");
}

// ---- write the block -------------------------------------------------------
const gains = rows.map((r) => r.gain).filter((g) => g !== null);
const withinNoise = gains.length > 0 && gains.every((g) => Math.abs(g) < 5);
const meta = `Node ${process.version} · ${os.platform()} ${os.release()} · ${os.cpus()[0]?.model?.trim() ?? "unknown CPU"} · median of ${runs} runs`;
const table = [
  "| Notes | Cold index | Cold index (batched) | Batch gain | Warm pass | Incremental | Search (worst of 3) |",
  "|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.files} | ${cell(r.cold)} | ${cell(r.coldBatched)} | ${r.gain === null ? "—" : `${r.gain} %`} | ${cell(r.warm)} | ${cell(r.incremental)} | ${cell(r.search)} |`,
  ),
].join("\n");

const noiseReading = withinNoise
  ? `\n\nOn this run that share came out **within noise** (${gains
      .map((g) => `${g} %`)
      .join(", ")}), which is half an answer in itself: batching buys almost nothing when there
is no IPC to save. Whatever \`db_batch\` is worth natively, it is worth it for the round trips —
so the native number cannot be inferred from these, only bounded below by zero.`
  : "";

const block = `${START}
<!-- Generated by scripts/measure-performance.mjs — do not hand-edit; re-run the script. -->

### Harness measurement, ${new Date().toISOString().slice(0, 10)}

${meta}

${table}

Index shape checked identical between the batched and unbatched run of each size
(${Object.keys(rows[0]?.shape ?? {}).join(", ")}) — without that, the two timings would not be
comparable.

**Batch gain is a floor, not the native number.** \`--batch\` gives the indexer the
chunk-flushing path the desktop takes through \`db_batch\`, but there is no Tauri IPC here, so
what this column shows is the SQLite-side share alone. Natively the saved round trips come on
top; that is the measurement DoD 5 is still waiting for, and it needs the running app.${noiseReading}

**Not covered here at all:** Tauri IPC, the SQL plugin, WebView rendering, the file watcher,
network vaults, React. See "Native measurements" below.${
  nativeNote ? `\n\nTest vaults for those native runs:\n\n${nativeNote}` : ""
}
${END}`;

let notes = fs.readFileSync(NOTES, "utf8");
if (notes.includes(START) && notes.includes(END)) {
  notes = notes.slice(0, notes.indexOf(START)) + block + notes.slice(notes.indexOf(END) + END.length);
} else {
  // First run: park the block directly above the native table, which is where a
  // reader comparing harness numbers to native ones will look for it.
  const anchor = "## Native measurements";
  const at = notes.indexOf(anchor);
  notes = at >= 0 ? notes.slice(0, at) + block + "\n\n" + notes.slice(at) : `${notes.trimEnd()}\n\n${block}\n`;
}
fs.writeFileSync(NOTES, notes, "utf8");

if (!keepVaults) fs.rmSync(work, { recursive: true, force: true });
say(`\nWrote the results into ${path.relative(ROOT, NOTES)} (between the perf:auto markers).`);
say("Still yours to run in the app: the 'Native measurements' table.");
