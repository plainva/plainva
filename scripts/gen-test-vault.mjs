#!/usr/bin/env node
/**
 * Generates a synthetic vault for performance measurements (P2.11).
 *
 *   node scripts/gen-test-vault.mjs <target-folder> <file-count>
 *   node scripts/gen-test-vault.mjs C:/tmp/vault-5k 5000
 *
 * Layout: ~sqrt(n) folders with n files spread across them. Every note gets
 * OKF frontmatter (type, tags, a date) and ~5 wiki links to neighboring notes
 * so link resolution, backlinks, graph and FTS all have realistic work. A few
 * .base files reference the folders. Deterministic (seeded), so runs are
 * comparable. Refuses to write into a non-empty target.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const [, , target, countArg] = process.argv;
const count = Number(countArg);
if (!target || !Number.isFinite(count) || count <= 0) {
  console.error("usage: node scripts/gen-test-vault.mjs <target-folder> <file-count>");
  process.exit(1);
}

if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  console.error(`refusing to write into non-empty folder: ${target}`);
  process.exit(1);
}

// Small deterministic PRNG (mulberry32) — comparable runs need stable content.
let seed = 0x5eed;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const TYPES = ["note", "project", "task", "reference", "journal"];
const TAGS = ["alpha", "beta", "review", "idee", "wichtig", "archiv", "projekt/intern", "projekt/kunde"];
const WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit markdown vault performance index sync graph backlink relation".split(" ");

const folderCount = Math.max(1, Math.round(Math.sqrt(count)));
const folders = Array.from({ length: folderCount }, (_, i) => `Ordner-${String(i + 1).padStart(3, "0")}`);
const noteName = (i) => `Notiz-${String(i + 1).padStart(5, "0")}`;
const notePath = (i) => `${folders[i % folderCount]}/${noteName(i)}.md`;

fs.mkdirSync(target, { recursive: true });
for (const f of folders) fs.mkdirSync(path.join(target, f), { recursive: true });

const day = (i) => `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;

for (let i = 0; i < count; i++) {
  const links = [];
  for (let l = 0; l < 5; l++) {
    const j = Math.floor(rand() * count);
    if (j !== i) links.push(`[[${noteName(j)}]]`);
  }
  const paragraphs = Array.from({ length: 3 + Math.floor(rand() * 5) }, () =>
    Array.from({ length: 40 }, () => pick(WORDS)).join(" ")
  );
  const body = [
    "---",
    `type: ${pick(TYPES)}`,
    "okf_version: 1.0",
    `datum: ${day(i)}`,
    "tags:",
    `  - ${pick(TAGS)}`,
    `  - ${pick(TAGS)}`,
    "---",
    `# ${noteName(i)}`,
    "",
    `Siehe auch ${links.join(", ")}.`,
    "",
    paragraphs.join("\n\n"),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(target, notePath(i)), body, "utf8");
  if ((i + 1) % 1000 === 0) console.log(`${i + 1}/${count} notes`);
}

// A handful of .base files over the first folders (table view, folder source).
const baseCount = Math.min(5, folderCount);
for (let b = 0; b < baseCount; b++) {
  const base = [
    "filters:",
    "  and:",
    `    - file.folder == "${folders[b]}"`,
    "properties:",
    "  note.datum:",
    "    displayName: Datum",
    "views:",
    "  - type: table",
    "    name: Tabelle",
    "    order:",
    "      - file.name",
    "      - note.datum",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(target, `Datenbank-${b + 1}.base`), base, "utf8");
}

console.log(`done: ${count} notes in ${folderCount} folders, ${baseCount} .base files -> ${target}`);
