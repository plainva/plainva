#!/usr/bin/env node
/**
 * Builds a synthetic vault for the full-scan measurements
 * (docs/engineering/Vault_Watcher_and_Indexing.md, "Measuring").
 *
 *   node apps/desktop/scripts/perf/make-synthetic-vault.mjs <target-dir> <notes> [--force]
 *
 * Nested the way real vaults are: a few top-level areas, folders up to five
 * levels deep, about a dozen notes per folder, an attachment now and then,
 * and the folders a walk must NOT enter (`.git`, `node_modules`, `.obsidian`)
 * with files in them. Deterministic: the same arguments build the same tree.
 *
 * The target must be a NEW folder or one this script made before (it leaves a
 * marker file): it refuses anything else, so it can never write into, or
 * clear out, a real vault.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const MARKER = ".synthetic-vault";
const [target, countArg, ...flags] = process.argv.slice(2);
const count = Number(countArg);
if (!target || !Number.isInteger(count) || count < 1) {
  console.error("usage: make-synthetic-vault.mjs <target-dir> <notes> [--force]");
  process.exit(2);
}
const root = path.resolve(target);

const existing = await fs.readdir(root).catch(() => null);
if (existing && existing.length > 0) {
  if (!existing.includes(MARKER)) {
    console.error(`refusing: ${root} exists, is not empty and was not made by this script`);
    process.exit(1);
  }
  if (!flags.includes("--force")) {
    console.error(`${root} already holds a synthetic vault; pass --force to rebuild it`);
    process.exit(1);
  }
  await fs.rm(root, { recursive: true, force: true });
}
await fs.mkdir(root, { recursive: true });
await fs.writeFile(path.join(root, MARKER), `synthetic vault, ${count} notes\n`);

const AREAS = ["Projects", "Areas", "Resources", "Archive", "Journal", "People"];
const NOTES_PER_FOLDER = 12;
const folderCount = Math.ceil(count / NOTES_PER_FOLDER);

/** Folder i: an area, then one to four more levels derived from i. */
function folderFor(i) {
  const parts = [AREAS[i % AREAS.length]];
  const depth = 1 + (i % 4);
  let n = Math.floor(i / AREAS.length);
  for (let level = 0; level < depth; level++) {
    parts.push(`${["Topic", "Year", "Client", "Sprint"][level]} ${n % 9}`);
    n = Math.floor(n / 3);
  }
  parts.push(`Set ${i}`);
  return parts.join("/");
}

const body = (i) =>
  `---\ntype: ${i % 3 === 0 ? "Task" : "Note"}\ntags: [fixture, group${i % 12}]\nstatus: ${["open", "doing", "done"][i % 3]}\n---\n# Record ${i}\n\n` +
  Array.from({ length: 5 }, (_, n) => `Paragraph ${n}: deterministic context for [[Record ${(i + 1) % count}]] and #topic${i % 17}.`).join("\n\n") +
  `\n\n- [ ] First task\n- [x] Second task\n`;

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let written = 0;
let attachments = 0;
const folders = new Set();
for (let f = 0; f < folderCount && written < count; f++) {
  const folder = folderFor(f);
  folders.add(folder);
  await fs.mkdir(path.join(root, folder), { recursive: true });
  const jobs = [];
  for (let k = 0; k < NOTES_PER_FOLDER && written < count; k++, written++) {
    jobs.push(fs.writeFile(path.join(root, folder, `Record ${written}.md`), body(written)));
  }
  if (f % 10 === 0) {
    jobs.push(fs.writeFile(path.join(root, folder, `picture ${f}.png`), pixel));
    attachments++;
  }
  await Promise.all(jobs);
}

// What a walk must stay out of.
for (const [dir, files] of [[".git/objects/ab", 40], ["node_modules/pkg/lib", 60], [".obsidian", 5], ["Projects/.venv/lib", 30]]) {
  await fs.mkdir(path.join(root, dir), { recursive: true });
  for (let i = 0; i < files; i++) await fs.writeFile(path.join(root, dir, `internal-${i}.md`), "# not a note\n");
}

console.log(JSON.stringify({ root, notes: written, attachments, folders: folders.size }));
