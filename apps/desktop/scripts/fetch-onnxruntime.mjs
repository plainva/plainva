#!/usr/bin/env node
/**
 * Fetches Microsoft's ONNX Runtime for the desktop bundle (plan KI-Harness
 * P2a-3, ADR 0021) into `src-tauri/resources/onnxruntime/` (not in git). The
 * library is part of the app; a model never is.
 *
 * Two official sources, in this order:
 *   1. the release archives of github.com/microsoft/onnxruntime, pinned by
 *      size and SHA-256 (ARCHIVES);
 *   2. when GitHub cannot deliver them (HTTP 404 or 5xx, or no answer at
 *      all — on 2026-11-18 the whole repository answered 404 for a day and
 *      every release leg failed here), Microsoft's NuGet package
 *      `Microsoft.ML.OnnxRuntime` from api.nuget.org, pinned by size and
 *      SHA-256 of the package (PACKAGES); the library is
 *      `runtimes/<rid>/native/<file>` in it.
 * The log names the source that delivered; nothing switches silently. A
 * GitHub archive that arrives but does not match its pin stops the build — a
 * wrong file is never a reason to try another source.
 *
 * The check that counts is on the LIBRARY (LIBRARIES: size and SHA-256 of the
 * file that ships), and both ways end at it. Where the two sources carry the
 * same bytes was proven, not assumed (2026-11-18): linux-x64 — the library in
 * the GitHub archive (pinned archive hash, kept from an earlier run) and the
 * one in the NuGet package are byte-identical. For the other five no GitHub
 * copy could be had while GitHub was down (the release rehearsals keep no
 * bundles, and the archives are on no mirror); their library pins are the
 * bytes of the NuGet packages, whose trust rests on nuget.org and the
 * packages' signature by Microsoft Corporation (author) and the NuGet.org
 * repository. Should a GitHub archive for one of them carry other bytes, the
 * build stops at the library check and names both hashes: then the pin is
 * decided again, not widened silently.
 *
 * macOS ships one universal app: the arm64 library of 1.30 and, for Intel
 * Macs, the x86_64 library of 1.23.2 — the last release Microsoft built for
 * them — joined into one file by `lipo`. The licence and the third-party
 * notices come from the same archive or package as the first library.
 *
 *   node scripts/fetch-onnxruntime.mjs [--platform win32|linux|darwin] [--arch x64|arm64]
 *
 * Idempotent: a library already there from the expected pins is kept.
 * Archives and packages are read in-process (zip and tar.gz), no external
 * unpacker; nothing downloaded is ever executed.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const RELEASES = "https://github.com/microsoft/onnxruntime/releases/download";
export const NUGET = "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime";

/** The GitHub release archives, by platform; `library` is the path below the archive's top folder. */
export const ARCHIVES = {
  "win32-x64": { version: "1.30.0", name: "onnxruntime-win-x64-1.30.0.zip", bytes: 82_645_522, sha256: "c6ba983baf5681af108599675d2a89c2d145512d02de28aed0bff177cd0ba949", library: "lib/onnxruntime.dll" },
  "win32-arm64": { version: "1.30.0", name: "onnxruntime-win-arm64-1.30.0.zip", bytes: 83_954_906, sha256: "e53db8a50b23ae35be901cc93428baf997dc8d420333b097b2eae53d3ea9f2d3", library: "lib/onnxruntime.dll" },
  "linux-x64": { version: "1.30.0", name: "onnxruntime-linux-x64-1.30.0.tgz", bytes: 11_306_877, sha256: "a5ed5a3cac51fbb2e90da632ae43d19212faaa20e76484e62bcb7c23ddb3b3fd", library: "lib/libonnxruntime.so.1.30.0" },
  "linux-arm64": { version: "1.30.0", name: "onnxruntime-linux-aarch64-1.30.0.tgz", bytes: 10_269_495, sha256: "e16a27a8ed330bbc698df7330b0cf56e722f354e3bcc92118682c74ef3c3e3da", library: "lib/libonnxruntime.so.1.30.0" },
  "darwin-arm64": { version: "1.30.0", name: "onnxruntime-osx-arm64-1.30.0.tgz", bytes: 42_373_116, sha256: "6ebb5062a934537c352937821f9fe9718e7de1a2db1122a93dd363ffd53a7012", library: "lib/libonnxruntime.1.30.0.dylib" },
  "darwin-x64": { version: "1.23.2", name: "onnxruntime-osx-x86_64-1.23.2.tgz", bytes: 11_676_322, sha256: "d10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6", library: "lib/libonnxruntime.1.23.2.dylib" },
};

/** The NuGet packages `Microsoft.ML.OnnxRuntime`, by version (measured 2026-11-18). */
export const PACKAGES = {
  "1.30.0": { bytes: 157_230_753, sha256: "30df119bd9164eaa187666d93147448fdd4a9a1a3caf83f1505daf7af2d1c5d2" },
  "1.23.2": { bytes: 123_371_574, sha256: "25fe172f7fcdf34f2b5b02c8b997f6b88abc282956849d4af4335af23d0c4e4a" },
};

