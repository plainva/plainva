import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { NUGET, PACKAGES, sha256 } from "../../desktop/scripts/fetch-onnxruntime.mjs";
import { ENTRY, extractFramework, fetchFrameworkArchive, FRAMEWORK, type IosPins, listZipEntries, VERSION, XCFRAMEWORKS } from "../scripts/fetch-onnxruntime-ios.mjs";

/**
 * ONNX Runtime for the iOS shell comes from Microsoft's NuGet package, pinned
 * by size and SHA-256, and a build step unpacks it for the local Swift
 * package. On 2026-11-21 the CocoaPods archive the package named by URL could
 * not be had, and no iOS build resolved its packages; the desktop bundle
 * already had NuGet as its second source, and Android takes its runtime from
 * Maven Central. These tests hold the two pins, the unpacking and the wiring:
 * a job that runs Xcode has to fetch the framework first.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const repoRoot = resolve(mobileRoot, "../..");

// --- A tiny zip writer that can carry Unix modes (folders, links) -----------

interface Item { content?: Buffer | string; mode?: number }
function zip(entries: Record<string, Item>, { deflate = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, item] of Object.entries(entries)) {
    const raw = Buffer.from(item.content ?? "");
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(item.mode === undefined ? 20 : (3 << 8) | 20, 4);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((item.mode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const FOLDER = 0o040755;
const FILE = 0o100644;
const LINK = 0o120755;

/** A framework archive shaped like Microsoft's: a plain slice and one with a versioned bundle and links. */
function framework(extra: Record<string, Item> = {}): Buffer {
  return zip(
    {
      [`${FRAMEWORK}/`]: { mode: FOLDER },
      [`${FRAMEWORK}/Info.plist`]: { content: "<plist/>", mode: FILE },
      [`${FRAMEWORK}/ios-arm64/onnxruntime.framework/onnxruntime`]: { content: "device library", mode: FILE },
      [`${FRAMEWORK}/ios-arm64/onnxruntime.framework/Headers/onnxruntime_c_api.h`]: { content: "// api", mode: FILE },
      [`${FRAMEWORK}/catalyst/onnxruntime.framework/Versions/A/onnxruntime`]: { content: "catalyst library", mode: FILE },
      [`${FRAMEWORK}/catalyst/onnxruntime.framework/Versions/Current`]: { content: "A", mode: LINK },
      [`${FRAMEWORK}/catalyst/onnxruntime.framework/onnxruntime`]: { content: "Versions/Current/onnxruntime", mode: LINK },
      ...extra,
    },
    { deflate: true },
  );
}

type Answer = Buffer | number | Error;
function fetchFrom(answers: Record<string, Answer>) {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    const answer = answers[url] ?? 404;
    if (answer instanceof Error) throw answer;
    if (typeof answer === "number") return { ok: false, status: answer, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => answer.buffer.slice(answer.byteOffset, answer.byteOffset + answer.byteLength) as ArrayBuffer };
  };
  return { fetchImpl, asked };
}

function world({ inPackage = framework() }: { inPackage?: Buffer | null } = {}) {
  const pinned = framework();
  const nupkg = zip(inPackage ? { [ENTRY]: { content: inPackage }, LICENSE: { content: "MIT License\n" } } : { LICENSE: { content: "MIT License\n" } });
  const pins: IosPins = {
    packages: { "9.9.9": { bytes: nupkg.length, sha256: sha256(nupkg) } },
    xcframeworks: { "9.9.9": { bytes: pinned.length, sha256: sha256(pinned) } },
  };
  return { pinned, nupkg, pins, url: `${NUGET}/9.9.9/microsoft.ml.onnxruntime.9.9.9.nupkg` };
}

const quiet = () => {};

