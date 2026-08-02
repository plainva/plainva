#!/usr/bin/env node
/**
 * Mobile screenshot baseline.
 *
 * Captures every reachable mobile surface at phone size in four themes so a
 * refactor can be compared against a known-good state. The mobile redesign
 * replaces the hand-rolled `.m-*` layer with the shared primitives; the risk of
 * that work is VISUAL, and a visual risk needs a visual net.
 *
 * The images are build artifacts, not repository content: the script recreates
 * them from scratch, so the workflow is "capture before, change, capture after,
 * compare" rather than "commit pixels".
 *
 *   node scripts/screenshot-baseline.mjs                     # -> screenshots/baseline
 *   node scripts/screenshot-baseline.mjs --out screenshots/after
 *   node scripts/screenshot-baseline.mjs --compare screenshots/baseline screenshots/after
 *
 * Options:
 *   --out <dir>        output directory (default screenshots/baseline)
 *   --themes a,b       subset of light,dark,lcars,win95
 *   --only a,b         subset of surface ids
 *   --port <n>         preview port (default 1441 — never 1420/1430, which
 *                      belong to the desktop E2E and the normal mobile dev
 *                      server; a maintainer session may own those)
 *   --base-url <url>   use an already running server instead of building one
 *   --dev              serve from the dev server instead of a production build
 *
 * A production build is served on purpose: the dev server ships every module
 * as its own request, which turns a fresh page load into seconds and a full
 * run into hours. The bundle also removes dev-only timing from the pictures.
 *
 * The app runs in a plain browser here: the Capacitor filesystem falls back to
 * IndexedDB (a fresh context therefore seeds the welcome vault), while the
 * SQLite index and every native plugin are absent. Surfaces that need those —
 * search results, mail, calendar — are captured in their empty/fallback state,
 * which is exactly what this baseline is comparing.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ config */

const VIEWPORT = { width: 375, height: 812 }; // iPhone 13 CSS pixels
const DEVICE_SCALE = 2;
/** Frozen wall clock — see the note where it is installed. */
const FIXED_TIME = new Date("2026-08-02T09:00:00Z");

/**
 * Theme profiles. LCARS and Windows 95 are easter-egg gated in the picker, so
 * the seed unlocks them; both pin their mode, which is why `themeMode` is only
 * meaningful for the two petrol rows.
 */
const THEMES = {
  light: { themeMode: "light", themeName: "petrol" },
  dark: { themeMode: "dark", themeName: "petrol" },
  // A theme mobile was NEVER docked into, added in S7 as the evidence for E9
  // ("all 14 themes carry mobile"). Nord is a pure token override: nothing in
  // it names a single `.m-` selector. If the mobile surfaces paint through the
  // shared tokens, this row is a fully Nord-coloured phone; if any of them
  // reach for a literal, this row is where it shows.
  nord: { themeMode: "dark", themeName: "nord" },
  lcars: { themeMode: "dark", themeName: "lcars", unlockedThemes: ["lcars", "win95"] },
  win95: { themeMode: "light", themeName: "win95", unlockedThemes: ["lcars", "win95"] },
};

/** Written into CapacitorStorage before the app boots (Preferences web store). */
const SETTINGS_KEY = "CapacitorStorage.mobile-settings";
/**
 * The release-highlights sheet covers every surface with a modal backdrop on
 * the first start of a version. Its "seen" marker is compared for EQUALITY, so
 * seeding a high version would trigger it rather than silence it — the run
 * dismisses the sheet the way a user does instead.
 */
const WHATS_NEW_SHEET = '[data-testid="whats-new-sheet"]';

const BASE_SETTINGS = {
  onboarded: true,
  language: "de",
  motion: "off", // no transitions mid-capture
  barTabCount: 5,
  tabSlots: ["notes", "today", "tasks", "calendar", "mail", "graph"],
};

const AREAS_SWITCH = '[data-testid="areas-switch"]';
const SETTINGS_BTN = '[data-testid="tab-settings"]';

/** Opens the areas sheet and picks one of the six work areas. */
const area = (id) => [{ click: AREAS_SWITCH }, { click: `[data-testid="areas-${id}"]` }];
/** Opens the settings master list and pushes one catalog area. */
const settingsArea = (id) => [{ click: SETTINGS_BTN }, { click: `[data-testid="settings-area-${id}"]` }];

/**
 * Surface catalog. Every entry starts from a fresh page load on the notes tab;
 * a failing step marks that one surface as failed and the run continues, so a
 * single broken path never costs the whole baseline.
 */
