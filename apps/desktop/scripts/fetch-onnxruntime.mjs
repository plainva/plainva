#!/usr/bin/env node
/**
 * Fetches Microsoft's ONNX Runtime for the desktop bundle (plan KI-Harness
 * P2a-3, ADR 0021): the official release archives on GitHub, pinned by size
 * and SHA-256, unpacked to `src-tauri/resources/onnxruntime/` (not in git).
 * The library is part of the app; a model never is.
 *
 * macOS ships one universal app: the arm64 library of 1.30 and, for Intel
 * Macs, the x86_64 library of 1.23.2 — the last release Microsoft built for
 * them — joined into one file by `lipo`.
 *
 *   node scripts/fetch-onnxruntime.mjs [--platform win32|linux|darwin] [--arch x64|arm64]
 *
 * Idempotent: a library already there with the expected hash is kept.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES = "https://github.com/microsoft/onnxruntime/releases/download";
const ARCHIVES = {
  "win32-x64": { version: "1.30.0", name: "onnxruntime-win-x64-1.30.0.zip", bytes: 82_645_522, sha256: "c6ba983baf5681af108599675d2a89c2d145512d02de28aed0bff177cd0ba949", library: "lib/onnxruntime.dll" },
  "win32-arm64": { version: "1.30.0", name: "onnxruntime-win-arm64-1.30.0.zip", bytes: 83_954_906, sha256: "e53db8a50b23ae35be901cc93428baf997dc8d420333b097b2eae53d3ea9f2d3", library: "lib/onnxruntime.dll" },
  "linux-x64": { version: "1.30.0", name: "onnxruntime-linux-x64-1.30.0.tgz", bytes: 11_306_877, sha256: "a5ed5a3cac51fbb2e90da632ae43d19212faaa20e76484e62bcb7c23ddb3b3fd", library: "lib/libonnxruntime.so.1.30.0" },
  "linux-arm64": { version: "1.30.0", name: "onnxruntime-linux-aarch64-1.30.0.tgz", bytes: 10_269_495, sha256: "e16a27a8ed330bbc698df7330b0cf56e722f354e3bcc92118682c74ef3c3e3da", library: "lib/libonnxruntime.so.1.30.0" },
  "darwin-arm64": { version: "1.30.0", name: "onnxruntime-osx-arm64-1.30.0.tgz", bytes: 42_373_116, sha256: "6ebb5062a934537c352937821f9fe9718e7de1a2db1122a93dd363ffd53a7012", library: "lib/libonnxruntime.1.30.0.dylib" },
  "darwin-x64": { version: "1.23.2", name: "onnxruntime-osx-x86_64-1.23.2.tgz", bytes: 11_676_322, sha256: "d10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6", library: "lib/libonnxruntime.1.23.2.dylib" },
};
const OUTPUT = { win32: "onnxruntime.dll", linux: "libonnxruntime.so", darwin: "libonnxruntime.dylib" };

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../src-tauri/resources/onnxruntime");
const cache = path.join(os.tmpdir(), "plainva-onnxruntime");

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
}

// Windows' own tar (bsdtar) reads zip; the GNU tar a Git shell puts first on the PATH does not.
const SYSTEM_TAR = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const TAR = process.platform === "win32" && fs.existsSync(SYSTEM_TAR) ? SYSTEM_TAR : "tar";

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function archive(entry) {
  fs.mkdirSync(cache, { recursive: true });
  const file = path.join(cache, entry.name);
  if (fs.existsSync(file) && fs.statSync(file).size === entry.bytes && sha256(file) === entry.sha256) return file;
  const response = await fetch(`${RELEASES}/v${entry.version}/${entry.name}`, { redirect: "follow" });
  if (!response.ok) throw new Error(`${entry.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== entry.bytes || digest !== entry.sha256) throw new Error(`${entry.name}: size or SHA-256 differs (${bytes.length}, ${digest})`);
  fs.writeFileSync(file, bytes);
  return file;
}

/** The library out of an archive, into a scratch folder. */
async function library(entry) {
  const file = await archive(entry);
  const out = fs.mkdtempSync(path.join(cache, "x-"));
  execFileSync(TAR, ["-xf", file, "-C", out]);
  const top = entry.name.replace(/\.(zip|tgz)$/, "");
  const lib = path.join(out, top, entry.library);
  if (!fs.existsSync(lib)) throw new Error(`${entry.name}: ${entry.library} missing`);
  return { lib, notices: ["LICENSE", "ThirdPartyNotices.txt"].map((name) => path.join(out, top, name)) };
}

const platform = arg("platform", process.platform);
const arch = arg("arch", process.arch);
const output = path.join(target, OUTPUT[platform] ?? "");
if (!OUTPUT[platform]) throw new Error(`no ONNX Runtime for ${platform}`);
const parts = platform === "darwin" ? [ARCHIVES["darwin-arm64"], ARCHIVES["darwin-x64"]] : [ARCHIVES[`${platform}-${arch}`]];
if (parts.some((part) => !part)) throw new Error(`no ONNX Runtime for ${platform}-${arch}`);
const stamp = parts.map((part) => part.sha256).join("+");
// Outside the bundled folder, so it never ships.
const marker = path.join(target, "..", "onnxruntime.source");
if (fs.existsSync(output) && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === stamp) {
  console.log(`ONNX Runtime already in place: ${output}`);
} else {
  fs.mkdirSync(target, { recursive: true });
  const libs = [];
  for (const part of parts) libs.push(await library(part));
  if (platform === "darwin") execFileSync("lipo", ["-create", ...libs.map((l) => l.lib), "-output", output]);
  else fs.copyFileSync(libs[0].lib, output);
  // The licence and the notices of the libraries inside ship with it (the bundle configs name both).
  for (const notice of libs[0].notices) {
    if (!fs.existsSync(notice)) throw new Error(`${path.basename(notice)} missing from ${parts[0].name}`);
    fs.copyFileSync(notice, path.join(target, path.basename(notice)));
  }
  fs.writeFileSync(marker, stamp);
  console.log(`ONNX Runtime ${parts.map((p) => p.version).join(" + ")} → ${output}`);
}
