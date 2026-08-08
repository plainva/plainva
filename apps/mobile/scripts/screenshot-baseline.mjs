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
 * IndexedDB (a fresh context therefore seeds the welcome vault) and the native
 * plugins are absent. The SQLite index used to be absent as well, which made
 * this baseline photograph empty states and call them covered — the "graph"
 * picture showed "the map appears once the search index is built" in all 180
 * images. Since the rework's N0.1 the run supplies a REAL `node:sqlite` over a
 * bridge (see `screenshot-fixture.mjs`) plus the content the surfaces need, so
 * the graph, the accounts and the attachments are photographed as themselves.
 *
 * Surfaces that still cannot be rendered — anything needing a live network
 * (mail bodies, calendar sync) — stay empty on purpose and must be reported as
 * UNVERIFIED rather than green.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  FIXTURE_ATTACHMENTS,
  FIXTURE_BOOKMARKS,
  FIXTURE_BASE,
  FIXTURE_NOTES,
  FIXTURE_TASK_BASE,
  FIXTURE_TASKS,
  fixtureStorage,
  installSqlBridge,
  seedFixtureContent,
} from "./screenshot-fixture.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ config */

const VIEWPORT = { width: 375, height: 812 }; // iPhone 13 CSS pixels
/**
 * The same phone turned on its side (N1.4).
 *
 * Landscape is not cosmetic here: on width alone a phone in this orientation
 * clears the 840 px "expanded" breakpoint and would be given the tablet's
 * two-column layout. Only a capture at these numbers can show that it is not.
 */
const VIEWPORT_LANDSCAPE = { width: 812, height: 375 };
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
  // The legacy bar fields (S10): the shell migrates them into the shared bar
  // model on first open, so seeding them still decides what the bar shows.
  barTabCount: 4,
  tabSlots: ["notes", "today", "tasks", "calendar", "mail", "graph"],
  // The task database the second section renders (N9.4). Without it the tasks
  // surface could only ever be photographed with its database section absent.
  taskDatabase: "Aufgaben.base",
};

// The bar's fixed last entry opens the areas sheet (S10 — it replaced the ▾
// next to the title), and settings sit at the foot of the navigator (S11 — a ⋮
// carries object actions, never the app settings).
const AREAS_SWITCH = '[data-testid="tab-areas"]';
const SETTINGS_BTN = '[data-testid="nav-settings"]';

/**
 * Floor the fixture has to clear before ANY surface of a run counts as
 * verified. The three seeded notes of the welcome vault plus ten fixture notes
 * and two attachments; the links are what gives the graph a shape. Deliberately
 * below the real numbers — this is a starvation guard, not a pinned count.
 */