/**
 * The library file that ships, by platform: the pin both sources must meet.
 * `rid` and `file` place it in the NuGet package (`runtimes/<rid>/native/<file>`);
 * `sameOnGithub` says whether the GitHub archive was shown to carry these bytes.
 */
export const LIBRARIES = {
  "win32-x64": { rid: "win-x64", file: "onnxruntime.dll", bytes: 16_462_648, sha256: "7e39e2bdbba836d98071ef28620735ba36a47c554cf794585269aecc50fab0da", sameOnGithub: false },
  "win32-arm64": { rid: "win-arm64", file: "onnxruntime.dll", bytes: 16_728_888, sha256: "46b7ec24a6ee2932bb315edb39d26d6b2d51eef21f02c8e1ceafe801fe991a89", sameOnGithub: false },
  "linux-x64": { rid: "linux-x64", file: "libonnxruntime.so", bytes: 28_985_152, sha256: "245a6f8c38127551057a1cd1ffd59f0a186a227ade4f3492dea2494eb565542e", sameOnGithub: true },
  "linux-arm64": { rid: "linux-arm64", file: "libonnxruntime.so", bytes: 25_135_496, sha256: "64e903a43a041240fd6bcffe0ac6d4fea47ef87bf24b9d097801bd00a9612a4b", sameOnGithub: false },
  "darwin-arm64": { rid: "osx-arm64", file: "libonnxruntime.dylib", bytes: 43_879_424, sha256: "bffaa6ef856dba2c26f09c7c0e7018fd1562625f3485292c7ad28b83748c6879", sameOnGithub: false },
  "darwin-x64": { rid: "osx-x64", file: "libonnxruntime.dylib", bytes: 39_742_608, sha256: "8c9c78de65ea3786f987c0d980e9c1b13a3a5fbc6b3e2965ba05b450e6e4c054", sameOnGithub: false },
};

