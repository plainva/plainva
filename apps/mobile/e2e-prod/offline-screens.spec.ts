import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Every screen of the phone opens without a network, from the built bundle (performance plan L5).
 *
 * The screens load when they are first opened: each one is a chunk of the app's own bundle, never a file of another
 * host. Here everything that is not the app's own origin is refused, and every screen the navigation can restore is
 * opened in turn — through the session the app keeps (`plainva-nav-<vault>`), the way a restart brings a screen
 * back. A screen whose chunk did not load shows the area's failure; none may, none may stand empty (nothing drawn, or
 * only what the start screen draws — review of L5, 2026-11-25), and no script or style sheet may be asked of another
 * host or fail to load.
 *
 * The screens of unfinished input (a mail being written, a wizard) are never restored by the app; their chunks are
 * loaded on their own by `chunk-load.spec.ts`.
 */

const NAVIGATION = readFileSync(fileURLToPath(new URL("../src/navigation.ts", import.meta.url)), "utf8");
const NAV_KINDS = [...NAVIGATION.match(/export const NAV_KINDS = \[([^\]]*)\]/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]!);
const INPUT_KINDS = new Set([...NAVIGATION.match(/export const INPUT_KINDS = new Set<NavKind>\(\[([^\]]*)\]/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]!));
/** A path for the screens that open a file: files the test writes into the vault. */
const PATHS: Record<string, string> = { base: "Probe.base", imageviewer: "probe.png", folder: "" };
/**
 * Screens that rightly draw what the start draws, or leave: the vault's root folder is the list the notes tab shows,
 * and the screen of an account the vault has none of goes back on its own (`missing` in CloudAccountDetailScreen and
 * AccountServiceScreen) — this vault has no account.
 */
const SAME_AS_START = new Set(["folder", "cloudaccount", "accountservice"]);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function open(page: Page, kind: string) {
  await page.evaluate(
    ({ kind, path }) => localStorage.setItem("plainva-nav-local", JSON.stringify({ activeTab: "notes", stacks: {}, overlay: [{ kind, path }] })),
    { kind, path: PATHS[kind] ?? "" },
  );
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  return shown(page);
}

/** What the app draws, as text and controls: a screen that renders nothing leaves this as the start screen's. */
function shown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.getElementById("root");
    if (!root) return "";
    const controls = [...root.querySelectorAll("button, input, [role=button]")].map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "").join("|");
    return `${root.innerText.trim()}\n${controls}`;
  });
}

test("every screen of the phone opens from the bundle without a network", async ({ page, context }) => {
  test.setTimeout(600_000);
  expect(NAV_KINDS.length).toBeGreaterThan(40);
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  const foreign: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  await context.route((url) => url.origin !== origin, (route) => {
    foreign.push(route.request().url());
    return route.abort("internetdisconnected");
  });
  page.on("requestfailed", (request) => {
    // A load the next reload cut off (a part loaded ahead while the app idled) is no file that did not load.
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    if (/\.(js|css|json)(\?|$)/.test(request.url()) && new URL(request.url()).origin === origin) failed.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(String(error.stack || error.message).slice(0, 300)));
  const sql = await installSqlBridge(context);
  try {
    await context.addInitScript(() => {
      if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off", whatsNewSeen: "999" }));
    });
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (png) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Probe.base", data: "views:\n  - type: table\n    name: Table\n", directory: "DATA", encoding: "utf8", recursive: true });
      await fs.writeFile({ path: "vault/probe.png", data: png, directory: "DATA", recursive: true });
    }, PNG);
    await page.evaluate(() => localStorage.setItem("plainva-nav-local", JSON.stringify({ activeTab: "notes", stacks: {}, overlay: [] })));
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const start = await shown(page);
    const broken: string[] = [];
    const empty: string[] = [];
    for (const kind of NAV_KINDS.filter((k) => !INPUT_KINDS.has(k))) {
      const drawn = await open(page, kind);
      if ((await page.getByTestId("area-fallback").count()) > 0) broken.push(kind);
      else if ((drawn.trim().length === 0 || drawn === start) && !SAME_AS_START.has(kind)) empty.push(kind);
    }
    expect(broken, `screens that showed a failed area: ${broken.join(", ")}`).toEqual([]);
    expect(empty, `screens that stood empty: ${empty.join(", ")}`).toEqual([]);
    expect(failed, `files of the bundle that did not load: ${failed.join(", ")}`).toEqual([]);
    expect(foreign.filter((url) => /\.(m?js|css)(\?|$)/.test(url)), "a script or style sheet asked of another host").toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await sql.close();
  }
});
