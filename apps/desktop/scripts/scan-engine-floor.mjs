#!/usr/bin/env node
/**
 * Scan a production build for constructs above the supported engine floor.
 *
 * WHY
 * The floor (Safari 16.4 / macOS 13 / WebKitGTK 2.40) is enforced in three
 * places by src/floorConsistency.test.ts — but all three only say what we
 * PROMISE. Nothing checked whether the bundle keeps that promise. Issue #46 was
 * exactly that gap one level down: the bundle required Safari 16.4 while the
 * app claimed 10.13.
 *
 * WHAT IT CAN AND CANNOT DO
 * It finds KNOWN violations from a hand-maintained list. It cannot prove the
 * bundle runs on Safari 16.4 — only a machine at the floor can do that, which
 * is why the release gate asks for one whenever the floor moves. Treat a clean
 * run as "nothing known is wrong", not as "verified".
 *
 * USAGE
 *   pnpm --filter desktop build && node scripts/scan-engine-floor.mjs
 * Exit code 1 on a fatal finding (JS that throws), 0 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(desktopRoot, "dist");
const assets = join(dist, "assets");

if (!existsSync(assets)) {
  console.error("No build found. Run `pnpm --filter desktop build` first.");
  process.exit(2);
}

/**
 * JS that a Safari 16.4 engine does not have. These are FATAL: a missing API
 * throws at call time, and a missing syntax feature throws at parse time and
 * takes the whole chunk with it — the issue #46 mechanism.
 */
const FATAL_JS = [
  ["Promise.withResolvers", /Promise\.withResolvers/g, "Safari 17.4"],
  ["Object.groupBy", /Object\.groupBy/g, "Safari 17.4"],
  ["Map.groupBy", /Map\.groupBy/g, "Safari 17.4"],
  ["Array.fromAsync", /Array\.fromAsync/g, "Safari 18.0"],
  ["RegExp.escape", /RegExp\.escape/g, "Safari 18.2"],
  ["Promise.try", /Promise\.try\(/g, "Safari 18.2"],
];

/**
 * Bare method names that newer JS added but OTHER libraries also use. Reported,
 * never fatal — the first run of this scanner flagged `.intersection(` in
 * cytoscape and mermaid, which turned out to be cytoscape's own collection API
 * (`eles.intersection(...)`), not `Set.prototype.intersection`. A scanner that
 * cries wolf gets ignored, so these need a human look at the call site instead
 * of a red build.
 */
const AMBIGUOUS_JS = [
  ["Set.union / *.union", /\.union\(/g, "Safari 17.0"],
  ["Set.intersection / *.intersection", /\.intersection\(/g, "Safari 17.0"],
  ["Set.symmetricDifference", /\.symmetricDifference\(/g, "Safari 17.0"],
  ["Set.isSubsetOf", /\.isSubsetOf\(/g, "Safari 17.0"],
  ["Set.isDisjointFrom", /\.isDisjointFrom\(/g, "Safari 17.0"],
  ["String.isWellFormed", /\.isWellFormed\(/g, "Safari 17.0"],
  ["String.toWellFormed", /\.toWellFormed\(/g, "Safari 17.0"],
];

/** Ambiguous hits already looked at, so the next run does not re-open them. */
const CHECKED_AMBIGUOUS = new Map([
  [
    "Set.intersection / *.intersection",
    "cytoscape + mermaid architectureDiagram: cytoscape's own collection API " +
      "(`eles.intersection(...)`), not Set.prototype. Lazy chunks either way.",
  ],
  [
    "Set.union / *.union",
    "mermaid architectureDiagram: same cytoscape collection API. Lazy chunk.",
  ],
]);

/**
 * CSS above the floor. NOT fatal: an unknown declaration is dropped and the
 * page keeps working — progressive enhancement. Listed so a reviewer decides
 * consciously instead of finding it again next time.
 */
const DEGRADING_CSS = [
  ["text-wrap: balance", /text-wrap:\s*balance/g, "Safari 17.5"],
  ["text-wrap: pretty", /text-wrap:\s*pretty/g, "Safari 17.5"],
  ["light-dark()", /light-dark\(/g, "Safari 17.5"],
  ["@scope", /@scope[\s{]/g, "Safari 17.4"],
  ["@starting-style", /@starting-style/g, "Safari 17.5"],
  ["field-sizing", /field-sizing:/g, "not in Safari"],
];

/** Known and accepted — each needs a reason, not just an entry. */
const ACCEPTED_CSS = new Map([
  [
    "text-wrap: balance",
    "Mail reader subject line (.pv-mail-rsubj, mail.css). Pure typography: below " +
      "the floor the line simply wraps normally. Lazy chunk, not in the startup chain.",
  ],
]);

/** The chunks the browser loads and evaluates to start the app: the entry plus
 *  everything Vite preloads for it. A violation here kills startup; the same
 *  violation in a lazy chunk only breaks the feature that loads it. */
function startupChain() {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const names = new Set();
  for (const m of html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)) names.add(m[1]);
  return [...names];
}

const chain = startupChain();
const allJs = readdirSync(assets).filter((f) => f.endsWith(".js"));
const allCss = readdirSync(assets).filter((f) => f.endsWith(".css"));

let fatal = 0;

console.log(`Engine floor scan — startup chain: ${chain.length} of ${allJs.length} JS chunks\n`);

for (const [name, re, since] of FATAL_JS) {
  const hits = [];
  for (const file of allJs) {
    const count = (readFileSync(join(assets, file), "utf8").match(re) || []).length;
    if (count) hits.push({ file, count, inChain: chain.includes(file) });
  }
  if (!hits.length) continue;
  const inChain = hits.filter((h) => h.inChain);
  fatal += inChain.length ? 1 : 0;
  console.log(`${inChain.length ? "FATAL " : "lazy  "} ${name} (${since})`);
  for (const h of hits) console.log(`         ${h.inChain ? "[startup] " : "[lazy]    "}${h.file} ×${h.count}`);
}

for (const [name, re, since] of AMBIGUOUS_JS) {
  const hits = [];
  for (const file of allJs) {
    const count = (readFileSync(join(assets, file), "utf8").match(re) || []).length;
    if (count) hits.push({ file, count, inChain: chain.includes(file) });
  }
  if (!hits.length) continue;
  const checked = CHECKED_AMBIGUOUS.get(name);
  console.log(`${checked ? "known " : "REVIEW"} ${name} (${since}) — bare name, could be another API`);
  for (const h of hits) console.log(`         ${h.inChain ? "[startup] " : "[lazy]    "}${h.file} ×${h.count}`);
  if (checked) console.log(`         checked: ${checked}`);
}

for (const [name, re, since] of DEGRADING_CSS) {
  const hits = allCss
    .map((file) => ({ file, count: (readFileSync(join(assets, file), "utf8").match(re) || []).length }))
    .filter((h) => h.count);
  if (!hits.length) continue;
  const accepted = ACCEPTED_CSS.get(name);
  console.log(`${accepted ? "known " : "REVIEW"} ${name} (${since}) — CSS degrades silently`);
  for (const h of hits) console.log(`         ${h.file} ×${h.count}`);
  if (accepted) console.log(`         accepted: ${accepted}`);
}

console.log(
  fatal
    ? `\n${fatal} fatal finding(s) in the startup chain — the promised floor does not hold.`
    : "\nNo known violation in the startup chain.",
);
process.exit(fatal ? 1 : 0);
