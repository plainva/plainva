/**
 * Writes the performance fixture vault (`fixtureVault.ts`) into a folder.
 *
 *   pnpm --filter @plainva/core exec tsx scripts/perf/generate-vault.ts <target-folder> <note-count> [--seed N]
 *   node scripts/gen-test-vault.mjs <target-folder> <note-count>      # the same, from the repository root
 *
 * Refuses a folder that is not empty. Prints what it wrote and the digest
 * that names the fixture.
 */
import * as path from "node:path";
import { writeFixtureVault } from "./fixtureVault.js";

const [target, countArg] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--seed");
const seedAt = process.argv.indexOf("--seed");
const count = Number(countArg);
const seed = seedAt > 0 ? Number(process.argv[seedAt + 1]) : 1;
if (!target || !Number.isInteger(count) || count < 1 || !Number.isInteger(seed)) {
  console.error("usage: generate-vault.ts <target-folder> <note-count> [--seed N]");
  process.exit(1);
}
try {
  const summary = await writeFixtureVault(path.resolve(target), { count, seed });
  console.log(`done: ${summary.notes} notes, ${summary.attachments} attachments, ${summary.bases} .base files, ${(summary.bytes / 1e6).toFixed(1)} MB -> ${path.resolve(target)}`);
  console.log(`fixture digest ${summary.digest}`);
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
}
