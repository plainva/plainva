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
  reads: new Map<string, Uint8Array>(),
  readIds: 0,
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
      // The old read by path, part by part (how the branch read before the second review).
      read: ({ path, offset, length }) => {
        const file = bridge.files.get(path);
        if (!file) throw Object.assign(new Error("File does not exist"), { code: "OS-PLUG-FILE-0008" });
        return { data: b64(file.subarray(offset, offset + Math.min(length, 256 * 1024))), size: file.length };
      },
      // A read by handle: the bytes as they were when it was opened, as an open file keeps them after a rename.
      openRead: ({ path }) => {
        const file = bridge.files.get(path);
        if (!file) throw Object.assign(new Error("File does not exist"), { code: "OS-PLUG-FILE-0008" });
        const id = `r${++bridge.readIds}`;
        bridge.reads.set(id, file);
        return { id, size: file.length };
      },
      readPart: ({ id, offset, length }) => {
        const file = bridge.reads.get(id);
        if (!file) throw new Error("no such read");
        return { data: b64(file.subarray(offset, offset + Math.min(length, 256 * 1024))), size: file.length };
      },
      closeRead: ({ id }) => { bridge.reads.delete(id); },
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

  it.each(["begin", "append", "commit", "abort", "openRead", "readPart", "closeRead", "sweep"])("%s", (method) => {
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
    expect(java).toMatch(/JsNumbers\.whole\(call, "bodyOffset"/);
  });
});

describe("a note with twenty embedded 3 MB pictures (17.11., the phone froze also without a network)", () => {
  it("reads them at most two at a time, and no message passes 512 KB", async () => {
    const pictures = Array.from({ length: 20 }, (_, i) => `vaults/v1/Bilder/shot-${i}.png`);
    for (const path of pictures) bridge.files.set(path, picture(3 * 1024 * 1024));
    // Every part of a read takes a moment, as on a phone; a read is open from its first part to its last.
    const open = new Set<string>();
    let most = 0;
    type Plugin = {
      openRead: (o: { path: string }) => Promise<{ id: string; size: number }>;
      readPart: (o: { id: string; offset: number; length: number }) => Promise<{ data: string }>;
      closeRead: (o: { id: string }) => Promise<void>;
    };
    const plugin = (await import("@capacitor/core")).registerPlugin("AtomicFile") as unknown as Plugin;
    const { openRead, readPart, closeRead } = plugin;
    plugin.openRead = async (opts) => {
      const answer = await openRead(opts);
      open.add(answer.id);
      most = Math.max(most, open.size);
      return answer;
    };
    plugin.readPart = async (opts) => {
      await new Promise((resume) => setTimeout(resume, 1));
      return readPart(opts);
    };
    plugin.closeRead = async (opts) => {
      open.delete(opts.id);
      return closeRead(opts);
    };
    try {
      const all = await Promise.all(pictures.map((path) => nativeReadBytes(path)));
      expect(all.every((bytes) => bytes.length === 3 * 1024 * 1024)).toBe(true);
    } finally {
      Object.assign(plugin, { openRead, readPart, closeRead });
    }
    expect(most).toBeLessThanOrEqual(2);
    expect(most).toBe(2);
    expect(largest()).toBeLessThanOrEqual(LIMIT);
  });
});

