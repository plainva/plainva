/**
 * The performance budget at the core (Gesamtplan Leistung L0, decision E4):
 * runs the core measurement on the 10 000-note fixture and fails when a
 * number got more than 25 % worse than the baseline checked in for this
 * environment (`core-baseline.json`).
 *
 *   pnpm perf:core                       # from the repository root
 *   pnpm perf:core -- --update           # record this run as the environment's baseline
 *   PERF_ENV=github-ubuntu pnpm perf:core
 *
 * Why the comparison is by ratio and per environment (the long form is in
 * docs/engineering/Performance_Notes.md, "Performance gates"):
 * - A GitHub runner is slower and noisier than a developer's laptop, so a
 *   time measured on one says nothing on the other. Each measured time is
 *   divided by the duration of a calibration loop run in the SAME process,
 *   before, between and after the workload (`calibrate`): the ratio carries
 *   the code, the loop carries the machine.
 * - A ratio still drifts between machines (disk, cache sizes, CPU
 *   generation), so a baseline is recorded per environment — `PERF_ENV`, or
 *   the platform and CPU when it is not set — and compared only there. An
 *   environment without a baseline gets the measurement and a warning, never
 *   a verdict: a guessed baseline would make the gate fail or pass at random.
 * - The pass without changes is almost all file system, which the loop does
 *   not see: it is divided by a plain walk of the vault folder measured right
 *   before it in the same run (`fsWalkMs`) instead.
 * - A small time moves by more than 25 % for nothing; a metric only fails
 *   when it is also worse by its floor in absolute terms (`FLOOR_MS`).
 * - The index size is a byte count, compared as it is.
 *
 * Exit codes: 0 within budget (or no baseline yet), 1 over budget, 2 the
 * measurement itself failed.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runCoreBenchmark, type CoreMetrics, type CoreResult } from "./coreBenchmark.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, "core-baseline.json");
const COUNT = 10_000;
const TOLERANCE = 1.25;
/** Worse by less than this many milliseconds never fails, whatever the ratio. */
const FLOOR_MS: Record<Exclude<keyof CoreMetrics, "dbBytes">, number> = {
  coldIndexMs: 2_000,
  warmIndexMs: 50,
  saveP50Ms: 2,
  saveP95Ms: 3,
  searchMs: 3,
  listTasksMs: 30,
};

/** What each time is divided by: the walk of the folder for the pass without changes, the loop for the rest. */
const scale = (result: CoreResult, key: keyof typeof FLOOR_MS): number =>
  key === "warmIndexMs" && result.fsWalkMs ? result.fsWalkMs : result.calibrationMs;

export interface EnvironmentBaseline {
  recorded: string;
  commit?: string;
  node: string;
  cpu: string;
  calibrationMs: number;
  fsWalkMs?: number;
  /** Each time divided by the run's calibration (the pass without changes: by the walk of the folder). */
  ratios: Record<string, number>;
  /** The same times in milliseconds, for reading only. */
  ms: Record<string, number>;
  dbBytes: number;
  fixtureDigest: string;
}
interface BaselineFile {
  tolerance: number;
  count: number;
  environments: Record<string, EnvironmentBaseline>;
}

export function environmentName(): string {
  const cpu = (os.cpus()[0]?.model ?? "cpu").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // A hosted runner label is not one machine: GitHub hands out more than one CPU model under it,
  // and the ratios of SQL-bound metrics differ between them by more than the tolerance
  // (search and listTasks 26 % and 29 % apart for the same code). The CPU model is part of the name.
  if (process.env.PERF_ENV) return `${process.env.PERF_ENV}-${cpu}`;
  return `${os.platform()}-${os.arch()}-${cpu}`;
}

export function toBaseline(result: CoreResult, commit?: string): EnvironmentBaseline {
  const ratios: Record<string, number> = {};
  const ms: Record<string, number> = {};
  for (const key of Object.keys(FLOOR_MS) as (keyof typeof FLOOR_MS)[]) {
    ratios[key] = Number((result.metrics[key] / scale(result, key)).toFixed(5));
    ms[key] = result.metrics[key];
  }
  return {
    recorded: result.meta.date.slice(0, 10),
    ...(commit ? { commit } : {}),
    node: result.meta.node,
    cpu: result.meta.cpu,
    calibrationMs: result.calibrationMs,
    fsWalkMs: result.fsWalkMs,
    ratios,
    ms,
    dbBytes: result.metrics.dbBytes,
    fixtureDigest: result.fixture.digest,
  };
}

