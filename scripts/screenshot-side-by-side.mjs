#!/usr/bin/env node
/**
 * Puts two screenshot runs side by side in one HTML page.
 *
 *   node scripts/screenshot-side-by-side.mjs <before-dir> <after-dir> <out.html>
 *
 * Works for both capture tools (docs/engineering/Screenshot_Captures.md): the
 * phone baseline writes `<theme>/<surface>.png`, the desktop walk
 * `<scheme>/<scene>.png`. Pictures are paired by their path below the two
 * directories; a picture that exists on one side only is listed on its own,
 * and a pair whose bytes are identical is marked as such, so a reviewer looks
 * at what changed first. The page references the files where they are; it
 * copies nothing.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

async function pngs(root, dir = root) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await pngs(root, full)));
    else if (entry.name.endsWith(".png")) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function main() {
  const [beforeArg, afterArg, outArg] = process.argv.slice(2);
  if (!beforeArg || !afterArg || !outArg) {
    console.error("usage: node scripts/screenshot-side-by-side.mjs <before-dir> <after-dir> <out.html>");
    process.exit(2);
  }
  const before = resolve(beforeArg);
  const after = resolve(afterArg);
  const out = resolve(outArg);
  const left = new Set(await pngs(before));
  const right = new Set(await pngs(after));
  const names = [...new Set([...left, ...right])].sort();
  const link = (root, name) => relative(dirname(out), join(root, name)).split(sep).join("/");
  const rows = [];
  let changed = 0;
  let same = 0;
  for (const name of names) {
    const a = left.has(name);
    const b = right.has(name);
    let state = a && b ? "changed" : a ? "before only" : "after only";
    if (a && b && (await hash(join(before, name))) === (await hash(join(after, name)))) state = "identical";
    if (state === "identical") same++;
    else changed++;
    const cell = (has, root) => (has ? `<a href="${esc(link(root, name))}"><img loading="lazy" src="${esc(link(root, name))}" alt=""></a>` : "<p>—</p>");
    rows.push(`<section class="${state === "identical" ? "same" : ""}"><h2>${esc(name)} <small>${state}</small></h2><div class="pair">${cell(a, before)}${cell(b, after)}</div></section>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Before / after</title>
<style>
:root{color-scheme:light dark;font:14px system-ui,sans-serif}body{margin:16px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{max-width:100%;border:1px solid #8884}
h2{font-size:14px;margin:24px 0 8px}small{font-weight:400;opacity:.7}
label{display:block;margin:8px 0}body.hide-same .same{display:none}
</style>
<h1>Before / after</h1>
<p>Left: ${esc(before)}<br>Right: ${esc(after)}<br>${changed} differing, ${same} identical.</p>
<label><input type="checkbox" onchange="document.body.classList.toggle('hide-same', this.checked)" checked> Hide identical pairs</label>
<script>document.body.classList.add('hide-same')</script>
${rows.join("\n")}
`;
  await writeFile(out, html, "utf8");
  console.log(`${changed} differing, ${same} identical -> ${out}`);
}

await main();
