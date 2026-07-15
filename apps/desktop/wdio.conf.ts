import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

/**
 * Native WebDriver smoke (hardening plan B2 / P8) — see
 * docs/engineering/WebDriver_Smoke.md.
 *
 * The Playwright suites drive a MOCKED `__TAURI_INTERNALS__` and prove UI logic,
 * not the native app (the gap that let the macOS print bug, issue #6, ship). This
 * runs the BUILT Tauri binary through `@wdio/tauri-service` (embedded driver —
 * Windows/Linux/macOS). It is NOT exercised in the CI-mocked test harness (there
 * is no native build there); its first green run is a maintainer / CI-runner step
 * (`pnpm --filter desktop test:native`, or the native-smoke workflow).
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

function appConfigDir(): string {
  if (isWin) return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), APP_ID);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_ID);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), APP_ID);
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
  services: ["@wdio/tauri-service"],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 180_000 },
  logLevel: "warn",

  onPrepare() {
    vaultDir = mkdtempSync(join(tmpdir(), "plainva-smoke-vault-"));
    const cfgDir = appConfigDir();
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, STORE_FILE),
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
