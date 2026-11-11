#!/usr/bin/env node
/* global process, console */
/**
 * The bundle budget (Gesamtplan Leistung L0, decision E4): what each shell
 * loads before its first picture, held against a checked-in baseline.
 *
 *   pnpm perf:bundle                   # builds both shells, then checks
 *   pnpm perf:bundle -- --skip-build   # checks the builds of an earlier run (in the temp folder below)
 *   pnpm perf:bundle -- --update       # records this build as the baseline
 *
 * Per shell:
 * - start bytes: every file the built `index.html` loads — the entry module,
 *   each `modulepreload`, the style sheets — raw and gzipped;
 * - the entry file on its own: the start chunk that holds the shell's
 *   `src/main.tsx` (with `strictExecutionOrder` the module `index.html` names
 *   is a stub that only imports it);
 * - which module families the start files carry, read from their source maps.
 *
 * The rules (`bundle-baseline.json`):
 * - start bytes and the entry file may not grow by more than `growth` over the
 *   baseline (a build is deterministic, so the slack only absorbs what a
 *   dependency's patch release adds). A smaller build passes and says so: lower
 *   the baseline with `--update`, so the next growth is measured from there.
 * - `mustNotStart`: module families that must not be in the start files. Today
 *   they are (package L5 takes them out), so each rule carries
 *   `"expected": "fail"` — the gate reports it as a known failure and passes.
 *   The day the family is out of the start files, the rule fails the gate until
 *   its `expected` is flipped to `"pass"`: a fixed rule is armed, never left
 *   silently loose.
 *
 * The builds go to a temp folder with source maps (`vite build --sourcemap`),
 * never into the shells' own `dist/`. Code splitting is the same with and
 * without maps.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "scripts", "perf", "bundle-baseline.json");
const OUT = path.join(os.tmpdir(), "plainva-bundle-gate");
const SHELLS = { desktop: "apps/desktop", mobile: "apps/mobile" };

const args = process.argv.slice(2);
const update = args.includes("--update");
const skipBuild = args.includes("--skip-build");
const jsonAt = args.includes("--json") ? path.resolve(args[args.indexOf("--json") + 1]) : null;

function build(shell) {
  const dir = path.join(OUT, shell);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`building ${shell} …`);
  execSync(`npx vite build --sourcemap --outDir "${dir}" --emptyOutDir --logLevel warn`, {
    cwd: path.join(ROOT, SHELLS[shell]),
    stdio: ["ignore", "inherit", "inherit"],
  });
  return dir;
}

/** The files `index.html` loads before anything else, in its order. */
function startFiles(html) {
  const files = [];
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/g)) {
    const attrs = match[2];
    const ref = /\b(?:src|href)="([^"]+)"/.exec(attrs)?.[1];
    if (!ref || /^(?:[a-z]+:)?\/\//i.test(ref)) continue;
    const isModule = match[1] === "script" && /type="module"/.test(attrs);
    const isPreload = match[1] === "link" && /rel="modulepreload"/.test(attrs);
    const isStyle = match[1] === "link" && /rel="stylesheet"/.test(attrs);
    if (isModule || isPreload || isStyle) files.push({ path: ref.replace(/^\//, ""), entry: isModule });
  }
  return files;
}

/** The module family of a source path from a source map, or null. */
function familyOf(source) {
  const s = source.replace(/\\/g, "/");
  const nm = s.lastIndexOf("node_modules/");
  if (nm >= 0) {
    const rest = s.slice(nm + 13).split("/");
    return "npm:" + (rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]);
  }
  const m = /((?:packages\/(?:core|ui)|apps\/(?:desktop|mobile))\/src\/(?:[^/]+\/){0,2})/.exec(s);
  return m ? m[1] : null;
}

function measure(shell, dir) {
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const files = startFiles(html);
  let raw = 0;
  let gzip = 0;
  let entry = null;
  const sources = new Map();
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(dir, file.path));
    raw += bytes.length;
    gzip += zlib.gzipSync(bytes).length;
    if (file.entry && !entry) entry = { path: file.path, bytes: bytes.length };
    const map = path.join(dir, file.path + ".map");
    if (file.path.endsWith(".js") && fs.existsSync(map)) {
      const parsed = JSON.parse(fs.readFileSync(map, "utf8"));
      // The entry file is the chunk that holds the shell's own entry module. With
      // `strictExecutionOrder` the `<script>` index.html names is a stub of a few
      // bytes that imports that chunk, so the chunk is found by its source map.
      if (parsed.sources.some((source) => source.split(String.fromCharCode(92)).join("/").endsWith(`apps/${shell}/src/main.tsx`))) entry = { path: file.path, bytes: bytes.length, holdsMain: true };
      parsed.sources.forEach((source, i) => {
        const family = familyOf(source);
        if (family) sources.set(family, (sources.get(family) ?? 0) + (parsed.sourcesContent?.[i]?.length ?? 0));
      });
    }
  }
  if (!entry) throw new Error(`${shell}: no entry module in ${path.join(dir, "index.html")}`);
  if (!entry.holdsMain) throw new Error(`${shell}: no start file holds apps/${shell}/src/main.tsx (source maps missing?)`);
  const families = Object.fromEntries([...sources].sort((a, b) => b[1] - a[1]));
  return { files: files.map((f) => f.path), startBytes: raw, startGzipBytes: gzip, entryBytes: entry.bytes, entry: entry.path, families };
}

