#!/usr/bin/env node
/**
 * Measures a full vault scan inside a REAL desktop window — real WebView, real
 * IPC bridge, real SQL plugin — and what it asked of the UI thread meanwhile
 * (docs/engineering/Vault_Watcher_and_Indexing.md, "Measuring").
 *
 *   node scripts/perf/measure-full-scan.mjs <vault-dir> [--cdp http://127.0.0.1:9333] [--rounds 5] [--db-dir <dir>]
 *
 * It attaches to a running dev build over the WebView's debugging port and
 * imports the app's own modules from the dev server there, so what runs is the
 * code of the checkout, not a copy. Start that build under its OWN identity
 * and port — never the installed app, never port 1420 (see the note).
 *
 * For each of the two walkers (the native `vault_walk` command, and the
 * frontend walker that hosts without the command still use) it reports, as
 * the median over the rounds:
 *   walk — `listDirReport("", true)` alone
 *   scan — `VaultIndexer.indexVaultFull()` on an index that is up to date
 * each with the wall time, the IPC round-trips, how often a 1 ms timer got
 * its turn (the idle thread manages about 250 a second), the longest gap
 * between two of its ticks, and the long tasks (> 50 ms) the browser recorded.
 *
 * The vault is only read. The index goes to its own database file under
 * `--db-dir` (default: next to the vault), never into the vault.
 */
import * as path from "node:path";
import { attach, watchThreadSource } from "./cdp.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const vaultDir = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : null;
if (!vaultDir) {
  console.error("usage: measure-full-scan.mjs <vault-dir> [--cdp url] [--rounds n] [--db-dir dir]");
  process.exit(2);
}
const rounds = Number(option("--rounds", "5"));
const dbDir = path.resolve(option("--db-dir", path.dirname(vaultDir)));
const dbUrl = `sqlite:${path.join(dbDir, `perf-index-${path.basename(vaultDir)}.db`)}`;

const page = await attach(option("--cdp", "http://127.0.0.1:9333"));

const measure = `async ({ vaultDir, dbUrl, rounds }) => {
  const watchThread = ${watchThreadSource};
  const adapterSource = await (await fetch("/src/adapters/TauriVaultAdapter.ts")).text();
  const coreUrl = /"(\\/@fs\\/[^"]*packages\\/core\\/src\\/index\\.ts[^"]*)"/.exec(adapterSource)[1];
  const { TauriVaultAdapter } = await import("/src/adapters/TauriVaultAdapter.ts");
  const { TauriDatabaseAdapter } = await import("/src/adapters/TauriDatabaseAdapter.ts");
  const core = await import(coreUrl);

  /** Runs work() and watches the UI thread until it is done. */
  const watched = async (work) => {
    let done = false;
    let value;
    let ms = 0;
    // The watcher runs in slices; the last slice that overlaps the work counts.
    const slices = [];
    const watching = (async () => {
      while (!done) slices.push(await watchThread(250));
    })();
    const started = performance.now();
    value = await work();
    ms = performance.now() - started;
    done = true;
    await watching;
    return {
      value,
      ms,
      longestGapMs: Math.max(...slices.map((s) => s.longestGapMs)),
      longTasks: slices.reduce((a, s) => a + s.longTasks, 0),
      blockedMs: slices.reduce((a, s) => a + s.blockedMs, 0),
      ipcRoundTrips: slices.reduce((a, s) => a + s.ipcRoundTrips, 0),
      timerTicksPerSecond: Math.round(slices.reduce((a, s) => a + s.timerTicksPerSecond, 0) / slices.length),
    };
  };
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summarize = (runs) => ({
    ms: Math.round(median(runs.map((r) => r.ms))),
    ipcRoundTrips: median(runs.map((r) => r.ipcRoundTrips)),
    timerTicksPerSecond: median(runs.map((r) => r.timerTicksPerSecond)),
    longestGapMs: median(runs.map((r) => r.longestGapMs)),
    worstGapMs: Math.max(...runs.map((r) => r.longestGapMs)),
    longTasks: median(runs.map((r) => r.longTasks)),
    blockedMs: median(runs.map((r) => r.blockedMs)),
  });

  // The idle thread, so the numbers below can be read against it. A window
  // the system considers hidden throttles its timers; then nothing here means much.
  const idle = await watchThread(500);

  const db = new TauriDatabaseAdapter(dbUrl);
  await db.initialize();
  await core.initializeSchema(db);
  const out = { visibility: document.visibilityState, idle: { longestGapMs: idle.longestGapMs, timerTicksPerSecond: idle.timerTicksPerSecond } };
  try {
    for (const walker of ["native", "frontend"]) {
      const adapter = new TauriVaultAdapter(vaultDir);
      if (walker === "frontend") adapter.nativeWalk = false;
      const indexer = new core.VaultIndexer(adapter, db);
      // Brings the index up to date (the first run parses every note) and
      // sets the folder baseline; not part of the measurement.
      const prepared = await indexer.indexVaultFull("measurement: prepare");
      const walks = [];
      const scans = [];
      let entries = 0;
      let report = null;
      for (let i = 0; i < rounds; i++) {
        const walk = await watched(() => adapter.listDirReport("", true));
        entries = walk.value.files.length;
        walks.push(walk);
        const scan = await watched(() => indexer.indexVaultFull("measurement"));
        report = scan.value;
        scans.push(scan);
      }
      out[walker] = {
        prepared: { added: prepared.added, changed: prepared.changed, removed: prepared.removed, ms: Math.round(prepared.durationMs) },
        entries,
        unchanged: report.added + report.changed + report.removed === 0 && !report.foldersChanged,
        walk: summarize(walks),
        scan: summarize(scans),
      };
    }
  } finally {
    await db.close().catch(() => {});
  }
  return out;
}`;

const result = await page.evaluate(measure, { vaultDir, dbUrl, rounds });
console.log(JSON.stringify({ vault: vaultDir, rounds, ...result }, null, 2));
page.close();