export const NOTICES = ["LICENSE", "ThirdPartyNotices.txt"];
const OUTPUT = { win32: "onnxruntime.dll", linux: "libonnxruntime.so", darwin: "libonnxruntime.dylib" };

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** One file out of a zip archive (stored or deflated), by its exact name. */
export function readZipEntry(zip, name) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip central directory");
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (entry === name) {
      if (packed === 0xffffffff || local === 0xffffffff) throw new Error(`${name}: zip64 entries are not read`);
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name}: broken local header`);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + packed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`${name}: unsupported zip method ${method}`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

/** One regular file out of a .tar.gz, by its path (a leading "./" ignored). */
export function readTarGzEntry(tgz, name) {
  const tar = zlib.gunzipSync(tgz);
  let longName = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from, length) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    let entry = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = body.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    entry = entry.replace(/^\.\//, "");
    if ((type === "0" || type === "\0") && entry === name) return Buffer.from(body);
  }
  return undefined;
}

/** Whether a failed GitHub fetch means "GitHub cannot deliver" (then NuGet is asked). */
export function githubUnavailable(error) {
  if (error?.httpStatus !== undefined) return error.httpStatus === 404 || error.httpStatus >= 500;
  // No answer at all: DNS, refused, reset, timeout. Anything else (a file
  // that does not meet its pin, a missing entry) stops the build.
  return error?.noAnswer === true;
}

async function download(url, { fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (cause) {
    throw Object.assign(new Error(`${url}: no answer (${cause?.message ?? cause})`, { cause }), { noAnswer: true });
  }
  if (!response.ok) throw Object.assign(new Error(`${url}: HTTP ${response.status}`), { httpStatus: response.status });
  return Buffer.from(await response.arrayBuffer());
}

/** A pinned download, from the cache when the cached copy still meets its pin. */
async function pinned(url, cacheFile, pin, { fetchImpl, cacheDir }) {
  const file = cacheDir ? path.join(cacheDir, cacheFile) : null;
  if (file && fs.existsSync(file) && fs.statSync(file).size === pin.bytes) {
    const cached = fs.readFileSync(file);
    if (sha256(cached) === pin.sha256) return cached;
  }
  const bytes = await download(url, { fetchImpl });
  const digest = sha256(bytes);
  if (bytes.length !== pin.bytes || digest !== pin.sha256) {
    throw Object.assign(new Error(`${cacheFile}: size or SHA-256 differs from its pin (${bytes.length}, ${digest})`), { pinMismatch: true });
  }
  if (file) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return bytes;
}

/** The library check both sources end at. */
export function checkLibrary(key, bytes, source, libraries = LIBRARIES) {
  const pin = libraries[key];
  const digest = sha256(bytes);
  if (bytes.length !== pin.bytes || digest !== pin.sha256) {
    throw new Error(
      `ONNX Runtime ${key} from ${source}: the library is not the pinned one (${bytes.length} bytes, SHA-256 ${digest}; expected ${pin.bytes} bytes, ${pin.sha256})`,
    );
  }
}

function fromGithub(key, archive, { archives }) {
  const pin = archives[key];
  const top = pin.name.replace(/\.(zip|tgz)$/, "");
  const read = pin.name.endsWith(".zip") ? readZipEntry : readTarGzEntry;
  const lib = read(archive, `${top}/${pin.library}`);
  if (!lib) throw new Error(`${pin.name}: ${pin.library} missing`);
  const notices = Object.fromEntries(NOTICES.map((name) => [name, read(archive, `${top}/${name}`)]));
  return { lib, notices };
}

function fromNuget(key, nupkg, { archives, libraries }) {
  const { rid, file } = libraries[key];
  const lib = readZipEntry(nupkg, `runtimes/${rid}/native/${file}`);
  if (!lib) throw new Error(`Microsoft.ML.OnnxRuntime ${archives[key].version}: runtimes/${rid}/native/${file} missing`);
  const notices = Object.fromEntries(NOTICES.map((name) => [name, readZipEntry(nupkg, name)]));
  return { lib, notices };
}

/**
 * The library of one platform and its notices, with the source that
 * delivered it: GitHub first, NuGet when GitHub cannot deliver, the library
 * pin on both ways.
 */
export async function fetchLibrary(key, { fetchImpl = fetch, cacheDir = null, log = console.log, pins = { archives: ARCHIVES, packages: PACKAGES, libraries: LIBRARIES } } = {}) {
  const archive = pins.archives[key];
  if (!archive || !pins.libraries[key]) throw new Error(`no ONNX Runtime for ${key}`);
  let githubError;
  try {
    const bytes = await pinned(`${RELEASES}/v${archive.version}/${archive.name}`, archive.name, archive, { fetchImpl, cacheDir });
    const got = fromGithub(key, bytes, pins);
    checkLibrary(key, got.lib, `the GitHub archive ${archive.name}`, pins.libraries);
    log(`ONNX Runtime ${archive.version} ${key}: from GitHub (${archive.name})`);
    return { ...got, source: "github" };
  } catch (error) {
    if (!githubUnavailable(error)) throw error;
    githubError = error;
  }
  const version = archive.version;
  const name = `microsoft.ml.onnxruntime.${version}.nupkg`;
  log(`ONNX Runtime ${version} ${key}: GitHub cannot deliver (${githubError.message}); trying the NuGet package Microsoft.ML.OnnxRuntime ${version}`);
  const packagePin = pins.packages[version];
  if (!packagePin) throw new Error(`no pinned NuGet package for ONNX Runtime ${version}`);
  const nupkg = await pinned(`${NUGET}/${version}/${name}`, name, packagePin, { fetchImpl, cacheDir });
  const got = fromNuget(key, nupkg, pins);
  checkLibrary(key, got.lib, `the NuGet package ${name}`, pins.libraries);
  log(`ONNX Runtime ${version} ${key}: from NuGet (Microsoft.ML.OnnxRuntime ${version}, runtimes/${pins.libraries[key].rid}/native/${pins.libraries[key].file})`);
  return { ...got, source: "nuget" };
}

async function main() {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at > 0 ? process.argv[at + 1] : fallback;
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.resolve(here, "../src-tauri/resources/onnxruntime");
  const cacheDir = path.join(os.tmpdir(), "plainva-onnxruntime");
  const platform = arg("platform", process.platform);
  const arch = arg("arch", process.arch);
  if (!OUTPUT[platform]) throw new Error(`no ONNX Runtime for ${platform}`);
  const output = path.join(target, OUTPUT[platform]);
  const keys = platform === "darwin" ? ["darwin-arm64", "darwin-x64"] : [`${platform}-${arch}`];
  if (keys.some((key) => !LIBRARIES[key])) throw new Error(`no ONNX Runtime for ${platform}-${arch}`);
  const stamp = keys.map((key) => LIBRARIES[key].sha256).join("+");
  // Outside the bundled folder, so it never ships.
  const marker = path.join(target, "..", "onnxruntime.source");
  if (fs.existsSync(output) && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === stamp) {
    console.log(`ONNX Runtime already in place: ${output}`);
    return;
  }
  const log = (line) => console.log(process.env.GITHUB_ACTIONS ? `::notice::${line}` : line);
  const got = [];
  for (const key of keys) got.push(await fetchLibrary(key, { cacheDir, log }));
  fs.mkdirSync(target, { recursive: true });
  if (platform === "darwin") {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "plainva-onnx-lipo-"));
    const slices = got.map((g, i) => {
      const file = path.join(scratch, `${keys[i]}.dylib`);
      fs.writeFileSync(file, g.lib);
      return file;
    });
    execFileSync("lipo", ["-create", ...slices, "-output", output]);
    fs.rmSync(scratch, { recursive: true, force: true });
  } else {
    fs.writeFileSync(output, got[0].lib);
  }
  // The licence and the notices of the libraries inside ship with it (the bundle configs name both).
  for (const name of NOTICES) {
    const text = got[0].notices[name];
    if (!text) throw new Error(`${name} missing from the ${got[0].source} source of ${keys[0]}`);
    fs.writeFileSync(path.join(target, name), text);
  }
  fs.writeFileSync(marker, stamp);
  console.log(`ONNX Runtime ${keys.map((k) => `${ARCHIVES[k].version} (${got[keys.indexOf(k)].source})`).join(" + ")} → ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
