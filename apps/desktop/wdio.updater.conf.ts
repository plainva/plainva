import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { config as smoke } from "./wdio.conf";

/**
 * The updater signature test (stability plan R11, finding S12; see
 * docs/engineering/WebDriver_Smoke.md, "Updater signature test").
 *
 * The same driver set-up as the native smoke (`wdio.conf.ts`), against a debug
 * build made with the overlay that `scripts/updater-signature-fixtures.mjs`
 * writes: the app trusts a public key made for this run and asks
 * `http://127.0.0.1:<port>/latest.json` for updates. This launcher serves that
 * address before the app starts, so the app's own start-up check already
 * meets it. The spec picks the manifest per case through `POST /__case/<name>`
 * and reads back which files the app fetched (`GET /__requests`) — a refusal
 * counts only if the app actually downloaded the file it refused.
 *
 * Run: `node scripts/updater-signature-fixtures.mjs <dir>`, build with
 * `--config <dir>/tauri.updater-test.conf.json`, then
 * `PLAINVA_UPDATER_TEST_DIR=<dir> pnpm --filter desktop test:native:updater`.
 */

const fixtures = resolve(process.env.PLAINVA_UPDATER_TEST_DIR || "");
const FIRST_CASE = "b-tampered";

let server: Server | undefined;
let currentCase = FIRST_CASE;
const requests: string[] = [];

function startServer(port: number): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname.startsWith("/__case/")) {
      const name = decodeURIComponent(url.pathname.slice("/__case/".length));
      if (!existsSync(join(fixtures, "manifests", `${name}.json`))) {
        res.writeHead(404).end(`no case ${name}`);
        return;
      }
      currentCase = name;
      requests.length = 0;
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__requests") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ case: currentCase, requests }));
      return;
    }
    requests.push(url.pathname);
    if (url.pathname === "/latest.json") {
      res.writeHead(200, { "content-type": "application/json" }).end(readFileSync(join(fixtures, "manifests", `${currentCase}.json`)));
      return;
    }
    if (url.pathname.startsWith("/files/")) {
      const file = join(fixtures, "files", basename(url.pathname));
      if (existsSync(file)) {
        const body = readFileSync(file);
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length }).end(body);
        return;
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((done, fail) => {
    server!.once("error", fail);
    server!.listen(port, "127.0.0.1", () => done());
  });
}

const application = (smoke.capabilities as WebdriverIO.Capabilities[])[0]["tauri:options" as keyof WebdriverIO.Capabilities] as { application: string };

export const config: WebdriverIO.Config = {
  ...smoke,
  specs: ["./wdio/updater-signature.e2e.ts"],
  outputDir: "wdio-logs-updater",

  async onPrepare(...args) {
    if (!process.env.PLAINVA_UPDATER_TEST_DIR || !existsSync(join(fixtures, "fixture.json"))) {
      throw new Error("PLAINVA_UPDATER_TEST_DIR names no fixture folder (scripts/updater-signature-fixtures.mjs)");
    }
    const { port } = JSON.parse(readFileSync(join(fixtures, "fixture.json"), "utf8")) as { port: number };
    await startServer(port);
    process.env.PLAINVA_UPDATER_TEST_PORT = String(port);
    process.env.PLAINVA_UPDATER_APP = application.application;
    // The smoke's own preparation: the throwaway vault and the settings store.
    await (smoke.onPrepare as (...a: unknown[]) => unknown)(...args);
    // The silent start-up check stays ON (its default): the toast it raises is
    // the first place an update is offered, and the first case refuses there.
  },

  async onComplete(...args) {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    await (smoke.onComplete as (...a: unknown[]) => unknown)(...args);
  },
};