const SURFACES = [
  { id: "onboarding", seed: { onboarded: false }, steps: [] },
  { id: "home", steps: [] },
  { id: "home-folder", steps: [{ click: ".m-page .m-row", nth: 0 }] },
  { id: "note-read", steps: [{ click: ".m-caro-card", nth: 0 }] },
  { id: "note-edit", steps: [{ click: ".m-caro-card", nth: 0 }, { click: '[data-testid="note-edit"]' }] },
  { id: "note-context", steps: [{ click: ".m-caro-card", nth: 0 }, { click: '[data-testid="note-context"]' }] },
  { id: "note-menu", steps: [{ click: ".m-caro-card", nth: 0 }, { click: '[data-testid="note-menu"]' }] },
  { id: "search", steps: [{ click: '[data-testid="tab-search"]' }] },
  { id: "areas-sheet", steps: [{ click: AREAS_SWITCH }] },
  { id: "quick-create", steps: [{ click: '[data-testid="capture-fab"]' }] },
  { id: "today", steps: area("today") },
  // Tags and databases are navigator TABS since S9, not areas of their own —
  // captured where they now live. Bookmarks are a pinned section on the same
  // root and therefore already in `home`.
  { id: "navigator-tags", steps: [{ click: '[data-testid="navigator-tags"]' }] },
  { id: "navigator-databases", steps: [{ click: '[data-testid="navigator-databases"]' }] },
  { id: "calendar", steps: area("calendar") },
  { id: "mail", steps: area("mail") },
  { id: "tasks", steps: area("tasks") },
  { id: "graph", steps: area("graph") },
  /**
   * The areas sheet pushes an OVERLAY for areas outside the bar, so it does not
   * exercise the tab router. These two put the area into the bar and tap it, so
   * the baseline also holds what the real tab route renders — which is how the
   * missing `tasks` branch became visible in the first place.
   */
  { id: "tab-tasks", seed: { tabSlots: ["tasks", "graph", "mail"], barTabCount: 3 }, steps: [{ click: ".m-tabbar .m-tab", nth: 0 }] },
  { id: "tab-graph", seed: { tabSlots: ["graph", "tasks", "mail"], barTabCount: 3 }, steps: [{ click: ".m-tabbar .m-tab", nth: 0 }] },
  { id: "settings", steps: [{ click: SETTINGS_BTN }] },
  { id: "settings-appearance", steps: settingsArea("appearance") },
  { id: "settings-editor", steps: settingsArea("editor") },
  { id: "settings-about", steps: settingsArea("about") },
  { id: "settings-cloud-accounts", steps: settingsArea("cloudAccounts") },
  { id: "settings-sync", steps: settingsArea("sync") },
  { id: "settings-security", steps: settingsArea("security") },
  { id: "settings-pim", steps: settingsArea("pim") },
  { id: "settings-mail", steps: settingsArea("mail") },
  { id: "settings-content", steps: settingsArea("content") },
  { id: "settings-backup", steps: settingsArea("backup") },
  { id: "settings-navbar", steps: [{ click: SETTINGS_BTN }, { click: '[data-testid="settings-navbar"]' }] },
  { id: "vaults", steps: [{ click: SETTINGS_BTN }, { click: '[data-testid="settings-vault-block"]' }] },
];

/* -------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = { out: "screenshots/baseline", port: 1441, themes: null, only: null, baseUrl: null, compare: null, dev: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") out.out = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--themes") out.themes = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--only") out.only = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--dev") out.dev = true;
    else if (a === "--compare") out.compare = [argv[++i], argv[++i]];
    else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

/* ----------------------------------------------------------------- compare */

async function hashDir(dir) {
  const files = {};
  for (const theme of await readdir(dir).catch(() => [])) {
    const themeDir = join(dir, theme);
    for (const name of await readdir(themeDir).catch(() => [])) {
      if (!name.endsWith(".png")) continue;
      const buf = await readFile(join(themeDir, name));
      files[`${theme}/${name}`] = createHash("sha256").update(buf).digest("hex");
    }
  }
  return files;
}

async function compare(a, b) {
  const [ha, hb] = [await hashDir(a), await hashDir(b)];
  const keys = [...new Set([...Object.keys(ha), ...Object.keys(hb)])].sort();
  const changed = [];
  const onlyA = [];
  const onlyB = [];
  let same = 0;
  for (const k of keys) {
    if (!hb[k]) onlyA.push(k);
    else if (!ha[k]) onlyB.push(k);
    else if (ha[k] !== hb[k]) changed.push(k);
    else same += 1;
  }
  console.log(`identical: ${same}`);
  console.log(`changed:   ${changed.length}`);
  for (const k of changed) console.log(`  ~ ${k}`);
  if (onlyA.length) console.log(`only in ${a}:\n${onlyA.map((k) => `  - ${k}`).join("\n")}`);
  if (onlyB.length) console.log(`only in ${b}:\n${onlyB.map((k) => `  + ${k}`).join("\n")}`);
  return changed.length === 0 && onlyA.length === 0 && onlyB.length === 0;
}

/* -------------------------------------------------------------- dev server */

async function waitForServer(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > until) throw new Error(`dev server did not come up at ${url}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function runOnce(cmd, cmdArgs) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, cmdArgs, { cwd: APP_DIR, stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${cmdArgs.join(" ")} exited ${code}`))));
  });
}

/**
 * A server already on the port would be silently served INSTEAD of this build —
 * the run would compare against a stale bundle and could report "identical" for
 * a change that is in fact visible. Refuse rather than lie.
 */
