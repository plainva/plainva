#!/usr/bin/env node
/**
 * Fetches Microsoft's ONNX Runtime for the iOS shell (plan KI-Harness P2a-3,
 * ADR 0021) into `ios/App/LocalModels/Frameworks/onnxruntime.xcframework`
 * (not in git). The local Swift package `LocalModels` names that folder as
 * its binary target, so this runs before Xcode resolves packages.
 *
 * The source is Microsoft's NuGet package `Microsoft.ML.OnnxRuntime` from
 * api.nuget.org — the package the desktop bundle falls back to
 * (apps/desktop/scripts/fetch-onnxruntime.mjs, PACKAGES), pinned by size and
 * SHA-256. The iOS framework is `runtimes/ios/native/onnxruntime.xcframework.zip`
 * in it, pinned by size and SHA-256 too (XCFRAMEWORKS). Its trust rests on
 * nuget.org and the package's signature by Microsoft Corporation.
 *
 * Until 2026-11-21 the Swift package pointed at the CocoaPods archive on
 * download.onnxruntime.ai, pinned by its checksum. That day the host answered
 * with a certificate for another name, its storage with 404, and
 * github.com/microsoft/onnxruntime with 404 as well; no iOS build could
 * resolve its packages. A Swift binary target has one URL and nothing to fall
 * back to. The CocoaPods archive could not be read that day, so it is not
 * shown that it carries the same bytes as the NuGet framework — same version,
 * same publisher, another archive.
 *
 *   node scripts/fetch-onnxruntime-ios.mjs
 *
 * Idempotent: a framework already there from the expected pin is kept. The
 * archives are read in-process, nothing downloaded is ever executed, and no
 * entry is written outside the framework folder or through a link.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { NUGET, PACKAGES, readZipEntry, sha256 } from "../../desktop/scripts/fetch-onnxruntime.mjs";

/** The ONNX Runtime version of the iOS shell; Android pins the same one in app/build.gradle. */
export const VERSION = "1.30.0";

/** Where the framework lies in the NuGet package. */
export const ENTRY = "runtimes/ios/native/onnxruntime.xcframework.zip";

/** The top folder of that archive, and the folder this script writes. */
export const FRAMEWORK = "onnxruntime.xcframework";

/** The framework archive inside the NuGet package, by version (measured 2026-11-21). */
export const XCFRAMEWORKS = {
  "1.30.0": { bytes: 59_674_673, sha256: "eb5939cdf6f3d406e694b35accd1e0298b452966c15d6ab5f0e671b9b29398a9" },
};

