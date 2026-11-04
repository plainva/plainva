import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Native WebDriver smoke — see docs/engineering/WebDriver_Smoke.md.
 *
 * The Playwright suites drive a MOCKED `__TAURI_INTERNALS__` and prove UI logic,
 * not the native app (the gap that let the macOS print bug, issue #6, ship). This
 * runs the BUILT Tauri binary through `@wdio/tauri-service`, on all three systems:
 *
 *  - Linux and Windows: the EXTERNAL driver — a cargo-installed `tauri-driver`
 *    in front of WebKitWebDriver (Linux) or the Edge WebDriver (Windows), against
 *    the unchanged debug binary (on Windows with the smoke overlay
 *    `src-tauri/tauri.smoke.conf.json` that opens the WebView's debugging port).
 *  - macOS: the EMBEDDED driver — no external driver reaches WKWebView. The
 *    WebDriver server is `tauri-plugin-wdio-webdriver` inside the app, compiled
 *    in only by the cargo feature `webdriver-smoke` of the smoke build
 *    (`tauri build --debug --bundles app --features webdriver-smoke --config
 *    src-tauri/tauri.smoke.macos.conf.json`). No release carries it: the guard
 *    test src/webdriverSmokeIsolation.test.ts and the binary check
 *    scripts/check-webdriver-server.sh in release.yml hold that line. The
 *    embedded driver's input is synthetic; where only a real event proves
 *    something, the spec goes through the system (wdio/macos.ts).
 *
 * The service crate and its npm half carry one version (src/tauriVersionPairs.test.ts).
 * It is NOT exercised in the CI-mocked test harness (there is no native build
 * there): `pnpm --filter desktop test:native` after a build, or the native-smoke
 * workflow.
 */

const APP_ID = "com.plainva.desktop";
const STORE_FILE = "plainva-settings.json";
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

const profile = process.env.PLAINVA_TAURI_PROFILE || "debug";

/**
 * The binary the service starts; override with PLAINVA_TAURI_BINARY.
 *
 * On macOS it is the executable INSIDE the `.app` bundle. Only there does the
 * app run with its bundle identifier — and with it the defaults domain
 * `com.plainva.desktop`, which the spell checking of issue #135 is stored in.
 * The service starts the path it is given as a process, so the bundle itself (a
 * directory) cannot be the path; its `Contents/MacOS/<binary>` can.
 */
function defaultApplication(): string {
  const target = join(process.cwd(), "src-tauri", "target", profile);
  if (isMac) {
    const bundles = join(target, "bundle", "macos");
    const app = existsSync(bundles) ? readdirSync(bundles).find((name) => name.endsWith(".app")) : undefined;
    if (!app) return join(bundles, "Plainva.app", "Contents", "MacOS", "plainva-desktop");
    const macosDir = join(bundles, app, "Contents", "MacOS");
    const binary = readdirSync(macosDir)[0];
    return join(macosDir, binary ?? "plainva-desktop");
  }
  return join(target, isWin ? "plainva-desktop.exe" : "plainva-desktop");
}

const application = process.env.PLAINVA_TAURI_BINARY || defaultApplication();

// A throwaway vault, pre-registered in the Tauri store so the app auto-opens it
// on launch — WebDriver cannot drive the native "open folder" dialog.
let vaultDir = "";

/**
 * Where the app's settings store lives: tauri-plugin-store resolves a relative
 * store path against `BaseDirectory::AppData` (the app DATA dir, not the config
 * dir). On Windows and macOS the two are the same folder; on Linux they are not
 * (`~/.local/share/<id>` vs `~/.config/<id>`) — the first real run seeded the
 * config dir there, and the app never saw the vault.
 */
function appDataDir(): string {
  if (isWin) return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), APP_ID);
  if (isMac) return join(homedir(), "Library", "Application Support", APP_ID);
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), APP_ID);
}

/** A file name from a test title: one picture per failed case, none overwrites another. */
const slug = (title: string) => title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "test";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./wdio/smoke.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": { application },
    } as WebdriverIO.Capabilities,
  ],
  services: [
    [
      "@wdio/tauri-service",
      isMac
        ? // The embedded server in the smoke build. The app's own output goes
          // to the log: an app that dies before its server answers otherwise
          // leaves one line ("exited before the embedded WebDriver server became
          // ready") and nothing about why.
          { driverProvider: "embedded", captureBackendLogs: true, logLevel: "debug", startTimeout: 120_000 }
        : // `external` + `autoInstallTauriDriver`: the service installs
          // tauri-driver with cargo when it is missing (the workflow sets up the
          // Rust toolchain) and manages the Edge WebDriver on Windows; Linux
          // needs `webkit2gtk-driver` (installed there). The driver logs at
          // debug level: the first runs failed before any test step (on Windows
          // "session not created: DevToolsActivePort file doesn't exist"), and
          // only the driver's own output says why.
          { driverProvider: "external", autoInstallTauriDriver: true, logLevel: "debug" },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 180_000 },
  logLevel: "warn",
  // The drivers' own output (tauri-driver, the Edge and WebKit WebDrivers, the
  // app under the embedded driver) goes to files here, and the workflow
  // uploads them when a run fails. Without them a session that never starts
  // leaves one line in the job log and no way to tell which process gave up.
  outputDir: "wdio-logs",

  // A failed step leaves what the window looked like: without it the job log
  // names an element and nothing about what stood in front of it. On macOS
  // also the whole screen (a system dialog or another app in front is not in
  // the WebView's picture) and the app's entries in the unified log.
  async afterTest(test, _context, result) {
    if (result.passed) return;
    const name = slug(test.title);
    mkdirSync("wdio-logs", { recursive: true });
    try {
      await browser.saveScreenshot(join("wdio-logs", `failed-${name}.png`));
      writeFileSync(join("wdio-logs", `failed-${name}.html`), await browser.getPageSource(), "utf8");
    } catch {
      /* the session may be gone; the driver log says so */
    }
    if (isMac) {
      try {
        execFileSync("/usr/sbin/screencapture", ["-x", join("wdio-logs", `screen-${name}.png`)], { timeout: 20_000 });
      } catch {
        /* no screen recording right on this runner image; the WebView picture above stays */
      }
      try {
        const log = execFileSync(
          "/usr/bin/log",
          ["show", "--last", "10m", "--style", "compact", "--predicate", `process == "${basename(application)}"`],
          { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
        );
        writeFileSync(join("wdio-logs", `unified-${name}.log`), log, "utf8");
      } catch {
        /* best effort */
      }
    }
  },

  onPrepare() {
    vaultDir = mkdtempSync(join(tmpdir(), "plainva-smoke-vault-"));
    // The spec reads the note back from disk; the workers start after this
    // hook and inherit the variable.
    process.env.PLAINVA_SMOKE_VAULT = vaultDir;
    const dataDir = appDataDir();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, STORE_FILE),
      JSON.stringify({
        lastVaultPath: vaultDir.split("\\").join("/"),
        autoOpenLastVault: true,
        // The device switch for spell checking (off by default): on, so the
        // spell checking case has something to expect — the editor marked for
        // the platform's checker, and on macOS the WebView's own setting.
        spellcheck: true,
      }),
      "utf8",
    );
    // The runner is fresh for every run, so the app's defaults domain on macOS
    // (written by the app at its first start, issue #135) needs no cleanup.
  },

  onComplete() {
    try {
      if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  },
};