describe("a read is one version of the file (second review)", () => {
  it("a file replaced by one of the same size between two parts is read whole as the one that was opened", async () => {
    const oldNote = new TextEncoder().encode("- [ ] Task one\n" + "x".repeat(400 * 1024) + "\n- [ ] Task two\n");
    const newNote = new TextEncoder().encode("- [x] Task one\n" + "x".repeat(400 * 1024) + "\n- [x] Task two\n");
    expect(newNote.length).toBe(oldNote.length);
    bridge.files.set("vaults/v1/Tasks.md", oldNote);
    type Plugin = { readPart: (o: { id: string; offset: number; length: number }) => Promise<{ data: string }>; read: (o: { path: string; offset: number; length: number }) => Promise<{ data: string; size: number }> };
    const plugin = (await import("@capacitor/core")).registerPlugin("AtomicFile") as unknown as Plugin;
    const { readPart, read } = plugin;
    let parts = 0;
    // A sync pull or a save renames the new version into place after the first part.
    const replaceAfterFirst = () => { if (++parts === 1) bridge.files.set("vaults/v1/Tasks.md", newNote); };
    plugin.readPart = async (opts) => { const answer = await readPart(opts); replaceAfterFirst(); return answer; };
    plugin.read = async (opts) => { const answer = await read(opts); replaceAfterFirst(); return answer; };
    try {
      const text = new TextDecoder().decode(await nativeReadBytes("vaults/v1/Tasks.md"));
      expect({ head: text.slice(0, 14), tail: text.slice(-15, -1) }).toEqual({ head: "- [ ] Task one", tail: "- [ ] Task two" });
    } finally {
      Object.assign(plugin, { readPart, read });
    }
  });

  it("what the person opens does not wait behind two downloads", async () => {
    bridge.files.set("vaults/v1/a.bin", picture(1024)).set("vaults/v1/b.bin", picture(1024)).set("vaults/v1/note.md", picture(10));
    type Plugin = { readPart: (o: { id: string; offset: number; length: number }) => Promise<{ data: string }> };
    const plugin = (await import("@capacitor/core")).registerPlugin("AtomicFile") as unknown as Plugin;
    const { readPart } = plugin;
    let release!: () => void;
    const held = new Promise<void>((resume) => { release = resume; });
    const order: string[] = [];
    plugin.readPart = async (opts) => {
      const answer = await readPart(opts);
      if (answer.data.length > 100) await held; // the two downloads hang
      return answer;
    };
    try {
      const downloads = [nativeReadBytes("vaults/v1/a.bin", "DATA", "background"), nativeReadBytes("vaults/v1/b.bin", "DATA", "background")].map((p) => p.then(() => order.push("download")));
      await nativeReadBytes("vaults/v1/note.md").then(() => order.push("note"));
      expect(order).toEqual(["note"]);
      release();
      await Promise.all(downloads);
    } finally {
      plugin.readPart = readPart;
    }
  });

  it("of two writes to one file, the one begun last stays", async () => {
    const big = picture(3 * BRIDGE_PART_BYTES);
    const small = picture(10);
    await Promise.all([atomicWriteBytes("vaults/v1/x.bin", big), atomicWriteBytes("vaults/v1/x.bin", small)]);
    expect(same(bridge.files.get("vaults/v1/x.bin")!, small)).toBe(true);
  });

  it("a request given up removes the body its late answer left in a file", async () => {
    bridge.responseBody = picture(3 * 1024 * 1024);
    type Http = { request: (o: unknown) => Promise<unknown> };
    const http = (await import("@capacitor/core")).registerPlugin("WebDavHttp") as unknown as Http;
    const { request } = http;
    let answer!: () => void;
    const late = new Promise<void>((resume) => { answer = resume; });
    http.request = async (opts) => { await late; return request(opts); };
    try {
      const controller = new AbortController();
      const fetching = webdavFetch("https://dav.example/shot.png", { signal: controller.signal });
      controller.abort();
      await expect(fetching).rejects.toMatchObject({ name: "AbortError" });
      answer();
      await new Promise((resume) => setTimeout(resume, 10));
      expect([...bridge.files.keys()]).toEqual([]);
    } finally {
      http.request = request;
    }
  });
});

describe("a file written in place while it is read (third review)", () => {
  it("is never handed out cut short: the read starts again and gets the whole new version", async () => {
    const oldNote = new TextEncoder().encode("- [ ] old version\n" + "o".repeat(2030));
    const newNote = new TextEncoder().encode("- [x] new version\n" + "n".repeat(7030));
    bridge.files.set("vaults/v1/Note.md", oldNote);
    type Plugin = { openRead: (o: { path: string }) => Promise<{ id: string; size: number }> };
    const plugin = (await import("@capacitor/core")).registerPlugin("AtomicFile") as unknown as Plugin;
    const { openRead } = plugin;
    let opened = 0;
    plugin.openRead = async (opts) => {
      const answer = await openRead(opts);
      // Another app writes the file in place right after the first open: every open read sees the new bytes.
      if (++opened === 1) { bridge.files.set(opts.path, newNote); bridge.reads.set(answer.id, newNote); }
      return answer;
    };
    try {
      const bytes = await nativeReadBytes("vaults/v1/Note.md");
      expect(new TextDecoder().decode(bytes.subarray(0, 17))).toBe("- [x] new version");
      expect(bytes.length).toBe(newNote.length);
      expect(opened).toBe(2);
    } finally {
      plugin.openRead = openRead;
    }
  });
});