/** Every entry of a zip archive: name, packing, and the Unix mode when the archive carries one. */
export function listZipEntries(zip) {
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
  if (count === 0xffff || at === 0xffffffff) throw new Error("zip64 archives are not read");
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip central directory");
    const madeBy = zip.readUInt16LE(at + 4);
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const attributes = zip.readUInt32LE(at + 38);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error(`${name}: zip64 entries are not read`);
    // The upper byte of "version made by" names the system; 3 is Unix, and only then are the upper 16 attribute bits a file mode.
    const mode = madeBy >>> 8 === 3 ? attributes >>> 16 : 0;
    entries.push({ name, method, packed, size, local, mode });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryBytes(zip, entry) {
  if (zip.readUInt32LE(entry.local) !== 0x04034b50) throw new Error(`${entry.name}: broken local header`);
  const start = entry.local + 30 + zip.readUInt16LE(entry.local + 26) + zip.readUInt16LE(entry.local + 28);
  const data = zip.subarray(start, start + entry.packed);
  let bytes;
  if (entry.method === 0) bytes = Buffer.from(data);
  else if (entry.method === 8) bytes = zlib.inflateRawSync(data);
  else throw new Error(`${entry.name}: unsupported zip method ${entry.method}`);
  if (bytes.length !== entry.size) throw new Error(`${entry.name}: ${bytes.length} bytes, the archive says ${entry.size}`);
  return bytes;
}

const isInside = (root, file) => file === root || file.startsWith(root + path.sep);

/**
 * Unpacks the framework archive into `<target>/onnxruntime.xcframework`:
 * folders, files and the symbolic links of the Mac Catalyst slice. Every
 * entry has to lie in the framework folder. A link may only point downwards
 * from where it lies (no `..`, no absolute path — Microsoft's are `A` and
 * `Versions/Current/…`), and nothing may be written through a link: a chain
 * of links that each look harmless as text could otherwise climb out of the
 * folder on disk. Anything else stops the build before a byte is written.
 */
export function extractFramework(zip, target) {
  const root = path.resolve(target, FRAMEWORK);
  const plan = [];
  const links = new Set();
  for (const entry of listZipEntries(zip)) {
    const parts = entry.name.split("/");
    const folder = entry.name.endsWith("/");
    if (folder) parts.pop();
    if (entry.name.includes("\\") || parts.some((part) => part === "" || part === "." || part === "..") || parts[0] !== FRAMEWORK) {
      throw new Error(`${ENTRY}: unexpected entry ${JSON.stringify(entry.name)}`);
    }
    const file = path.resolve(target, ...parts);
    if (!isInside(root, file)) throw new Error(`${ENTRY}: ${JSON.stringify(entry.name)} leaves the framework folder`);
    const kind = folder ? "folder" : (entry.mode & 0o170000) === 0o120000 ? "link" : "file";
    const bytes = folder ? null : entryBytes(zip, entry);
    if (kind === "link") {
      const to = bytes.toString("utf8");
      const steps = to.split("/");
      if (to === "" || to.includes("\\") || path.isAbsolute(to) || steps.some((step) => step === "" || step === "." || step === "..")) {
        throw new Error(`${ENTRY}: the link ${JSON.stringify(entry.name)} points outside the framework folder`);
      }
      links.add(file);
    }
    plan.push({ kind, file, name: entry.name, bytes, mode: entry.mode & 0o777 });
  }
  if (!plan.some((step) => step.file === path.join(root, "Info.plist"))) throw new Error(`${ENTRY}: no ${FRAMEWORK}/Info.plist`);
  for (const step of plan) {
    for (let above = path.dirname(step.file); above !== root && isInside(root, above); above = path.dirname(above)) {
      if (links.has(above)) throw new Error(`${ENTRY}: ${JSON.stringify(step.name)} would be written through a link`);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const step of plan) {
    if (step.kind === "folder") {
      fs.mkdirSync(step.file, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(step.file), { recursive: true });
    if (step.kind === "link") fs.symlinkSync(step.bytes.toString("utf8"), step.file);
    else fs.writeFileSync(step.file, step.bytes, { mode: step.mode || 0o644 });
  }
  return plan.length;
}

/** Why a request got no answer: Node's fetch says "fetch failed" and keeps the TLS or DNS reason in the causes below. */
function reasons(error) {
  const said = [];
  for (let at = error; at !== undefined && at !== null && said.length < 4; at = at.cause) {
    const text = String(at?.message ?? at);
    said.push(at?.code && !text.includes(at.code) ? `${text} [${at.code}]` : text);
  }
  return said.join(": ");
}

async function download(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (cause) {
    throw new Error(`${url}: no answer (${reasons(cause)})`, { cause });
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function meets(bytes, pin) {
  return bytes.length === pin.bytes && sha256(bytes) === pin.sha256;
}

/**
 * The pinned framework archive out of the pinned NuGet package. The package
 * is kept in `cacheDir` and used again while it still meets its pin.
 */
export async function fetchFrameworkArchive({ version = VERSION, fetchImpl = fetch, cacheDir = null, log = console.log, pins = { packages: PACKAGES, xcframeworks: XCFRAMEWORKS } } = {}) {
  const packagePin = pins.packages[version];
  const frameworkPin = pins.xcframeworks[version];
  if (!packagePin || !frameworkPin) throw new Error(`no pinned NuGet package for ONNX Runtime ${version} on iOS`);
  const name = `microsoft.ml.onnxruntime.${version}.nupkg`;
  const cached = cacheDir ? path.join(cacheDir, name) : null;
  let nupkg = cached && fs.existsSync(cached) && fs.statSync(cached).size === packagePin.bytes ? fs.readFileSync(cached) : null;
  if (nupkg && !meets(nupkg, packagePin)) nupkg = null;
  if (!nupkg) {
    nupkg = await download(`${NUGET}/${version}/${name}`, fetchImpl);
    if (!meets(nupkg, packagePin)) {
      throw new Error(`${name}: size or SHA-256 differs from its pin (${nupkg.length}, ${sha256(nupkg)})`);
    }
    if (cached) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cached, nupkg);
    }
  }
  const archive = readZipEntry(nupkg, ENTRY);
  if (!archive) throw new Error(`Microsoft.ML.OnnxRuntime ${version}: ${ENTRY} missing`);
  if (!meets(archive, frameworkPin)) {
    throw new Error(
      `ONNX Runtime ${version} for iOS: the framework archive is not the pinned one (${archive.length} bytes, SHA-256 ${sha256(archive)}; expected ${frameworkPin.bytes} bytes, ${frameworkPin.sha256})`,
    );
  }
  log(`ONNX Runtime ${version} ios: from NuGet (Microsoft.ML.OnnxRuntime ${version}, ${ENTRY})`);
  return archive;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.resolve(here, "../ios/App/LocalModels/Frameworks");
  const stamp = XCFRAMEWORKS[VERSION].sha256;
  const marker = path.join(target, "onnxruntime.source");
  if (fs.existsSync(path.join(target, FRAMEWORK, "Info.plist")) && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === stamp) {
    console.log(`ONNX Runtime already in place: ${path.join(target, FRAMEWORK)}`);
    return;
  }
  const log = (line) => console.log(process.env.GITHUB_ACTIONS ? `::notice::${line}` : line);
  const archive = await fetchFrameworkArchive({ cacheDir: path.join(os.tmpdir(), "plainva-onnxruntime"), log });
  fs.mkdirSync(target, { recursive: true });
  fs.rmSync(marker, { force: true });
  const entries = extractFramework(archive, target);
  fs.writeFileSync(marker, stamp);
  console.log(`ONNX Runtime ${VERSION} (nuget) → ${path.join(target, FRAMEWORK)} (${entries} entries)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