const FIXTURE_MIN_FILES = 12;
const FIXTURE_MIN_LINKS = 15;

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
  { id: "home-folder", steps: [{ click: ".m-page .pv-grouprow", nth: 0 }] },
  { id: "note-read", steps: [{ click: ".m-caro-card", nth: 0 }] },
  { id: "note-edit", steps: [{ click: ".m-caro-card", nth: 0 }, { click: '[data-testid="note-edit"]' }] },
  { id: "note-context", steps: [{ click: ".m-caro-card", nth: 0 }, { click: '[data-testid="note-context"]' }] },
  { id: "note-menu", steps: [{ click: ".m-caro-card", nth: 0 }, { click: '[data-testid="note-menu"]' }] },
  { id: "search", steps: [{ click: '[data-testid="appbar-search"]' }] },
  { id: "areas-sheet", steps: [{ click: AREAS_SWITCH }] },
  { id: "quick-create", steps: [{ click: '[data-testid="capture-fab"]' }] },
  { id: "today", steps: area("today") },
  // Tags and databases are navigator TABS since S9, not areas of their own —
  // captured where they now live. Bookmarks are a pinned section on the same
  // root and therefore already in `home`.
  { id: "navigator-tags", steps: [{ click: '[data-testid="navigator-tags"]' }] },
  { id: "navigator-databases", steps: [{ click: '[data-testid="navigator-databases"]' }] },
  // The pinboard is the first view of the seeded database, so opening it lands
  // on the surface rather than needing a view switch the capture cannot make.
  { id: "base-pinboard", steps: [{ click: '[data-testid="navigator-databases"]' }, { click: ".m-page .pv-grouprow", nth: 0 }] },
  { id: "calendar", steps: area("calendar") },
  { id: "mail", steps: area("mail") },
  /**
   * The same surface with conversations ON. It exists because the mode was
   * reported as a switch that "cannot be activated at all": measured, it flips
   * correctly, but in a mailbox where every conversation is a single message
   * the list looks identical afterwards — so nothing on screen said the mode
   * was on. The state now sits on the mailbox line, and this is the picture
   * that keeps it there. (The list itself stays unverified here: envelopes come
   * from an IMAP server, which no fixture can be.)
   *
   * It CLICKS the switch rather than seeding it, and that is not a stylistic
   * choice: `mailThreads` is a PER-VAULT field, and a surface `seed` writes the
   * app-wide record. Per-vault values only ever arrive from there through the
   * one-time migration on a context's FIRST page — every later surface already
   * has a vault record, so its seed is silently dropped and the picture shows
   * the default while claiming to show the mode. Per-vault state gets set the
   * way a user sets it: through the control.
   */
  {
    id: "mail-threads",
    steps: [...area("mail"), { click: '[data-testid="mail-threads-toggle"]' }, { wait: 500 }],
  },
  { id: "tasks", steps: area("tasks") },
  /* The SECOND section — every checkbox in the vault, grouped by note. It sits
     below the fold behind the database section, so no capture had ever shown
     it; the round that rebuilt both had to be able to look at both. */
  { id: "tasks-notes", steps: [...area("tasks"), { scrollTo: '[data-testid="task-row"]', nth: -1 }] },
  { id: "graph", steps: area("graph") },
  /**
   * The graph's tools sheet (N9.6). It was never photographed, which is how a
   * row that sat permanently disabled — focus, the map's most useful function
   * on a small screen — survived from birth: it is two taps deep and no
   * capture ever went there.
   */
  { id: "graph-tools", steps: [...area("graph"), { click: '[data-testid="graph-tools"]' }] },
  /** And what the focus row asks now, instead of doing nothing. */
  {
    id: "graph-focus-pick",
    steps: [
      ...area("graph"),
      { click: '[data-testid="graph-tools"]' },
      { click: '[data-testid="graph-tool-focus"]' },
    ],
  },
  /**
   * The areas sheet pushes an OVERLAY for areas outside the bar, so it does not
   * exercise the tab router. These two put the area into the bar and tap it, so
   * the baseline also holds what the real tab route renders — which is how the
   * missing `tasks` branch became visible in the first place.
   */
  // Notes leads in both: the bar model pins it, so the seeded area is second.
  { id: "tab-tasks", seed: { tabSlots: ["tasks", "graph", "mail"], barTabCount: 3 }, steps: [{ click: ".m-tabbar .m-tab", nth: 1 }] },
  { id: "tab-graph", seed: { tabSlots: ["graph", "tasks", "mail"], barTabCount: 3 }, steps: [{ click: ".m-tabbar .m-tab", nth: 1 }] },
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
  // "Bars & areas" is the navigation bar on a phone; since S39 it is the shared
  // catalog's area rather than a mobile-only settings row.
  { id: "settings-navbar", steps: settingsArea("bars") },
  // The two areas the phone gained in S39 — the matrix has to see them, or the
  // step that adds them compares as "nothing changed".
  { id: "settings-behavior", steps: settingsArea("behavior") },
  { id: "settings-maintenance", steps: settingsArea("maintenance") },
  // The import wizard's first step (S41). It opens from maintenance; the later
  // steps need a picked file, which a headless run cannot supply.
  {
    id: "import-wizard",
    steps: [...settingsArea("maintenance"), { click: '[data-testid="open-import"]' }],
  },
  { id: "vaults", steps: [{ click: SETTINGS_BTN }, { click: '[data-testid="settings-vault-block"]' }] },
  // The vault DETAIL page — the matrix carried only the list, so S36's rebuild
  // of the most overloaded surface in the app would have been invisible to it.
  {
    id: "vault-detail",
    steps: [
      { click: SETTINGS_BTN },
      { click: '[data-testid="settings-vault-block"]' },
      { click: '[data-testid="vault-details"]' },
    ],
  },
  // The two destinations the vault detail gained in N4.3 (the sync chain and
  // the diagnostics report) are NOT in this catalog: the fixture's vault has no
  // provider, so the rows that lead to them do not exist and an entry here
  // would fail on every run — a permanently red line teaches the eye to skip
  // failures. They stay in the loop's list of what the fixture cannot show.
  /**
   * The four surfaces the matrix could never show (rework N0.1). Each one is
   * the picture that a rebuild step in N3/N4/N6/N7 has to be judged against —
   * without them, "nothing changed" was the only possible verdict.
   */
  // The graph WITH a graph. `settings-cloud-accounts` above shows the settings
  // catalog entry; this is the accounts surface itself, now carrying accounts.
  { id: "cloud-accounts", steps: settingsArea("cloudAccounts") },
  // What the chevron promises since N4.2: THIS account, not the list of every
  // calendar account there is.
  {
    id: "cloud-account-detail",
    steps: [...settingsArea("cloudAccounts"), { click: '[data-testid="cloudacct-row"]', nth: 0 }],
  },
  // An attachments folder: non-Markdown files in the browse list. Addressed by
  // its name rather than by position — the tree's ordering is not this
  // surface's subject, and an `nth` would silently photograph a folder of
  // notes the day the sort changes.
  {
    id: "attachments",
    steps: [{ click: '[data-testid="navigator-files"]' }, { click: '.pv-grouprow:has-text("Anhaenge")' }],
  },
  /**
   * The vault detail of a CLOUD vault. `vault-detail` above shows the local
   * one, which has no provider and therefore never renders the sync chain,
   * the diagnostics block or most of the nine full-width buttons § 3.1 is
   * about — the worst surface in the app was photographed in its mildest
   * state. This is the one the rebuild in N3.1/N4.3 gets judged against.
   */
  {
    id: "vault-detail-cloud",
    steps: [
      { click: SETTINGS_BTN },
      { click: '[data-testid="settings-vault-block"]' },
      { click: '[data-testid="vault-details"]', nth: 1 },
    ],
  },
  /**
   * A vault with genuinely nothing in it — the empty state nobody had seen.
   * The vault rows carry no per-vault test id, so the fixture's second
   * registry entry is addressed by position; switching vaults reboots the
   * shell, hence the beat afterwards.
   */
  {
    id: "empty-vault",
    steps: [
      { click: SETTINGS_BTN },
      { click: '[data-testid="settings-vault-block"]' },
      { click: ".m-row--split .m-row-main", nth: 1 },
      { wait: 2500 },
    ],
  },
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
    else if (a === "--landscape") out.landscape = true;
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