describe("the framework archive", () => {
  it("comes out of the pinned NuGet package, and the log names the source", async () => {
    const w = world();
    const { fetchImpl, asked } = fetchFrom({ [w.url]: w.nupkg });
    const lines: string[] = [];
    const archive = await fetchFrameworkArchive({ version: "9.9.9", fetchImpl, pins: w.pins, log: (l) => lines.push(l) });
    expect(archive.equals(w.pinned)).toBe(true);
    expect(asked).toEqual([w.url]);
    expect(lines).toEqual([`ONNX Runtime 9.9.9 ios: from NuGet (Microsoft.ML.OnnxRuntime 9.9.9, ${ENTRY})`]);
  });

  it("stops at a package that is not the pinned one", async () => {
    const w = world();
    const other = zip({ [ENTRY]: { content: w.pinned }, LICENSE: { content: "another licence\n" } });
    const { fetchImpl } = fetchFrom({ [w.url]: other });
    await expect(fetchFrameworkArchive({ version: "9.9.9", fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/size or SHA-256 differs from its pin/);
  });

  it("stops at a framework that is not the pinned one, and names both hashes", async () => {
    const other = framework({ [`${FRAMEWORK}/ios-arm64/onnxruntime.framework/onnxruntime`]: { content: "another library", mode: FILE } });
    const w = world({ inPackage: other });
    const { fetchImpl } = fetchFrom({ [w.url]: w.nupkg });
    const failure = await fetchFrameworkArchive({ version: "9.9.9", fetchImpl, pins: w.pins, log: quiet }).catch((error: Error) => error.message);
    expect(failure).toContain("not the pinned one");
    expect(failure).toContain(sha256(other));
    expect(failure).toContain(w.pins.xcframeworks["9.9.9"]!.sha256);
  });

  it("stops when the package has no iOS framework, when NuGet does not deliver, and for a version without pins", async () => {
    const w = world({ inPackage: null });
    await expect(fetchFrameworkArchive({ version: "9.9.9", fetchImpl: fetchFrom({ [w.url]: w.nupkg }).fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/onnxruntime\.xcframework\.zip missing/);
    await expect(fetchFrameworkArchive({ version: "9.9.9", fetchImpl: fetchFrom({ [w.url]: 503 }).fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/HTTP 503/);
    await expect(fetchFrameworkArchive({ version: "9.9.9", fetchImpl: fetchFrom({ [w.url]: new Error("certificate is not valid") }).fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/no answer \(certificate is not valid\)/);
    await expect(fetchFrameworkArchive({ version: "1.2.3", fetchImpl: fetchFrom({}).fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/no pinned NuGet package/);
  });

  it("says why a request got no answer, down to the cause Node keeps below \"fetch failed\"", async () => {
    const w = world();
    const tls = Object.assign(new Error("certificate is not valid for this name"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    const failed = new TypeError("fetch failed", { cause: tls });
    const failure = await fetchFrameworkArchive({ version: "9.9.9", fetchImpl: fetchFrom({ [w.url]: failed }).fetchImpl, pins: w.pins, log: quiet }).catch((error: Error) => error.message);
    expect(failure).toBe(`${w.url}: no answer (fetch failed: certificate is not valid for this name [ERR_TLS_CERT_ALTNAME_INVALID])`);
  });

  it("keeps a downloaded package while it meets its pin", async () => {
    const w = world();
    const cacheDir = mkdtempSync(join(tmpdir(), "plainva-ios-ort-cache-"));
    const first = fetchFrom({ [w.url]: w.nupkg });
    await fetchFrameworkArchive({ version: "9.9.9", fetchImpl: first.fetchImpl, cacheDir, pins: w.pins, log: quiet });
    const second = fetchFrom({});
    const archive = await fetchFrameworkArchive({ version: "9.9.9", fetchImpl: second.fetchImpl, cacheDir, pins: w.pins, log: quiet });
    expect(archive.equals(w.pinned)).toBe(true);
    expect(first.asked).toHaveLength(1);
    expect(second.asked).toHaveLength(0);
  });
});

describe("unpacking", () => {
  it("reads names and Unix modes", () => {
    const entries = listZipEntries(framework());
    expect(entries.map((e) => e.name)).toContain(`${FRAMEWORK}/Info.plist`);
    expect(entries.find((e) => e.name === `${FRAMEWORK}/`)?.mode).toBe(FOLDER);
    expect(entries.find((e) => e.name.endsWith("/Versions/Current"))?.mode).toBe(LINK);
    // An archive from a system without file modes carries none.
    expect(listZipEntries(zip({ "a.txt": { content: "x" } }))[0]?.mode).toBe(0);
    expect(() => listZipEntries(Buffer.from("not a zip at all, just text, long enough"))).toThrow(/not a zip/);
  });

  it("writes folders, files and the links of a versioned bundle", () => {
    const target = mkdtempSync(join(tmpdir(), "plainva-ios-ort-"));
    expect(extractFramework(framework(), target)).toBe(7);
    const root = join(target, FRAMEWORK);
    expect(readFileSync(join(root, "Info.plist"), "utf8")).toBe("<plist/>");
    expect(readFileSync(join(root, "ios-arm64/onnxruntime.framework/onnxruntime"), "utf8")).toBe("device library");
    const link = join(root, "catalyst/onnxruntime.framework/onnxruntime");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe("Versions/Current/onnxruntime");
    expect(readFileSync(link, "utf8")).toBe("catalyst library");
  });

  it("replaces a framework that is already there", () => {
    const target = mkdtempSync(join(tmpdir(), "plainva-ios-ort-"));
    extractFramework(framework({ [`${FRAMEWORK}/old-slice/file`]: { content: "old", mode: FILE } }), target);
    extractFramework(framework(), target);
    expect(existsSync(join(target, FRAMEWORK, "old-slice"))).toBe(false);
  });

  it.each([
    ["an entry beside the framework folder", { "other/file": { content: "x", mode: FILE } }, /unexpected entry/],
    ["a path that climbs out", { [`${FRAMEWORK}/../escape`]: { content: "x", mode: FILE } }, /unexpected entry/],
    ["a backslash path", { [`${FRAMEWORK}\\file`]: { content: "x", mode: FILE } }, /unexpected entry/],
    ["a link that points outside", { [`${FRAMEWORK}/link`]: { content: "../../outside", mode: LINK } }, /points outside the framework folder/],
    ["an absolute link", { [`${FRAMEWORK}/link`]: { content: "/etc/hosts", mode: LINK } }, /points outside the framework folder/],
    // As text this one stays inside; on disk a chain of such links climbs out, so no link may go upwards at all.
    ["a link that goes up and comes back", { [`${FRAMEWORK}/ios-arm64/up`]: { content: "onnxruntime.framework/..", mode: LINK } }, /points outside the framework folder/],
    ["an empty link", { [`${FRAMEWORK}/link`]: { content: "", mode: LINK } }, /points outside the framework folder/],
    [
      "a file behind a link",
      { [`${FRAMEWORK}/alias`]: { content: "ios-arm64", mode: LINK }, [`${FRAMEWORK}/alias/planted`]: { content: "x", mode: FILE } },
      /would be written through a link/,
    ],
    [
      "a link behind a link",
      { [`${FRAMEWORK}/alias`]: { content: "ios-arm64", mode: LINK }, [`${FRAMEWORK}/alias/deeper/again`]: { content: "onnxruntime.framework", mode: LINK } },
      /would be written through a link/,
    ],
  ] as const)("refuses %s before it writes anything", (_what, extra, message) => {
    const target = mkdtempSync(join(tmpdir(), "plainva-ios-ort-"));
    expect(() => extractFramework(framework(extra), target)).toThrow(message);
    expect(existsSync(join(target, FRAMEWORK))).toBe(false);
  });

  it("refuses an archive without the framework's Info.plist", () => {
    const target = mkdtempSync(join(tmpdir(), "plainva-ios-ort-"));
    const bare = zip({ [`${FRAMEWORK}/`]: { mode: FOLDER }, [`${FRAMEWORK}/file`]: { content: "x", mode: FILE } });
    expect(() => extractFramework(bare, target)).toThrow(/no onnxruntime\.xcframework\/Info\.plist/);
  });
});

describe("the pins and the wiring", () => {
  it("pins the framework and the package of the version both phones run", () => {
    expect(XCFRAMEWORKS[VERSION]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PACKAGES[VERSION]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const gradle = readFileSync(join(mobileRoot, "android/app/build.gradle"), "utf8");
    expect(gradle).toContain(`com.microsoft.onnxruntime:onnxruntime-android:${VERSION}"`);
  });

  it("the Swift package links the fetched folder and names no download", () => {
    const manifest = readFileSync(join(mobileRoot, "ios/App/LocalModels/Package.swift"), "utf8");
    const code = manifest
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).toContain(`path: "Frameworks/${FRAMEWORK}"`);
    expect(code).not.toMatch(/url:|checksum:|https?:/);
    const ignored = readFileSync(join(mobileRoot, "ios/.gitignore"), "utf8").split("\n");
    expect(ignored).toContain("App/LocalModels/Frameworks");
  });

  it("every job that runs Xcode fetches the framework first", () => {
    const fetchStep = "node apps/mobile/scripts/fetch-onnxruntime-ios.mjs";
    const workflows = join(repoRoot, ".github/workflows");
    let jobsWithXcode = 0;
    // Every workflow, not a list of names: one added later is held to the same rule.
    for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
      const lines = readFileSync(join(workflows, file), "utf8").split("\n");
      const from = lines.findIndex((line) => line === "jobs:");
      expect(from, file).toBeGreaterThan(-1);
      let job = "";
      let fetched = false;
      let counted = false;
      for (const line of lines.slice(from + 1)) {
        const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (head) {
          job = head[1]!;
          fetched = false;
          counted = false;
          continue;
        }
        if (line.trim().startsWith("#")) continue;
        if (line.includes(fetchStep)) fetched = true;
        if (/\bxcodebuild\b/.test(line)) {
          expect(fetched, `${file}, job ${job}: xcodebuild runs before ${fetchStep}`).toBe(true);
          if (!counted) jobsWithXcode++;
          counted = true;
        }
      }
    }
    // ios.yml: the simulator build and the TestFlight upload; labs-mobile.yml: the Labs build.
    expect(jobsWithXcode).toBe(3);
  });
});
