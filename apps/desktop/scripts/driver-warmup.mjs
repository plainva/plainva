#!/usr/bin/env node
// Starts tauri-driver once before the WebdriverIO run, and measures how long it
// takes to answer.
//
//   node apps/desktop/scripts/driver-warmup.mjs [--label <job name>]
//
// Why (F78, 2026-11-20): @wdio/tauri-service gives the external driver exactly
// 10 s to answer on its port (`pollForReadiness` in @wdio/native-core, a fixed
// `const timeout = 10000`; the service's `startTimeout` does not reach it).
// On the Windows runners that failed three times in about fourteen runs
// (18.11. run 44397922520 windows, 19.11. 44426951189 updater signature,
// 20.11. 44788327471 attempt 1). Each time the failure came before the app ran,
// tauri-driver and msedgedriver were both still alive at the end of the job
// ("Terminate orphan process"), and the tauri-driver binary was new on that
// runner: compiled by `cargo install` in the same step, or unpacked from the
// rust cache. The first start of a freshly written executable on Windows is
// the slow one; this script takes that start out of the 10 s window, so the
// service's own start is the second one.
//
// It finds tauri-driver the way the service does (PATH, then ~/.cargo/bin) and
// installs it the way the service would (`cargo install tauri-driver`) when it
// is missing. It then starts it twice with the service's arguments and waits,
// up to three minutes, for an HTTP answer on /status — the service's own test.
// Both times go to the job summary, so the start time stays measurable from run
// to run. It fails only when the driver never answers: then the WebdriverIO
// run could not start it either, and the app has not run.

import { spawn, spawnSync, execSync } from "node:child_process";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";

const isWindows = process.platform === "win32";
const READY_LIMIT_MS = 180_000;
const SERVICE_LIMIT_MS = 10_000;
const args = process.argv.slice(2);
const labelAt = args.indexOf("--label");
const label = labelAt >= 0 ? args[labelAt + 1] : process.env.GITHUB_JOB ?? "native smoke";

function cargoBin() {
  const home = isWindows ? process.env.USERPROFILE || "C:\\Users\\Default" : process.env.HOME || "~";
  return join(home, ".cargo", "bin", isWindows ? "tauri-driver.exe" : "tauri-driver");
}

function findDriver() {
  try {
    const out = execSync(isWindows ? "where tauri-driver" : "which tauri-driver", { encoding: "utf8", stdio: "pipe" });
    const first = out.trim().split(/\r?\n/)[0];
    if (first && existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return existsSync(cargoBin()) ? cargoBin() : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function answers(port) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/status`, (res) => {
      res.resume();
      resolve(true);
    });
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (isWindows) {
    // The service starts the driver through the shell, and the driver starts
    // msedgedriver: the whole tree goes.
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }
}

async function startOnce(driver) {
  const port = await freePort();
  let nativePort = await freePort();
  while (nativePort === port) nativePort = await freePort();
  const started = Date.now();
  // The same command line and the same shell as @wdio/native-core's DriverProcess.
  const proc = spawn(driver, ["--port", String(port), "--native-port", String(nativePort)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    detached: !isWindows,
  });
  const output = [];
  const keep = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) output.push(`+${Date.now() - started} ms ${line.trim()}`);
    }
  };
  proc.stdout.on("data", keep);
  proc.stderr.on("data", keep);
  try {
    while (Date.now() - started < READY_LIMIT_MS) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        return { ms: null, output, note: `exited during startup (code ${proc.exitCode}, signal ${proc.signalCode})` };
      }
      if (await answers(port)) return { ms: Date.now() - started, output };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ms: null, output, note: `no answer within ${READY_LIMIT_MS} ms` };
  } finally {
    stop(proc);
    // Give Windows a moment to release the ports and the files.
    await new Promise((r) => setTimeout(r, 500));
  }
}

function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, lines.join("\n") + "\n");
}

let driver = findDriver();
let installMs = null;
if (!driver) {
  const begun = Date.now();
  mkdirSync(join(cargoBin(), ".."), { recursive: true });
  const result = spawnSync("cargo", ["install", "tauri-driver"], { stdio: "inherit" });
  installMs = Date.now() - begun;
  if (result.status !== 0) {
    console.error(`::error::cargo install tauri-driver failed (exit ${result.status})`);
    process.exit(1);
  }
  driver = findDriver();
  if (!driver) {
    console.error("::error::tauri-driver was installed but is not found");
    process.exit(1);
  }
}

const first = await startOnce(driver);
const second = first.ms === null ? null : await startOnce(driver);
const fmt = (r) => (r === null ? "—" : r.ms === null ? `never (${r.note})` : `${r.ms} ms`);
const over = (r) => r !== null && r.ms !== null && r.ms > SERVICE_LIMIT_MS;

console.log(`tauri-driver: ${driver}${installMs !== null ? ` (installed in ${installMs} ms)` : " (found)"}`);
console.log(`first start (cold): ${fmt(first)}`);
console.log(`second start (warm, what the WebdriverIO service sees): ${fmt(second)}`);
for (const [name, r] of [["first", first], ["second", second]]) {
  if (r?.output.length) console.log(`--- ${name} start, driver output ---\n${r.output.join("\n")}`);
}
summary([
  `### Driver start (${label}, ${process.platform})`,
  "",
  "| | |",
  "|---|---|",
  `| tauri-driver | ${installMs !== null ? `installed in ${installMs} ms` : "found"} |`,
  `| first start (cold) | ${fmt(first)}${over(first) ? " — over the service's 10 s" : ""} |`,
  `| second start (warm) | ${fmt(second)}${over(second) ? " — over the service's 10 s" : ""} |`,
  "",
]);
console.log(`DRIVER_READY_MS label=${label} os=${process.platform} cold=${first.ms ?? "never"} warm=${second?.ms ?? "never"} install=${installMs ?? "found"}`);

if (first.ms === null || second?.ms === null) {
  console.error(`::error::tauri-driver never answered on /status: ${first.ms === null ? first.note : second.note}`);
  process.exit(1);
}
if (over(second)) {
  // Not a failure here: the WebdriverIO run decides. The summary shows it.
  console.log(`::warning::tauri-driver needed ${second.ms} ms on its warm start, over the service's ${SERVICE_LIMIT_MS} ms`);
}