/**
 * Starts the preview server in its OWN process group.
 *
 * `npx` spawns vite as a grandchild, so signalling the child alone leaves the
 * server listening — the next run then hits `assertPortFree` and refuses to
 * start, which is what actually happened during N0.1. Killing the group takes
 * the whole tree down.
 */
function startServer(port, dev) {
  const cmdArgs = dev
    ? ["vite", "--port", String(port), "--strictPort"]
    : ["vite", "preview", "--port", String(port), "--strictPort"];
  const child = spawn("npx", cmdArgs, { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(String(d)));
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM"); // negative pid = the whole group
  } catch {
    child.kill("SIGTERM");
  }
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
    // Bringing a surface's LOWER half into view is the only way to photograph
    // it: a phone screen is 812 px and several surfaces are longer (N9.4).
    if (step.scrollTo) {
      // `nth: -1` means the last match — "scroll to the end of this list"
      // survives a fixture that grows, a fixed index does not.
      const all = page.locator(step.scrollTo);
      const target = step.nth === -1 ? all.last() : all.nth(step.nth ?? 0);
      await target.waitFor({ state: "attached", timeout: 8000 });
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      continue;
    }
    const loc = page.locator(step.click).nth(step.nth ?? 0);
    await loc.waitFor({ state: "visible", timeout: 8000 });
    await loc.click();
    await page.waitForTimeout(500);
  }
}

/**
 * First boot of a context: lets the app seed its welcome vault, then adds the
 * fixture on top and reloads so the indexer picks everything up. Returns the
 * evidence the run needs — how many files and links the index really holds.
 * A capture that cannot prove this must report its surfaces as unverified
 * rather than green (rework N0.1).
 */