/** Whether `prefix` (a family like `packages/core/src/ai/`) is among the measured families. */
const carries = (families, prefix) => Object.entries(families).filter(([family]) => family.startsWith(prefix));

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
const kb = (bytes) => `${Math.round(bytes / 1e3)} KB`;

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const measured = {};
for (const shell of Object.keys(SHELLS)) {
  const dir = skipBuild ? path.join(OUT, shell) : build(shell);
  measured[shell] = measure(shell, dir);
}
if (jsonAt) fs.writeFileSync(jsonAt, JSON.stringify(measured, null, 2) + "\n");

if (update) {
  for (const shell of Object.keys(SHELLS)) {
    baseline.shells[shell] = { startBytes: measured[shell].startBytes, startGzipBytes: measured[shell].startGzipBytes, entryBytes: measured[shell].entryBytes };
  }
  baseline.recorded = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`baseline written to ${path.relative(ROOT, BASELINE)}`);
}

const failures = [];
const notes = [];
const growth = 1 + baseline.growth;
console.log(`\nBundle budget (allowed growth ${Math.round(baseline.growth * 100)} %):`);
for (const shell of Object.keys(SHELLS)) {
  const now = measured[shell];
  const was = baseline.shells[shell];
  if (!was) {
    failures.push(`${shell}: no baseline — record one with --update`);
    continue;
  }
  const budget = baseline.budgets?.[shell] ?? {};
  console.log(`  ${shell}: start ${mb(now.startBytes)} (${mb(now.startGzipBytes)} gzip) in ${now.files.length} files, entry ${kb(now.entryBytes)}`);
  console.log(`    baseline start ${mb(was.startBytes)}, entry ${kb(was.entryBytes)}; budget start ${budget.startBytes ? mb(budget.startBytes) : "-"}, entry ${budget.entryBytes ? kb(budget.entryBytes) : "-"}`);
  for (const key of ["startBytes", "entryBytes"]) {
    if (now[key] > was[key] * growth) failures.push(`${shell}: ${key} ${now[key]} is more than ${Math.round(baseline.growth * 100)} % over the baseline ${was[key]}`);
    else if (now[key] < was[key] / growth) notes.push(`${shell}: ${key} shrank from ${was[key]} to ${now[key]} — lower the baseline with --update`);
    if (budget[key] && now[key] > budget[key]) notes.push(`${shell}: ${key} ${now[key]} is over the budget of ${budget[key]} (plan § 4; packages L5)`);
  }
  for (const rule of baseline.mustNotStart) {
    const found = carries(now.families, rule.family);
    const fails = found.length > 0;
    const expected = typeof rule.expected === "string" ? rule.expected : rule.expected[shell];
    const detail = found.map(([family, chars]) => `${family} ${kb(chars)}`).join(", ");
    if (fails && expected === "fail") console.log(`    KNOWN FAILURE (${rule.until}): ${rule.family} is in the start files — ${detail}`);
    else if (fails) failures.push(`${shell}: ${rule.family} must not be in the start files, found ${detail}`);
    else if (expected === "fail") failures.push(`${shell}: ${rule.family} is no longer in the start files — set its "expected" for ${shell} to "pass" in bundle-baseline.json, so the rule holds from now on`);
    else console.log(`    ok: ${rule.family} is not in the start files`);
  }
}
for (const note of notes) console.log(`  note: ${note}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL: ${failure}`);
  process.exit(1);
}
console.log("  within the bundle budget");
