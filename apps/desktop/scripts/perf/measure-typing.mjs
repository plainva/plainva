#!/usr/bin/env node
/**
 * Measures what typing in a note costs the UI thread in a REAL desktop window
 * (issue #122; docs/engineering/Vault_Watcher_and_Indexing.md, "Measuring").
 *
 *   node scripts/perf/measure-typing.mjs <vault-dir> [--folder <rel>] [--open] [--cdp http://127.0.0.1:9333] [--rounds 3] [--type-seconds 20] [--settle-seconds 40]
 *
 * It attaches to a running dev build over the WebView's debugging port. With
 * `--open` it first makes `<vault-dir>` the app's only recent vault, reloads,
 * and opens it from the start screen; without, the vault must be open already.
 * It then opens the folders down to a note four levels deep and the note
 * itself — the state somebody typing is in: tree expanded, editor open.
 *
 * Each round it types into that note through the WebView's input pipeline,
 * a character every 150 ms for `--type-seconds`, and keeps watching for
 * `--settle-seconds` more. The app autosaves as it would for a person; every
 * save is an atomic write, and the watcher echoes it. Reported per round:
 *   - the longest gap between two ticks of a 1 ms timer (how long the thread
 *     was held in one piece) and the long tasks (> 50 ms) the browser recorded;
 *   - the IPC round-trips the window made;
 *   - the diagnostics lines about indexing (written since the fix), so the
 *     output says whether a full scan ran, and why.
 *
 * Only a synthetic vault (make-synthetic-vault.mjs) is accepted — the note is
 * really edited. Never point this at a real vault.
 */
/* global document -- the functions handed to page.evaluate run in the app window */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { attach, watchThreadSource } from "./cdp.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const vaultDir = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : null;
if (!vaultDir) {
  console.error("usage: measure-typing.mjs <vault-dir> [--folder rel] [--open] [--cdp url] [--rounds n] [--type-seconds n] [--settle-seconds n]");
  process.exit(2);
}
if (!(await fs.readdir(vaultDir)).includes(".synthetic-vault")) {
  console.error("refusing: not a synthetic vault (no .synthetic-vault marker)");
  process.exit(1);
}
const rounds = Number(option("--rounds", "3"));
const typeSeconds = Number(option("--type-seconds", "20"));
const settleSeconds = Number(option("--settle-seconds", "40"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A folder four levels down that holds notes, unless one was named. */
async function deepFolder() {
  let rel = "Projects";
  for (let level = 0; level < 5; level++) {
    const entries = await fs.readdir(path.join(vaultDir, rel), { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
    // Prefer going deeper: a "Topic"/"Year"/… level before a leaf "Set".
    const next = dirs.find((d) => !d.startsWith("Set ")) ?? dirs[0];
    if (!next) break;
    rel = `${rel}/${next}`;
  }
  return rel;
}
const folder = option("--folder", await deepFolder());

const page = await attach(option("--cdp", "http://127.0.0.1:9333"));

if (args.includes("--open")) {
  await page.evaluate(async (vault) => {
    const { getSettingsStore } = await import("/src/services/settingsStore.ts");
    const store = await getSettingsStore();
    await store.set("recentVaults", [vault]);
    await store.save?.();
  }, vaultDir);
  await page.send("Page.reload");
  await sleep(3000);
  // The start screen lists the vault by its path; a dialog may sit on top of it first.
  await page.waitFor((vault) => {
    for (const button of document.querySelectorAll(".pv-overlay button")) {
      if (/^(Verstanden|Got it|OK)$/i.test(button.textContent.trim())) button.click();
    }
    const row = [...document.querySelectorAll("div, button")].find((e) => e.childElementCount === 0 && e.textContent.trim() === vault);
    if (!row) return false;
    row.click();
    return true;
  }, vaultDir, 120_000);
  // The first open indexes every note; wait until the tree shows the vault
  // (a synthetic vault has a top-level folder of this name), then let it settle.
  await page.waitFor(() => document.body.innerText.split(/\n/).some((line) => line.trim() === "Projects"), null, 60 * 60_000);
  await sleep(20_000);
}

const note = (await fs.readdir(path.join(vaultDir, folder))).filter((n) => n.endsWith(".md")).sort()[0];
const labels = [...folder.split("/"), note.replace(/\.md$/, "")];
for (let i = 0; i < labels.length; i++) {
  // A folder the tree remembers as open already shows the next label;
  // clicking it again would close it.
  await page.waitFor(({ text, next }) => {
    const leaf = (label) => [...document.querySelectorAll("*")].reverse().find((e) => e.childElementCount === 0 && e.textContent.trim() === label);
    if (next && leaf(next)) return true;
    const hit = leaf(text);
    if (!hit) return false;
    hit.click();
    return true;
  }, { text: labels[i], next: labels[i + 1] ?? null }, 30_000);
  await sleep(800);
}
await page.waitFor(() => !!document.querySelector(".cm-content"), null, 30_000);
await sleep(4000);

/** The diagnostics lines about indexing since `since` (written since the fix; none before it). */
const indexDiagnostics = (since) => page.evaluate(async (from) => {
  const source = await (await fetch("/src/adapters/TauriVaultAdapter.ts")).text();
  const ui = /"(\/@fs\/[^"]*packages\/ui\/src\/index\.ts[^"]*)"/.exec(source)?.[1];
  if (!ui) return [];
  const { getDiagnostics } = await import(ui);
  return getDiagnostics().filter((e) => e.source === "index" && e.ts >= from).map((e) => e.message);
}, since);

const results = [];
for (let round = 0; round < rounds; round++) {
  const startedAt = Date.now();
  // Caret to the end of the note, then type.
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content");
    content.focus();
    const selection = document.getSelection();
    selection.selectAllChildren(content);
    selection.collapseToEnd();
  });
  const watching = page.evaluate(watchThreadSource, (typeSeconds + settleSeconds) * 1000);
  const text = ` round ${round}: the quick brown fox jumps over the lazy dog.`;
  let typed = 0;
  // How long each character took to be taken by the window: the call returns
  // once the WebView has handled the input.
  const keystrokes = [];
  const until = Date.now() + typeSeconds * 1000;
  while (Date.now() < until) {
    const sent = performance.now();
    await page.send("Input.insertText", { text: text[typed % text.length] });
    keystrokes.push(performance.now() - sent);
    typed++;
    await sleep(150);
  }
  keystrokes.sort((a, b) => a - b);
  const at = (q) => Math.round(keystrokes[Math.min(keystrokes.length - 1, Math.floor(keystrokes.length * q))] ?? 0);
  const watched = await watching;
  results.push({
    typed,
    keystrokeMs: { median: at(0.5), p95: at(0.95), longest: at(1) },
    ...watched,
    indexDiagnostics: await indexDiagnostics(startedAt),
  });
  await sleep(2000);
}

console.log(JSON.stringify({ vault: vaultDir, note: `${folder}/${note}`, typeSeconds, settleSeconds, rounds: results }, null, 2));
page.close();
