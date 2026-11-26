/* global console, setTimeout, URL, performance, localStorage */
/**
 * What a shell loads shortly after its start without anyone doing anything (review of L5, 2026-11-25): the built
 * bundle opened in a browser, with the AI switched off, until it goes quiet — the parts loaded ahead while it idles,
 * whatever the start itself asks for once its first picture stands. The bundle gate counts these files apart from
 * the start files, so a saving that only moved bytes to a moment later shows as that.
 *
 * Each shell opens as its end-to-end tests open it: the desktop over the vault fixture of `menus.spec.ts` (the Tauri
 * calls answered in the page), the phone over the web plugins of Capacitor with its database bridged to Node.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".map": "application/json" };

/** Serves a built `dist/` on a free port; a path that is no file answers with `index.html`, as the app's host does. */
function serve(dir) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const wanted = path.join(dir, decodeURIComponent(url.pathname));
    const file = wanted.startsWith(dir) && fs.existsSync(wanted) && fs.statSync(wanted).isFile() ? wanted : path.join(dir, "index.html");
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/**
 * The desktop's fixtures as a script for the page, as every end-to-end test has them: the SQL transactions of the
 * Tauri bridge (`clockedTest.ts` installs them first), then the vault of the menu tests. Their TypeScript is
 * stripped by the compiler the repo has.
 */
function desktopFixture(root) {
  const require = createRequire(path.join(root, "apps", "desktop", "package.json"));
  const ts = require("typescript");
  const strip = (name) =>
    ts.transpileModule(fs.readFileSync(path.join(root, "apps", "desktop", "e2e", "fixtures", name), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export\s+/gm, "");
  return `${strip("tauriTransactions.ts")}\n${strip("menuVault.ts")}\ninstallTauriTransactionCommands();\ninstallMenuVault();`;
}

/** Waits until no file was asked for in `quietMs`, at most `maxMs`. */
async function quiet(page, quietMs = 5000, maxMs = 60000) {
  const started = Date.now();
  let count = -1;
  let since = Date.now();
  while (Date.now() - started < maxMs) {
    const now = await page.evaluate(() => performance.getEntriesByType("resource").length);
    if (now !== count) {
      count = now;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log("    (the page did not go quiet within a minute; measured as it stood)");
}

/**
 * The bundle files the shell loaded, from opening it until it went quiet: paths relative to `dir`.
 * @param {{ root: string, shell: "desktop" | "mobile", dir: string }} options
 */
export async function filesLoadedUntilQuiet({ root, shell, dir }) {
  const require = createRequire(path.join(root, "apps", shell, "package.json"));
  const { chromium, devices } = require("@playwright/test");
  const { server, origin } = await serve(dir);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(shell === "mobile" ? { ...devices["Pixel 7"] } : { viewport: { width: 1600, height: 1000 } });
    // Nothing of another host: the start must not need it.
    await context.route((url) => url.origin !== origin, (route) => route.abort("internetdisconnected"));
    let close = async () => {};
    if (shell === "desktop") {
      await context.addInitScript({ content: desktopFixture(root) });
    } else {
      const { installSqlBridge } = await import(pathToFileURL(path.join(root, "apps", "mobile", "scripts", "screenshot-fixture.mjs")).href);
      const sql = await installSqlBridge(context);
      close = () => sql.close();
      await context.addInitScript(() => {
        localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off", whatsNewSeen: "999" }));
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 200)));
    await page.goto(origin + "/");
    await page.waitForSelector(shell === "desktop" ? '[data-testid="file-tree"]' : "#root > *", { timeout: 60000 });
    await quiet(page);
    const urls = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    await close();
    const files = [...new Set(urls.map((url) => new URL(url)).filter((url) => url.origin === origin).map((url) => decodeURIComponent(url.pathname).replace(/^\//, "")))]
      .filter((file) => /\.(m?js|css)$/.test(file) && fs.existsSync(path.join(dir, file)));
    return { files, errors };
  } finally {
    await browser.close();
    server.close();
  }
}
