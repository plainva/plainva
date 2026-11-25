// Compares two outputs of parser-corpus-digest.ts: prints every text whose reading differs, and the readings.
import { readFileSync } from "node:fs";
type Digest = { result: Record<string, Record<string, string>> };
const [a, b] = process.argv.slice(2).map((file) => JSON.parse(readFileSync(file, "utf8")) as Digest);
if (!a || !b) throw new Error("usage: parser-corpus-compare.ts old.json new.json");
let differing = 0;
for (const [name, old] of Object.entries(a.result)) {
  const now = b.result[name];
  if (!now) { console.log(`only in the old run: ${name}`); differing += 1; continue; }
  const readings = Object.keys(old).filter((reading) => old[reading] !== now[reading]);
  if (readings.length) { console.log(`${name}: ${readings.join(", ")}`); differing += 1; }
}
for (const name of Object.keys(b.result)) if (!a.result[name]) { console.log(`only in the new run: ${name}`); differing += 1; }
console.log(`${Object.keys(a.result).length} texts compared, ${differing} differ`);
process.exitCode = differing ? 1 : 0;
