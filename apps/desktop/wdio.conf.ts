import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

/**
 * Native WebDriver smoke (hardening plan B2 / P8) — see
 * docs/engineering/WebDriver_Smoke.md.
 *
 * The Playwright suites drive a MOCKED `__TAURI_INTERNALS__` and prove UI logic,
 * not the native app (the gap that let the macOS print bug, issue #6, ship). This
 * runs the BUILT Tauri binary through `@wdio/tauri-service` with the EXTERNAL
 * driver: a cargo-installed `tauri-driver` in front of WebKitWebDriver (Linux) or
 * the Edge WebDriver (Windows). The service's default, the embedded driver, needs
 * `tauri-plugin-wdio-webdriver` compiled into the app — the first run of the
 * native-smoke workflow (2026-09-29) failed on exactly that; putting a WebDriver
 * server into the binary is a decision of its own (see WebDriver_Smoke.md), so
 * macOS stays uncovered here. It is NOT exercised in the CI-mocked test harness
 * (there is no native build there): `pnpm --filter desktop test:native`, or the
 * native-smoke workflow.
 */

const APP_ID = "com.plainva.desktop";
const STORE_FILE = "plainva-settings.json";
const isWin = process.platform === "win32";

// `pnpm tauri build --debug` (or --release) produces the binary; override the
// path in CI via PLAINVA_TAURI_BINARY. The cargo package name is plainva-desktop.
const profile = process.env.PLAINVA_TAURI_PROFILE || "debug";
const binaryName = isWin ? "plainva-desktop.exe" : "plainva-desktop";
const application =
  process.env.PLAINVA_TAURI_BINARY || join(process.cwd(), "src-tauri", "target", profile, binaryName);

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
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_ID);
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), APP_ID);
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./wdio/smoke.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": { application },
    } as WebdriverIO.Capabilities,
  ],
  // `external` + `autoInstallTauriDriver`: the service installs tauri-driver with
  // cargo when it is missing (the workflow sets up the Rust toolchain) and manages
  // the Edge WebDriver on Windows; Linux needs `webkit2gtk-driver` (installed there).
  // The driver logs at debug level: the first runs failed before any test step
  // (on Windows "session not created: DevToolsActivePort file doesn't exist"),
  // and only the driver's own output says why.
  services: [["@wdio/tauri-service", { driverProvider: "external", autoInstallTauriDriver: true, logLevel: "debug" }]],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 180_000 },
  logLevel: "warn",
  // The drivers' own output (tauri-driver, the Edge and WebKit WebDrivers) goes
  // to files here, and the workflow uploads them when a run fails. Without
  // them a session that never starts leaves one line in the job log and no
  // way to tell which of the three processes gave up.
  outputDir: "wdio-logs",

  // A failed step leaves what the window looked like: without it the job log
  // names an element and nothing about what stood in front of it.
  async afterTest(_test, _context, result) {
    if (result.passed) return;
    try {
      mkdirSync("wdio-logs", { recursive: true });
      await browser.saveScreenshot(join("wdio-logs", "failed.png"));
      writeFileSync(join("wdio-logs", "failed.html"), await browser.getPageSource(), "utf8");
    } catch {
      /* the session may be gone; the driver log says so */
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
      JSON.stringify({ lastVaultPath: vaultDir.split("\\").join("/"), autoOpenLastVault: true }),
      "utf8"
    );
  },

  onComplete() {
    try {
      if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  },
};