/**
 * The baseline of one environment, or the warning a run gets when its
 * environment has none: the keys that do have one are named, so a runner on a
 * CPU model not seen yet says which models it could have been compared with.
 * Never a verdict without a baseline: a borrowed one would fail or pass at random.
 */
export function lookupBaseline(
  environments: Record<string, EnvironmentBaseline>,
  env: string,
): { baseline: EnvironmentBaseline } | { warning: string } {
  const baseline = environments[env];
  if (baseline) return { baseline };
  const known = Object.keys(environments).sort();
  return {
    warning: `No baseline for the environment "${env}": nothing to compare against, so no verdict (exit 0). Environments with a baseline: ${known.length > 0 ? known.join(", ") : "none"}. Record one with "pnpm perf:core -- --update" on that environment, or take "asBaseline" from the run's perf-core artifact, and commit core-baseline.json.`,
  };
}

export interface Verdict { metric: string; baseline: number; now: number; ratio: number; worseMs: number; over: boolean }

/** Compares a run with a baseline of the same environment. */
export function judge(baseline: EnvironmentBaseline, result: CoreResult, tolerance = TOLERANCE): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const key of Object.keys(FLOOR_MS) as (keyof typeof FLOOR_MS)[]) {
    const base = baseline.ratios[key];
    if (base === undefined) continue;
    const now = result.metrics[key] / scale(result, key);
    // What the baseline's ratio comes to on this run's machine speed.
    const expectedMs = base * scale(result, key);
    const worseMs = result.metrics[key] - expectedMs;
    verdicts.push({ metric: key, baseline: base, now, ratio: now / base, worseMs, over: now > base * tolerance && worseMs > FLOOR_MS[key] });
  }
  const bytesRatio = result.metrics.dbBytes / baseline.dbBytes;
  verdicts.push({ metric: "dbBytes", baseline: baseline.dbBytes, now: result.metrics.dbBytes, ratio: bytesRatio, worseMs: 0, over: bytesRatio > tolerance });
  return verdicts;
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const jsonAt = args.includes("--json") ? path.resolve(args[args.indexOf("--json") + 1]) : null;
  const env = environmentName();
  const file: BaselineFile = JSON.parse(await fs.readFile(BASELINE, "utf8"));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-perf-core-"));
  let result: CoreResult;
  try {
    result = await runCoreBenchmark({ count: file.count ?? COUNT, root, log: (line) => console.log(`  ${line}`) });
  } catch (error) {
    console.error("The core measurement failed:", error);
    process.exit(2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  if (jsonAt) await fs.writeFile(jsonAt, JSON.stringify({ environment: env, result, asBaseline: toBaseline(result) }, null, 2) + "\n");

  const found = lookupBaseline(file.environments, env);
  if (update) {
    file.environments[env] = toBaseline(result, process.env.GITHUB_SHA ?? process.env.PERF_COMMIT);
    await fs.writeFile(BASELINE, JSON.stringify(file, null, 2) + "\n");
    console.log(`Baseline for "${env}" written to ${path.relative(process.cwd(), BASELINE)}.`);
    return;
  }
  if ("warning" in found) {
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=Performance budget (core)::${found.warning}` : `WARNING: ${found.warning}`);
    console.log(JSON.stringify({ [env]: toBaseline(result) }, null, 2));
    return;
  }
  const { baseline } = found;
  if (baseline.fixtureDigest !== result.fixture.digest) {
    console.error(`The fixture vault changed (digest ${result.fixture.digest.slice(0, 12)}, the baseline was measured on ${baseline.fixtureDigest.slice(0, 12)}): record the baselines again.`);
    process.exit(1);
  }
  const verdicts = judge(baseline, result, file.tolerance ?? TOLERANCE);
  console.log(`\nPerformance budget (core), ${COUNT} notes, environment "${env}", calibration ${result.calibrationMs} ms (baseline ${baseline.calibrationMs} ms):`);
  for (const v of verdicts) {
    const shown = v.metric === "dbBytes" ? `${(v.now / 1e6).toFixed(1)} MB (baseline ${(v.baseline / 1e6).toFixed(1)} MB)` : `${result.metrics[v.metric as keyof CoreMetrics]} ms (baseline ratio ${v.baseline}, now ${v.now.toFixed(5)})`;
    console.log(`  ${v.over ? "OVER " : "ok   "} ${v.metric.padEnd(12)} ${shown}  x${v.ratio.toFixed(2)}`);
  }
  const over = verdicts.filter((v) => v.over);
  if (over.length > 0) {
    console.error(`\n${over.length} metric(s) more than ${Math.round(((file.tolerance ?? TOLERANCE) - 1) * 100)} % worse than the baseline: ${over.map((v) => v.metric).join(", ")}.`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
