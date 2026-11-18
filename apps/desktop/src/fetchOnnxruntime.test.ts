import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ARCHIVES,
  checkLibrary,
  fetchLibrary,
  githubUnavailable,
  LIBRARIES,
  NUGET,
  PACKAGES,
  type Pins,
  readTarGzEntry,
  readZipEntry,
  RELEASES,
  sha256,
} from "../scripts/fetch-onnxruntime.mjs";

/**
 * ONNX Runtime for the desktop bundle comes from GitHub's release archives
 * and, when GitHub cannot deliver them (2026-11-18: the whole repository
 * answered 404), from Microsoft's NuGet package. Both ways end at one check:
 * the pinned SHA-256 of the library itself.
 */

// --- Tiny archive writers for the tests (stored zip, ustar tar.gz) ---------

function zip(entries: Record<string, Buffer | string>, { deflate = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content);
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
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
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

function tarGz(entries: Record<string, Buffer | string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.fill(" ", 148, 156);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

// --- A fake world: pins over fake bytes, a fetch that serves them ----------

const lib = Buffer.from("the library\n");
const otherLib = Buffer.from("another library\n");
const licence = "MIT License\n";
const notices = "Third party notices\n";

function world({ libInArchive = lib, libInPackage = lib }: { libInArchive?: Buffer; libInPackage?: Buffer } = {}) {
  const archive = tarGz({
    "onnxruntime-linux-x64-9.9.9/lib/libonnxruntime.so.9.9.9": libInArchive,
    "onnxruntime-linux-x64-9.9.9/LICENSE": licence,
    "onnxruntime-linux-x64-9.9.9/ThirdPartyNotices.txt": notices,
  });
  const nupkg = zip(
    { "runtimes/linux-x64/native/libonnxruntime.so": libInPackage, LICENSE: licence.replace(/\n/g, "\r\n"), "ThirdPartyNotices.txt": notices },
    { deflate: true },
  );
  const pins: Pins = {
    archives: { "linux-x64": { version: "9.9.9", name: "onnxruntime-linux-x64-9.9.9.tgz", bytes: archive.length, sha256: sha256(archive), library: "lib/libonnxruntime.so.9.9.9" } },
    packages: { "9.9.9": { bytes: nupkg.length, sha256: sha256(nupkg) } },
    libraries: { "linux-x64": { rid: "linux-x64", file: "libonnxruntime.so", bytes: lib.length, sha256: sha256(lib), sameOnGithub: true } },
  };
  const githubUrl = `${RELEASES}/v9.9.9/onnxruntime-linux-x64-9.9.9.tgz`;
  const nugetUrl = `${NUGET}/9.9.9/microsoft.ml.onnxruntime.9.9.9.nupkg`;
  return { archive, nupkg, pins, githubUrl, nugetUrl };
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

describe("the readers", () => {
  it("read one file out of a zip (stored and deflated) and out of a tar.gz", () => {
    expect(readZipEntry(zip({ "a/b.txt": "x", "c.txt": "yz" }), "c.txt")?.toString()).toBe("yz");
    expect(readZipEntry(zip({ "a/b.txt": "hello" }, { deflate: true }), "a/b.txt")?.toString()).toBe("hello");
    expect(readZipEntry(zip({ "a/b.txt": "x" }), "missing")).toBeUndefined();
    expect(readTarGzEntry(tarGz({ "top/lib/x.so": "lib", "top/LICENSE": "l" }), "top/lib/x.so")?.toString()).toBe("lib");
    expect(readTarGzEntry(tarGz({ "./top/LICENSE": "l" }), "top/LICENSE")?.toString()).toBe("l");
    expect(readTarGzEntry(tarGz({ "top/LICENSE": "l" }), "top/missing")).toBeUndefined();
    expect(() => readZipEntry(Buffer.from("not a zip at all, just text, long enough"), "x")).toThrow(/not a zip/);
  });
});

describe("the choice of source", () => {
  const quiet = () => {};

  it("takes GitHub when it delivers, and says so", async () => {
    const w = world();
    const { fetchImpl, asked } = fetchFrom({ [w.githubUrl]: w.archive });
    const lines: string[] = [];
    const got = await fetchLibrary("linux-x64", { fetchImpl, pins: w.pins, log: (l) => lines.push(l) });
    expect(got.source).toBe("github");
    expect(got.lib.equals(lib)).toBe(true);
    expect(got.notices.LICENSE?.toString()).toBe(licence);
    expect(got.notices["ThirdPartyNotices.txt"]?.toString()).toBe(notices);
    expect(asked).toEqual([w.githubUrl]);
    expect(lines).toEqual(["ONNX Runtime 9.9.9 linux-x64: from GitHub (onnxruntime-linux-x64-9.9.9.tgz)"]);
  });

  it("takes the NuGet package when GitHub answers 404, a server error or nothing at all — and names it", async () => {
    for (const github of [404, 500, 503, Object.assign(new TypeError("fetch failed"))] as Answer[]) {
      const w = world();
      const { fetchImpl, asked } = fetchFrom({ [w.githubUrl]: github, [w.nugetUrl]: w.nupkg });
      const lines: string[] = [];
      const got = await fetchLibrary("linux-x64", { fetchImpl, pins: w.pins, log: (l) => lines.push(l) });
      expect(got.source).toBe("nuget");
      expect(got.lib.equals(lib)).toBe(true);
      expect(got.notices.LICENSE?.toString()).toContain("MIT License");
      expect(got.notices["ThirdPartyNotices.txt"]?.toString()).toBe(notices);
      expect(asked).toEqual([w.githubUrl, w.nugetUrl]);
      expect(lines[0]).toMatch(/GitHub cannot deliver .*trying the NuGet package Microsoft\.ML\.OnnxRuntime 9\.9\.9/);
      expect(lines[1]).toBe("ONNX Runtime 9.9.9 linux-x64: from NuGet (Microsoft.ML.OnnxRuntime 9.9.9, runtimes/linux-x64/native/libonnxruntime.so)");
    }
  });

  it("does not try another source for an answer that is not a delivery problem (403, 401)", async () => {
    for (const status of [401, 403]) {
      const w = world();
      const { fetchImpl, asked } = fetchFrom({ [w.githubUrl]: status, [w.nugetUrl]: w.nupkg });
      await expect(fetchLibrary("linux-x64", { fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(`HTTP ${status}`);
      expect(asked).toEqual([w.githubUrl]);
    }
  });

  it("stops on a GitHub archive that does not meet its pin, without asking NuGet", async () => {
    const w = world();
    const { fetchImpl, asked } = fetchFrom({ [w.githubUrl]: Buffer.concat([w.archive, Buffer.from("x")]), [w.nugetUrl]: w.nupkg });
    await expect(fetchLibrary("linux-x64", { fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/size or SHA-256 differs from its pin/);
    expect(asked).toEqual([w.githubUrl]);
  });

  it("stops when the library is not the pinned one — on the GitHub way", async () => {
    const w = world({ libInArchive: otherLib });
    const { fetchImpl, asked } = fetchFrom({ [w.githubUrl]: w.archive, [w.nugetUrl]: w.nupkg });
    await expect(fetchLibrary("linux-x64", { fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/from the GitHub archive .*: the library is not the pinned one/);
    expect(asked).toEqual([w.githubUrl]);
  });

  it("stops when the library is not the pinned one — on the NuGet way", async () => {
    const w = world({ libInPackage: otherLib });
    const { fetchImpl } = fetchFrom({ [w.githubUrl]: 404, [w.nugetUrl]: w.nupkg });
    await expect(fetchLibrary("linux-x64", { fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/from the NuGet package .*: the library is not the pinned one/);
  });

  it("stops on a NuGet package that does not meet its pin, and when NuGet cannot deliver either", async () => {
    const w = world();
    const bad = fetchFrom({ [w.githubUrl]: 404, [w.nugetUrl]: Buffer.concat([w.nupkg, Buffer.from("x")]) });
    await expect(fetchLibrary("linux-x64", { fetchImpl: bad.fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/nupkg: size or SHA-256 differs/);
    const none = fetchFrom({ [w.githubUrl]: 404, [w.nugetUrl]: 404 });
    await expect(fetchLibrary("linux-x64", { fetchImpl: none.fetchImpl, pins: w.pins, log: quiet })).rejects.toThrow(/nupkg: HTTP 404/);
  });

  it("serves a pinned file from the cache and refetches one that no longer meets its pin", async () => {
    const w = world();
    const cacheDir = mkdtempSync(join(tmpdir(), "onnx-cache-"));
    const first = fetchFrom({ [w.githubUrl]: 404, [w.nugetUrl]: w.nupkg });
    await fetchLibrary("linux-x64", { fetchImpl: first.fetchImpl, pins: w.pins, cacheDir, log: quiet });
    expect(readFileSync(join(cacheDir, "microsoft.ml.onnxruntime.9.9.9.nupkg")).equals(w.nupkg)).toBe(true);
    const second = fetchFrom({ [w.githubUrl]: 404 });
    await expect(fetchLibrary("linux-x64", { fetchImpl: second.fetchImpl, pins: w.pins, cacheDir, log: quiet })).resolves.toMatchObject({ source: "nuget" });
    expect(second.asked).toEqual([w.githubUrl]);
  });

  it("knows which failures mean GitHub cannot deliver", () => {
    expect(githubUnavailable({ httpStatus: 404 })).toBe(true);
    expect(githubUnavailable({ httpStatus: 502 })).toBe(true);
    expect(githubUnavailable({ noAnswer: true })).toBe(true);
    expect(githubUnavailable({ httpStatus: 403 })).toBe(false);
    expect(githubUnavailable({ pinMismatch: true })).toBe(false);
    expect(githubUnavailable(new Error("ENOENT"))).toBe(false);
  });
});

describe("the pins", () => {
  it("cover the same six platforms on both ways, each with a library pin", () => {
    const keys = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"];
    expect(Object.keys(ARCHIVES).sort()).toEqual(keys);
    expect(Object.keys(LIBRARIES).sort()).toEqual(keys);
    for (const key of keys) {
      expect(LIBRARIES[key].sha256, key).toMatch(/^[0-9a-f]{64}$/);
      expect(PACKAGES[ARCHIVES[key].version], key).toBeDefined();
    }
    expect(Object.keys(PACKAGES).sort()).toEqual(["1.23.2", "1.30.0"]);
  });

  it("say where the two sources were shown to carry the same bytes (linux-x64), and nowhere else", () => {
    expect(Object.entries(LIBRARIES).filter(([, pin]) => pin.sameOnGithub).map(([key]) => key)).toEqual(["linux-x64"]);
  });

  it("check a library by size and hash", () => {
    const pins = { k: { rid: "r", file: "f", bytes: lib.length, sha256: sha256(lib), sameOnGithub: false } };
    expect(() => checkLibrary("k", lib, "test", pins)).not.toThrow();
    expect(() => checkLibrary("k", otherLib, "test", pins)).toThrow(/not the pinned one/);
  });
});