async function assertPortFree(port) {
  const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(700) }).catch(() => null);
  if (res) {
    throw new Error(
      `port ${port} already serves something — a leftover server would be captured instead of this build. ` +
        `Stop it (or pass --port) and run again.`
    );
  }
}

function startServer(port, dev) {
  const cmdArgs = dev
    ? ["vite", "--port", String(port), "--strictPort"]
    : ["vite", "preview", "--port", String(port), "--strictPort"];
  const child = spawn("npx", cmdArgs, { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(String(d)));
  return child;
}

/* ---------------------------------------------------------------- capture */

/** Taps the release highlights away when this start owes them. */
async function dismissWhatsNew(page) {
  const sheet = page.locator(WHATS_NEW_SHEET);
  if ((await sheet.count()) === 0) return;
  // Addressed by test id, not by a style class: a class is a look and moves
  // with every redesign step — and when it moves, the sheet silently stays
  // open and blocks every later click, which reads like a broken app.
  await sheet.locator('[data-testid="whats-new-close"]').click({ timeout: 4000 });
  await page.waitForTimeout(300);
}

async function runSteps(page, surface) {
  for (const step of surface.steps) {
    if (step.wait) {
      await page.waitForTimeout(step.wait);
      continue;
    }
    const loc = page.locator(step.click).nth(step.nth ?? 0);
    await loc.waitFor({ state: "visible", timeout: 8000 });
    await loc.click();
    await page.waitForTimeout(500);
  }
}

async function captureTheme(browser, themeId, baseUrl, outDir, surfaces) {
  const dir = join(outDir, themeId);
  await mkdir(dir, { recursive: true });
  const results = [];
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    isMobile: true,
    hasTouch: true,
    locale: "de-DE",
    colorScheme: THEMES[themeId].themeMode === "dark" ? "dark" : "light",
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(8000);
  // Relative timestamps ("in dieser Minute") and today's date would make two
  // runs differ for no reason, and a comparison that always reports noise is
  // worth nothing. Only the clock READING is fixed — timers keep running, so
  // the boot sequence is untouched.
  await context.clock.setFixedTime(FIXED_TIME);

  for (const surface of surfaces) {
    const settings = { ...BASE_SETTINGS, ...THEMES[themeId], ...(surface.seed ?? {}) };
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(String(e.message)));
    await page.addInitScript(
      (entries) => {
        for (const [key, value] of entries) globalThis.localStorage.setItem(key, value);
      },
      [[SETTINGS_KEY, JSON.stringify(settings)]],
    );
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      // The shell is up once either the onboarding or the app bar rendered.
      await page.waitForSelector(".m-appbar, .m-onboard, .m-page", { timeout: 20_000 });
      await page.waitForTimeout(1200); // first context seeds the welcome vault
      await dismissWhatsNew(page);
      await runSteps(page, surface);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, `${surface.id}.png`) });
      results.push({ surface: surface.id, ok: true, problems });
      process.stdout.write(`  ok   ${themeId}/${surface.id}\n`);
    } catch (err) {
      results.push({ surface: surface.id, ok: false, error: String(err).split("\n")[0], problems });
      process.stdout.write(`  FAIL ${themeId}/${surface.id} — ${String(err).split("\n")[0]}\n`);
    } finally {
      await page.close();
    }
  }
  await context.close();
  return results;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) {
    const ok = await compare(resolve(APP_DIR, args.compare[0]), resolve(APP_DIR, args.compare[1]));
    process.exit(ok ? 0 : 1);
  }

  const themes = (args.themes ?? Object.keys(THEMES)).filter((t) => {
    if (THEMES[t]) return true;
    throw new Error(`unknown theme: ${t}`);
  });
  const surfaces = args.only ? SURFACES.filter((s) => args.only.includes(s.id)) : SURFACES;
  if (surfaces.length === 0) throw new Error("no surfaces selected");

  const outDir = resolve(APP_DIR, args.out);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const baseUrl = args.baseUrl ?? `http://localhost:${args.port}/`;
  let server = null;
  if (!args.baseUrl) {
    await assertPortFree(args.port);
    if (!args.dev) {
      process.stdout.write("building…\n");
      await runOnce("npx", ["vite", "build"]);
    }
    server = startServer(args.port, args.dev);
    await waitForServer(baseUrl);
  }

  const browser = await chromium.launch();
  const report = { capturedAt: new Date().toISOString(), viewport: VIEWPORT, deviceScale: DEVICE_SCALE, themes: {} };
  try {
    for (const theme of themes) {
      process.stdout.write(`\n[${theme}]\n`);
      report.themes[theme] = await captureTheme(browser, theme, baseUrl, outDir, surfaces);
    }
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }

  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const all = Object.values(report.themes).flat();
  const failed = all.filter((r) => !r.ok);
  process.stdout.write(`\n${all.length - failed.length}/${all.length} surfaces captured -> ${outDir}\n`);
  if (failed.length) {
    process.stdout.write(`failed: ${failed.map((f) => f.surface).join(", ")}\n`);
    process.exit(1);
  }
}

await main();
