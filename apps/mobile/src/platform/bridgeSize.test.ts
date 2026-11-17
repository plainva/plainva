import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * No file crosses the Capacitor bridge in one message (17.11.: the Android
 * app froze a few seconds after start). Every call's text is parsed on
 * Android's UI thread before a plugin runs, and every answer goes back the
 * same way - a 3 MB picture was a 4 MB string there, four at once during a
 * sync pull. The bridge here is a recorder: each call's text and each
 * answer's text is measured, and none may pass `LIMIT`, for a 20 MB file
 * written, read, hashed, downloaded and uploaded. The native side is a
 * folder in memory that behaves as the AtomicFile and WebDavHttp plugins do.
 */

const LIMIT = 512 * 1024;
const SIZE = 20 * 1024 * 1024;

const bridge = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  temps: new Map<string, { path: string; parts: Uint8Array[] }>(),
  messages: [] as Array<{ call: string; size: number }>,
  /** The next WebDavHttp answer's body. */
  responseBody: new Uint8Array(0),
  sentBodies: [] as Uint8Array[],
  crashAt: -1,
  calls: 0,
}));

vi.mock("@capacitor/core", () => {
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  const unb64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
  const measured = (plugin: string, methods: Record<string, (opts: any) => unknown>) =>
    Object.fromEntries(Object.entries(methods).map(([name, run]) => [name, async (opts: unknown) => {
      bridge.calls += 1;
      if (bridge.crashAt >= 0 && bridge.calls >= bridge.crashAt) throw new Error("the app was ended");
      bridge.messages.push({ call: `${plugin}.${name}`, size: JSON.stringify(opts ?? {}).length });
      const answer = await run(opts);
      bridge.messages.push({ call: `${plugin}.${name} answer`, size: JSON.stringify(answer ?? {}).length });
      return answer;
    }]));
  const plugins: Record<string, unknown> = {
    AtomicFile: measured("AtomicFile", {
      write: ({ path, data, encoding }) => { bridge.files.set(path, encoding === "base64" ? unb64(data) : new TextEncoder().encode(data)); },
      begin: ({ path }) => { const id = `w${bridge.temps.size + 1}-${path}`; bridge.temps.set(id, { path, parts: [] }); return { id }; },
      append: ({ id, data }) => { bridge.temps.get(id)!.parts.push(unb64(data)); },
      commit: ({ id }) => {
        const temp = bridge.temps.get(id)!;
        bridge.temps.delete(id);
        const whole = new Uint8Array(temp.parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const part of temp.parts) { whole.set(part, at); at += part.length; }
        bridge.files.set(temp.path, whole);
      },
      abort: ({ id }) => { bridge.temps.delete(id); },
      read: ({ path, offset, length }) => {
        const file = bridge.files.get(path);
        if (!file) throw Object.assign(new Error("File does not exist"), { code: "OS-PLUG-FILE-0008" });
        return { data: b64(file.subarray(offset, offset + Math.min(length, 256 * 1024))), size: file.length };
      },
      sha256: ({ path }) => ({ sha256: "f".repeat(64), size: bridge.files.get(path)!.length }),
      sweep: () => ({ removed: 0 }),
    }),
    WebDavHttp: measured("WebDavHttp", {
      request: ({ bodyFilePath, body, bodyBase64 }) => {
        if (bodyFilePath) bridge.sentBodies.push(bridge.files.get(bodyFilePath)!);
        else if (body !== undefined) bridge.sentBodies.push(bodyBase64 ? unb64(body) : new TextEncoder().encode(body));
        const payload = bridge.responseBody;
        if (payload.length <= 256 * 1024) return { status: 200, headers: {}, bodyBase64: b64(payload) };
        bridge.files.set(".plainva-http/.plainva-tmp-http-1", payload);
        return { status: 200, headers: {}, bodyFile: ".plainva-http/.plainva-tmp-http-1", bodySize: payload.length };
      },
      allowOrigin: () => undefined,
    }),
  };
  return {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
    registerPlugin: (name: string) => plugins[name] ?? {},
  };
});
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
  Filesystem: { deleteFile: async ({ path }: { path: string }) => { bridge.files.delete(path); } },
}));

const { atomicWriteBytes, atomicWriteText, nativeFileDigest, nativeReadBytes, BRIDGE_PART_BYTES } = await import("./atomicFile");
const { webdavFetch } = await import("../adapters/webdavHttp");

function picture(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + (i >> 11)) & 0xff;
  return bytes;
}

const largest = () => Math.max(...bridge.messages.map((m) => m.size));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

beforeEach(() => {
  bridge.files.clear();
  bridge.temps.clear();
  bridge.messages.length = 0;
  bridge.sentBodies.length = 0;
  bridge.responseBody = new Uint8Array(0);
  bridge.crashAt = -1;
  bridge.calls = 0;
});

