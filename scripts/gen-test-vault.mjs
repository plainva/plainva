#!/usr/bin/env node
/* global process, console */
/**
 * Generates the synthetic vault for performance measurements.
 *
 *   node scripts/gen-test-vault.mjs <target-folder> <note-count>
 *   node scripts/gen-test-vault.mjs C:/tmp/vault-10k 10000
 *
 * Since 2026-11-10 (Gesamtplan Leistung L0) this is the fixture every
 * measurement uses — the core gate, the benchmark of a large vault and the
 * browser report: packages/core/scripts/perf/fixtureVault.ts, which this
 * script runs. Realistic note sizes, properties, tags, every kind of link the
 * index reads, tasks with dates, attachments, `.base` files, a long note with
 * 80 tables; deterministic, named by a digest. Vaults written by the earlier
 * version of this script (OKF notes of one size, ~5 wiki links each) are not
 * comparable with it. Refuses to write into a non-empty target.
 */
import { execSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , target, count] = process.argv;
if (!target || !count) {
  console.error("usage: node scripts/gen-test-vault.mjs <target-folder> <note-count>");
  process.exit(1);
}
try {
  execSync(`npx tsx scripts/perf/generate-vault.ts "${path.resolve(target)}" ${Number(count)}`, {
    cwd: path.join(ROOT, "packages", "core"),
    stdio: "inherit",
  });
} catch (error) {
  process.exit(typeof error?.status === "number" ? error.status : 1);
}
