/**
 * The core measurement of the performance plan on a generated vault
 * (Gesamtplan Leistung § 1, package L0). Creates a fresh folder; never edits a
 * user vault.
 *
 *   pnpm --filter @plainva/core exec tsx scripts/benchmark-large-vault.ts --count 10000 --json out.json
 *
 * --count N        notes in the fixture vault (default 3000; the gate uses 10000)
 * --directory DIR  where the vault and the index go (must not exist yet); default a temp folder
 * --json FILE      write the result as JSON (default: measurement.json in the folder, or
 *                  core-benchmark-<count>.json here when the temporary folder is removed)
 * --no-wal         run the index without WAL (the phone's mode before package L4)
 * --keep           keep the vault and the index afterwards (default: removed when the folder was temporary)
 *
 * What is measured and how: scripts/perf/coreBenchmark.ts. The gate that holds
 * the numbers: scripts/perf/core-gate.ts.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCoreBenchmark } from "./perf/coreBenchmark.js";

const args = process.argv.slice(2);
const argument = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const count = Number(argument("--count") ?? 3000);
if (!Number.isInteger(count) || count < 1) {
  console.error(`--count must be a positive integer, got ${argument("--count")}`);
  process.exit(1);
}
const given = argument("--directory");
if (given) {
  try {
    await fs.access(path.resolve(given));
    console.error(`refusing to measure in a folder that exists: ${given}`);
    process.exit(1);
  } catch {
    // Missing, as it should be.
  }
}
const root = given ? path.resolve(given) : await fs.mkdtemp(path.join(os.tmpdir(), "plainva-large-vault-"));
const result = await runCoreBenchmark({ count, root, wal: !args.includes("--no-wal"), log: (line) => console.log(line) });
const removed = !given && !args.includes("--keep");
const output = argument("--json") ? path.resolve(argument("--json")!) : removed ? path.resolve(`core-benchmark-${count}.json`) : path.join(root, "measurement.json");
await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result.metrics));
console.log(`Measurement: ${output}`);
if (removed) await fs.rm(root, { recursive: true, force: true });
else console.log(`Vault and index: ${root}`);