describe("no message over the bridge passes 512 KB, for a 20 MB file", () => {
  const big = picture(SIZE);

  it("writing it, as bytes and as text", async () => {
    await atomicWriteBytes("vaults/v1/shot.png", big);
    expect(same(bridge.files.get("vaults/v1/shot.png")!, big)).toBe(true);
    const text = "x".repeat(SIZE);
    await atomicWriteText("vaults/v1/long.md", text);
    expect(bridge.files.get("vaults/v1/long.md")!.length).toBe(SIZE);
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });

  it("reading it", async () => {
    bridge.files.set("vaults/v1/shot.png", big);
    expect(same(await nativeReadBytes("vaults/v1/shot.png"), big)).toBe(true);
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });

  it("hashing it", async () => {
    bridge.files.set("vaults/v1/shot.png", big);
    expect(await nativeFileDigest("vaults/v1/shot.png")).toMatchObject({ size: SIZE });
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });

  it("downloading it", async () => {
    bridge.responseBody = big;
    const response = await webdavFetch("https://dav.example/shot.png");
    expect(same(new Uint8Array(await response.arrayBuffer()), big)).toBe(true);
    // The response file is gone once it is read.
    expect([...bridge.files.keys()]).toEqual([]);
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });

  it("uploading it", async () => {
    await webdavFetch("https://dav.example/shot.png", { method: "PUT", body: big });
    expect(same(bridge.sentBodies[0], big)).toBe(true);
    expect([...bridge.files.keys()]).toEqual([]);
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });
});

describe("a write in parts that ends anywhere", () => {
  it("leaves the target with its old bytes or all of the new ones, never part of them", async () => {
    const old = picture(1000);
    const next = picture(3 * BRIDGE_PART_BYTES + 17).map((b) => b ^ 0x5a);
    bridge.files.set("vaults/v1/shot.png", old);
    await atomicWriteBytes("vaults/v1/other.png", next);
    const total = bridge.calls;
    for (let crashAt = 1; crashAt <= total + 1; crashAt += 1) {
      bridge.files.set("vaults/v1/shot.png", old);
      bridge.temps.clear();
      bridge.calls = 0;
      bridge.crashAt = crashAt;
      await atomicWriteBytes("vaults/v1/shot.png", next).catch(() => {});
      const lies = bridge.files.get("vaults/v1/shot.png")!;
      expect({ crashAt, whole: same(lies, old) || same(lies, next) }).toEqual({ crashAt, whole: true });
    }
  });
});

describe("the native side has the calls on both platforms", () => {
  const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it.each(["begin", "append", "commit", "abort", "read", "sweep"])("%s", (method) => {
    const java = source("../../android/app/src/main/java/com/plainva/app/AtomicFilePlugin.java");
    expect(java).toMatch(new RegExp(`@PluginMethod\\s+public void ${method}\\(PluginCall call\\)`));
    const swift = source("../../ios/App/App/AtomicFilePlugin.swift");
    // A method missing from this list is invisible to the platform.
    expect(swift).toContain(`CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`);
    expect(swift).toMatch(new RegExp(`@objc func ${method}\\(_ call: CAPPluginCall\\)`));
  });

  it("large response bodies come back as a file on both platforms", () => {
    expect(source("../../android/app/src/main/java/com/plainva/app/WebDavHttpPlugin.java")).toMatch(/ret\.put\("bodyFile", RESPONSE_FOLDER/);
    expect(source("../../ios/App/App/WebDavHttpPlugin.swift")).toMatch(/"bodyFile": rel/);
  });

  it("a streamed upload's range reaches the Android plugin as sent", () => {
    // getLong answers an Integer with its default: every part of a chunked upload began at 0.
    const java = source("../../android/app/src/main/java/com/plainva/app/WebDavHttpPlugin.java");
    expect(java).not.toMatch(/call\.getLong\("bodyOffset"/);
    expect(java).toMatch(/optLong\("bodyOffset"/);
  });
});

describe("a note with twenty embedded 3 MB pictures (17.11., the phone froze also without a network)", () => {
  it("reads them at most two at a time, and no message passes 512 KB", async () => {
    const pictures = Array.from({ length: 20 }, (_, i) => `vaults/v1/Bilder/shot-${i}.png`);
    for (const path of pictures) bridge.files.set(path, picture(3 * 1024 * 1024));
    // Every part of a read takes a moment, as on a phone; a read is open from its first part to its last.
    const open = new Set<string>();
    let most = 0;
    const plugin = (await import("@capacitor/core")).registerPlugin("AtomicFile") as unknown as { read: (o: { path: string; offset: number; length: number }) => Promise<{ data: string; size: number }> };
    const read = plugin.read;
    plugin.read = async (opts) => {
      open.add(opts.path);
      most = Math.max(most, open.size);
      await new Promise((resume) => setTimeout(resume, 1));
      const answer = await read(opts);
      if (opts.offset + 256 * 1024 >= answer.size) open.delete(opts.path);
      return answer;
    };
    try {
      const all = await Promise.all(pictures.map((path) => nativeReadBytes(path)));
      expect(all.every((bytes) => bytes.length === 3 * 1024 * 1024)).toBe(true);
    } finally {
      plugin.read = read;
    }
    expect(most).toBeLessThanOrEqual(2);
    expect(most).toBe(2);
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });
});