async function seedContext(context, baseUrl, sql, themeId) {
  const settings = { ...BASE_SETTINGS, ...THEMES[themeId] };
  const page = await context.newPage();
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) globalThis.localStorage.setItem(key, value);
  }, [[SETTINGS_KEY, JSON.stringify(settings)]]);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".m-appbar, .m-onboard, .m-page", { timeout: 20_000 });
    await page.waitForTimeout(1500); // welcome vault seeds on the first load
    await seedFixtureContent(page, {
      notes: [
        ...FIXTURE_NOTES,
        ...FIXTURE_TASKS,
        ["Projekte.base", FIXTURE_BASE],
        ["Aufgaben.base", FIXTURE_TASK_BASE],
        [".plainva/bookmarks.json", FIXTURE_BOOKMARKS],
      ],
      attachments: FIXTURE_ATTACHMENTS,
      storage: fixtureStorage(),
    });
    // Calendar accounts live in the index database, not in Preferences.
    sql.seedPim("plainva-index");
    // Reload so the indexer walks the enlarged vault.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".m-appbar, .m-onboard, .m-page", { timeout: 20_000 });
    await page.waitForTimeout(3000);
  } finally {
    await page.close();
  }
  return {
    files: sql.count("plainva-index", "files"),
    links: sql.count("plainva-index", "links"),
    pimAccounts: sql.count("plainva-index", "pim_accounts"),
  };
}

async function captureTheme(browser, themeId, baseUrl, outDir, surfaces, landscape = false) {
  const dir = join(outDir, themeId);
  await mkdir(dir, { recursive: true });
  const results = [];
  const context = await browser.newContext({
    viewport: landscape ? VIEWPORT_LANDSCAPE : VIEWPORT,
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

  // A real SQLite behind the app, then the content the surfaces need. Both
  // belong to the CONTEXT: the index has to stay warm across the surfaces of
  // one theme, or every page would re-index and the pictures would catch it
  // half-built.
  const sql = await installSqlBridge(context);
  const index = await seedContext(context, baseUrl, sql, themeId);
  process.stdout.write(
    `  fixture: ${index.files} files, ${index.links} links, ${index.pimAccounts} calendar account(s)\n`,
  );

  for (const surface of surfaces) {
    const settings = { ...BASE_SETTINGS, ...THEMES[themeId], ...(surface.seed ?? {}) };
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(String(e.message)));
    await page.addInitScript(
      (entries) => {
        for (const [key, value] of entries) globalThis.localStorage.setItem(key, value);
        // The legacy bar fields are migrated into the shared bar model ONCE per
        // vault, and the vault outlives the page: without this, only the first
        // surface's seed ever decided the bar, and every later `seed` was
        // silently ignored — which is how `tab-tasks` and `tab-graph` came to
        // capture the Today screen instead of the tab routes they exist to
        // exercise. Dropping the migrated key lets each surface migrate afresh.
        for (const key of Object.keys(globalThis.localStorage)) {
          if (key.includes("barLayout_")) globalThis.localStorage.removeItem(key);
        }
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
  sql.close();
  return { results, index };
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
  const report = {
    capturedAt: new Date().toISOString(),
    viewport: args.landscape ? VIEWPORT_LANDSCAPE : VIEWPORT,
    deviceScale: DEVICE_SCALE,
    themes: {},
    /** Per theme: what the index actually held — the run's evidence, not a claim. */
    fixture: {},
  };
  try {
    for (const theme of themes) {
      process.stdout.write(`\n[${theme}]\n`);
      const { results, index } = await captureTheme(browser, theme, baseUrl, outDir, surfaces, args.landscape);
      report.themes[theme] = results;
      report.fixture[theme] = index;
    }
  } finally {
    await browser.close();
    stopServer(server);
  }

  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const all = Object.values(report.themes).flat();
  const failed = all.filter((r) => !r.ok);
  process.stdout.write(`\n${all.length - failed.length}/${all.length} surfaces captured -> ${outDir}\n`);

  /**
   * The fixture's own gate. Without it the run degrades silently back to what
   * it was: an app with no index, photographed as a set of empty states and
   * reported as covered. An empty index is a BROKEN RUN, not a green one.
   */
  const starved = Object.entries(report.fixture).filter(([, i]) => i.files < FIXTURE_MIN_FILES || i.links < FIXTURE_MIN_LINKS);
  if (starved.length) {
    process.stdout.write(
      `\nfixture starved — the index stayed too small to prove anything:\n${starved
        .map(([theme, i]) => `  ${theme}: ${i.files} files (need ${FIXTURE_MIN_FILES}), ${i.links} links (need ${FIXTURE_MIN_LINKS})`)
        .join("\n")}\nEvery surface in this run is UNVERIFIED.\n`,
    );
    process.exit(1);
  }

  if (failed.length) {
    process.stdout.write(`failed: ${failed.map((f) => f.surface).join(", ")}\n`);
    process.exit(1);
  }
}

await main();
