import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.js";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.js";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.js";
import { RemoteChangedError, type ExpectedRemote, type SyncOperation } from "../../src/sync/ISyncTarget.js";
import { expectedRemoteOf } from "../../src/sync/SyncEngine.js";
import { byteExactDav } from "../helpers/byteExactDav.js";

/**
 * Every upload names the version it expects on the remote, and each target
 * makes the write conditional on it in the way its service understands
 * (Sammelplan § 3.103): WebDAV and S3 with `If-Match` / `If-None-Match: *`,
 * OneDrive by asking for the item and uploading on its `eTag` (or with
 * `conflictBehavior=fail`), Dropbox by asking for the file and committing on
 * its `rev` (or with `add`). A refusal is `RemoteChangedError` and nothing is
 * written — unless the remote, asked, still holds what was expected: then the
 * service did not evaluate the condition, and the target writes after asking
 * right before, from then on.
 *
 * The services are played by small in-memory fakes that keep files and answer
 * as the documentation describes; none of this ran against a real provider.
 */

afterEach(() => vi.restoreAllMocks());

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);
function write(path: string, content: string, expectedRemote?: ExpectedRemote): SyncOperation {
  return { id: 1, file_path: path, operation: "write", content: bytes(content), retry_count: 0, next_retry_at: 0, queued_at: 0, ...(expectedRemote ? { expectedRemote } : {}) };
}
const marker = (value: string): ExpectedRemote => ({ kind: "marker", marker: value });
const ABSENT: ExpectedRemote = { kind: "absent" };

describe("which version an upload expects (the engine)", () => {
  it("the base's marker; no file where the row knows no remote copy; nothing for a base without a marker", () => {
    expect(expectedRemoteOf({ base_sha256: "b", base_etag: "e1", remote_etag: "e1" })).toEqual(marker("e1"));
    expect(expectedRemoteOf(null)).toEqual(ABSENT);
    expect(expectedRemoteOf({ base_sha256: null, base_etag: null, remote_etag: null })).toEqual(ABSENT);
    // A server that sent no ETag on the last upload, until the next listing brings one.
    expect(expectedRemoteOf({ base_sha256: "b", base_etag: null, remote_etag: null })).toBeUndefined();
    // The remote copy is known but nothing was agreed on: unconditional, as before.
    expect(expectedRemoteOf({ base_sha256: null, base_etag: null, remote_etag: "e1" })).toBeUndefined();
  });
});

describe("WebDAV", () => {
  function target(options?: Parameters<typeof byteExactDav>[1]) {
    const dav = byteExactDav(undefined, options);
    const requests: { method: string; headers: Headers }[] = [];
    const t = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) => {
      requests.push({ method: (init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers as HeadersInit | undefined) });
      return dav.fetch(input, init);
    });
    const put = (path: string, content: string) => dav.files.set(path, { bytes: bytes(content), etag: `x${dav.files.size + 1}` });
    return { dav, t, requests, put, puts: () => requests.filter((r) => r.method === "PUT") };
  }

  it("writes with If-Match on the base's entity tag while the server holds it", async () => {
    const { dav, t, put, puts } = target();
    put("a.md", "old");
    const result = await t.push(write("a.md", "new", marker(dav.files.get("a.md")!.etag)));
    expect(text(dav.files.get("a.md")!.bytes)).toBe("new");
    expect(result).toEqual({ etag: dav.files.get("a.md")!.etag });
    expect(puts()[0].headers.get("If-Match")).toBe(`"x1"`);
  });

  it("writes nothing when another device wrote first", async () => {
    quiet();
    const { dav, t, put } = target();
    put("a.md", "theirs");
    await expect(t.push(write("a.md", "mine", marker("x0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(dav.files.get("a.md")!.bytes)).toBe("theirs");
  });

  it("creates a new file only where none is — If-None-Match: *", async () => {
    quiet();
    const { dav, t, put, puts } = target();
    await t.push(write("new.md", "mine", ABSENT));
    expect(puts()[0].headers.get("If-None-Match")).toBe("*");
    put("other.md", "theirs");
    await expect(t.push(write("other.md", "mine", ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(dav.files.get("other.md")!.bytes)).toBe("theirs");
    expect(text(dav.files.get("new.md")!.bytes)).toBe("mine");
  });

  it("creates the missing folder and keeps the condition on the second attempt", async () => {
    const { dav, t, puts } = target();
    await t.push(write("deep/a.md", "mine", ABSENT));
    expect(text(dav.files.get("deep/a.md")!.bytes)).toBe("mine");
    expect(puts().map((r) => r.headers.get("If-None-Match"))).toEqual(["*", "*"]);
  });

  it("a weak entity tag gets no If-Match: the upload asks right before it writes", async () => {
    quiet();
    const { dav, t, put, requests, puts } = target({ weakEtags: true });
    put("a.md", "old");
    await t.push(write("a.md", "new", marker("W/x1")));
    expect(text(dav.files.get("a.md")!.bytes)).toBe("new");
    expect(puts()[0].headers.get("If-Match")).toBeNull();
    expect(requests.map((r) => r.method)).toEqual(["PROPFIND", "PUT"]);
    // Asked, the server holds another version: nothing is written.
    put("a.md", "theirs");
    await expect(t.push(write("a.md", "mine", marker("W/x1")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(dav.files.get("a.md")!.bytes)).toBe("theirs");
  });

  it("a server that keeps refusing a condition it should have met is asked and written to — and after three such refusals asked first", async () => {
    const warn = quiet();
    const dav = byteExactDav();
    const methods: string[] = [];
    // A server whose PUT answers 412 to any If-Match (a gateway that compares differently).
    const t = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      methods.push(`${(init?.method ?? "GET").toUpperCase()}${headers.has("If-Match") ? "+if" : ""}`);
      if (headers.has("If-Match")) return Promise.resolve(new Response("", { status: 412 }));
      return dav.fetch(input, init);
    });
    dav.files.set("a.md", { bytes: bytes("old"), etag: "x1" });
    for (const content of ["one", "two", "three"]) {
      methods.length = 0;
      await t.push(write("a.md", content, marker(dav.files.get("a.md")!.etag)));
      expect(text(dav.files.get("a.md")!.bytes)).toBe(content);
      // One odd refusal is no evidence: the next upload sends the condition again.
      expect(methods).toEqual(["PUT+if", "PROPFIND", "PUT"]);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    methods.length = 0;
    await t.push(write("a.md", "four", marker(dav.files.get("a.md")!.etag)));
    expect(methods).toEqual(["PROPFIND", "PUT"]);
    expect(text(dav.files.get("a.md")!.bytes)).toBe("four");
  });

  it("a refused new file where, asked, there is none (a collection at the path) does not turn the conditions off", async () => {
    const warn = quiet();
    const dav = byteExactDav();
    const methods: string[] = [];
    const t = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      methods.push(`${(init?.method ?? "GET").toUpperCase()}${headers.has("If-None-Match") || headers.has("If-Match") ? "+if" : ""}`);
      if (headers.has("If-None-Match") && String(input).endsWith("odd.md")) return Promise.resolve(new Response("", { status: 412 }));
      return dav.fetch(input, init);
    });
    await t.push(write("odd.md", "mine", ABSENT));
    expect(text(dav.files.get("odd.md")!.bytes)).toBe("mine");
    methods.length = 0;
    await t.push(write("new.md", "mine", ABSENT));
    expect(methods).toEqual(["PUT+if"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("without an expectation, writes as before: no condition, no question", async () => {
    const { dav, t, put, requests } = target();
    put("a.md", "old");
    await t.push(write("a.md", "new"));
    expect(text(dav.files.get("a.md")!.bytes)).toBe("new");
    expect(requests.map((r) => r.method)).toEqual(["PUT"]);
    expect(requests[0].headers.has("If-Match")).toBe(false);
    expect(requests[0].headers.has("If-None-Match")).toBe(false);
  });
});

describe("S3", () => {
  const CREDS = { endpoint: "http://127.0.0.1:9000", region: "us-east-1", bucket: "vault", accessKeyId: "k", secretAccessKey: "s" };

  /** A bucket that keeps objects by key and answers conditional PUTs like AWS (`mode`: "aws"), with 501, or ignoring them. */
  function bucket(mode: "aws" | "501" | "ignore" = "aws") {
    const objects = new Map<string, { body: Uint8Array; etag: string }>();
    const requests: { method: string; headers: Record<string, string> }[] = [];
    let seq = 0;
    const respond = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "", { status, headers });
    const fetchFn = async (url: string, init: any) => {
      const method = init.method as string;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
      requests.push({ method, headers });
      const key = decodeURIComponent(new URL(url).pathname.replace(/^\/vault\//, ""));
      const current = objects.get(key);
      if (method === "HEAD") return current ? respond(200, { ETag: `"${current.etag}"`, "Content-Length": String(current.body.length) }) : respond(404);
      if (method === "PUT") {
        const ifMatch = headers["if-match"], ifNoneMatch = headers["if-none-match"];
        if ((ifMatch || ifNoneMatch) && mode === "501") return respond(501);
        if (mode === "aws") {
          if (ifMatch && (!current || ifMatch !== `"${current.etag}"`)) return respond(412);
          if (ifNoneMatch === "*" && current) return respond(412);
        }
        const etag = `s${++seq}`;
        objects.set(key, { body: new Uint8Array(init.body as Uint8Array), etag });
        return respond(200, { ETag: `"${etag}"` });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const t = new S3SyncTarget(CREDS as any, fetchFn as any, 30000, () => new Date(Date.UTC(2026, 9, 21)));
    return { objects, requests, t, puts: () => requests.filter((r) => r.method === "PUT") };
  }

  it("writes with If-Match on the base's ETag, signed, while the bucket holds it", async () => {
    const { objects, t, puts } = bucket();
    objects.set("a.md", { body: bytes("old"), etag: "s0" });
    const result = await t.push(write("a.md", "new", marker("s0")));
    expect(result).toEqual({ etag: "s1" });
    expect(puts()[0].headers["if-match"]).toBe(`"s0"`);
    expect(puts()[0].headers["authorization"]).toContain("if-match");
  });

  it("writes nothing when another device wrote first, nor over a new object", async () => {
    quiet();
    const { objects, t } = bucket();
    objects.set("a.md", { body: bytes("theirs"), etag: "s9" });
    await expect(t.push(write("a.md", "mine", marker("s0")))).rejects.toBeInstanceOf(RemoteChangedError);
    await expect(t.push(write("a.md", "mine", ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(objects.get("a.md")!.body)).toBe("theirs");
    await t.push(write("b.md", "mine", ABSENT));
    expect(text(objects.get("b.md")!.body)).toBe("mine");
  });

  it("a store without conditional writes (501) is asked before each upload, and still refuses an overwrite it can see", async () => {
    quiet();
    const { objects, t, requests } = bucket("501");
    objects.set("a.md", { body: bytes("old"), etag: "s0" });
    await t.push(write("a.md", "new", marker("s0")));
    expect(text(objects.get("a.md")!.body)).toBe("new");
    expect(requests.map((r) => r.method)).toEqual(["PUT", "HEAD", "PUT"]);
    requests.length = 0;
    await expect(t.push(write("a.md", "mine", marker("s0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(requests.map((r) => r.method)).toEqual(["HEAD"]);
  });

  it("an If-Match on a key another device deleted (404, as AWS answers) is a moved remote", async () => {
    quiet();
    const { objects, t } = bucket();
    const fetchFn = (t as any).fetchFn;
    (t as any).fetchFn = async (url: string, init: any) => {
      const hasIf = Object.keys(init.headers ?? {}).some((k) => k.toLowerCase() === "if-match");
      if (init.method === "PUT" && hasIf && !objects.has("gone.md")) return new Response("", { status: 404 });
      return fetchFn(url, init);
    };
    await expect(t.push(write("gone.md", "mine", marker("s0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(objects.has("gone.md")).toBe(false);
  });

  it("another conditional write in flight (409) is a moved remote", async () => {
    quiet();
    const fetchFn = async (_url: string, init: any) => new Response("", { status: init.method === "PUT" ? 409 : 404 });
    const t = new S3SyncTarget(CREDS as any, fetchFn as any, 30000, () => new Date(Date.UTC(2026, 9, 21)));
    await expect(t.push(write("a.md", "mine", marker("s0")))).rejects.toBeInstanceOf(RemoteChangedError);
  });

  it("a marker the listing took from LastModified is no entity tag: the upload asks first, comparing the moment to the second", async () => {
    quiet();
    const modified = "Tue, 21 Oct 2026 10:00:00 GMT";
    const requests: string[] = [];
    let stored = "old";
    const fetchFn = async (_url: string, init: any) => {
      requests.push(`${init.method}${Object.keys(init.headers ?? {}).some((k) => /^if-/i.test(k)) ? "+if" : ""}`);
      // The HEAD carries an ETag the listing did not, and the moment to the second only.
      if (init.method === "HEAD") return new Response(null, { status: 200, headers: { "Last-Modified": modified, ETag: `"abc"`, "Content-Length": "3" } });
      stored = text(init.body);
      return new Response("", { status: 200 });
    };
    const t = new S3SyncTarget(CREDS as any, fetchFn as any, 30000, () => new Date(Date.UTC(2026, 9, 21)));
    await t.push(write("a.md", "new", marker("2026-10-21T10:00:00.587Z")));
    expect(stored).toBe("new");
    expect(requests).toEqual(["HEAD", "PUT"]);
    // A moment that differs is a moved remote.
    await expect(t.push(write("a.md", "newer", marker("2026-10-21T09:59:58.000Z")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(stored).toBe("new");
  });
});

describe("OneDrive", () => {
  const ROOT = "https://graph.microsoft.com/v1.0/me/drive/root:/Plainva/";

  /** A drive that keeps items by path; `cTag` moves with the content, `eTag` with anything. */
  function drive(opts: { ignoreIfMatch?: boolean } = {}) {
    const items = new Map<string, { body: Uint8Array; cTag: string; eTag: string; id: string }>();
    const requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
    let seq = 0;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const itemJson = (path: string) => { const i = items.get(path)!; return { id: i.id, name: path, cTag: i.cTag, eTag: i.eTag, size: i.body.length, file: {} }; };
    const store = (path: string, body: Uint8Array) => {
      seq++;
      const prev = items.get(path);
      items.set(path, { body, cTag: `c${seq}`, eTag: `e${seq}`, id: prev?.id ?? `id-${path}` });
    };
    const fetchFn = async (url: string, init: any) => {
      const method = init.method as string;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
      requests.push({ method, url, headers, body: typeof init.body === "string" ? init.body : undefined });
      if (url.startsWith("https://upload.example/")) {
        const path = decodeURIComponent(url.slice("https://upload.example/".length));
        store(path, new Uint8Array(init.body as Uint8Array));
        return json(201, itemJson(path));
      }
      const rest = decodeURIComponent(url.slice(ROOT.length));
      const [path, action] = rest.split(":/");
      const p = path.replace(/:?\?.*$/, "").replace(/:$/, "");
      const current = items.get(p);
      const ifMatch = opts.ignoreIfMatch ? undefined : headers["if-match"];
      if (method === "GET") return current ? json(200, itemJson(p)) : json(404, { error: { code: "itemNotFound" } });
      if (method === "PUT" && action?.startsWith("content")) {
        if (ifMatch && (!current || current.eTag !== ifMatch)) return json(412, { error: { code: "resourceModified" } });
        if (url.includes("conflictBehavior=fail") && current) return json(409, { error: { code: "nameAlreadyExists" } });
        store(p, new Uint8Array(init.body as Uint8Array));
        return json(201, itemJson(p));
      }
      if (method === "POST" && action === "createUploadSession") {
        if (ifMatch && (!current || current.eTag !== ifMatch)) return json(412, { error: { code: "resourceModified" } });
        if (JSON.parse(init.body).item["@microsoft.graph.conflictBehavior"] === "fail" && current) return json(409, { error: { code: "nameAlreadyExists" } });
        return json(200, { uploadUrl: `https://upload.example/${encodeURIComponent(p)}` });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const t = new OneDriveSyncTarget({ clientId: "cid", refreshToken: "r", accessToken: "a" } as any, fetchFn as any);
    return { items, requests, t, store, uploads: () => requests.filter((r) => r.method === "PUT" || r.method === "POST") };
  }

  it("asks for the item, compares its cTag with the base, and uploads on its eTag", async () => {
    const { items, t, store, uploads } = drive();
    store("a.md", bytes("old"));
    const result = await t.push(write("a.md", "new", marker("c1")));
    expect(text(items.get("a.md")!.body)).toBe("new");
    expect(result).toEqual({ etag: "c2", remoteId: "id-a.md" });
    expect(uploads()[0].headers["if-match"]).toBe("e1");
  });

  it("writes nothing when the content moved, nor over a file that must not exist", async () => {
    quiet();
    const { items, t, store } = drive();
    store("a.md", bytes("theirs"));
    await expect(t.push(write("a.md", "mine", marker("c0")))).rejects.toBeInstanceOf(RemoteChangedError);
    await expect(t.push(write("a.md", "mine", ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(items.get("a.md")!.body)).toBe("theirs");
    await t.push(write("b.md", "mine", ABSENT));
    expect(text(items.get("b.md")!.body)).toBe("mine");
  });

  it("only the item's metadata moved between the question and the upload: once more on the new eTag", async () => {
    const { items, t, store, uploads } = drive();
    store("a.md", bytes("old"));
    let touched = false;
    const orig = (t as any).statItem.bind(t);
    (t as any).statItem = async (p: string) => {
      const answer = await orig(p);
      // After the first question, the item gets a new eTag but keeps its content.
      if (!touched) { touched = true; const i = items.get("a.md")!; items.set("a.md", { ...i, eTag: "e-meta" }); }
      return answer;
    };
    await t.push(write("a.md", "new", marker("c1")));
    expect(text(items.get("a.md")!.body)).toBe("new");
    expect(uploads().map((r) => r.headers["if-match"])).toEqual(["e1", "e-meta"]);
  });

  it("a row a Business delta wrote names the version by its eTag: that holds as well", async () => {
    const { items, t, store } = drive();
    store("a.md", bytes("old"));
    await t.push(write("a.md", "new", marker("e1")));
    expect(text(items.get("a.md")!.body)).toBe("new");
  });

  it("a new file in a missing folder: the 409 is told apart from an existing file, the folder made, the condition kept", async () => {
    const { items, t, requests } = drive();
    let first = true;
    const fetchFn = (t as any).fetchFn;
    (t as any).fetchFn = async (url: string, init: any) => {
      if (init.method === "PUT" && url.includes("conflictBehavior=fail") && first) { first = false; return new Response(JSON.stringify({ error: { code: "parentMissing" } }), { status: 409 }); }
      if (init.method === "POST" && url.endsWith("/children")) return new Response("{}", { status: 201 });
      return fetchFn(url, init);
    };
    await t.push(write("deep/b.md", "mine", ABSENT));
    expect(text(items.get("deep/b.md")!.body)).toBe("mine");
    expect(requests.filter((r) => r.method === "PUT").length).toBe(1);
  });

  it("a file that appears while a large upload is under way is refused at the last chunk: a moved remote", async () => {
    quiet();
    const { items, t, store } = drive();
    const big = "x".repeat(4 * 1024 * 1024 + 1);
    const fetchFn = (t as any).fetchFn;
    (t as any).fetchFn = async (url: string, init: any) => {
      if (url.startsWith("https://upload.example/")) { store("late.bin", bytes("theirs")); return new Response(JSON.stringify({ error: { code: "nameAlreadyExists" } }), { status: 409 }); }
      return fetchFn(url, init);
    };
    await expect(t.push(write("late.bin", big, ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(items.get("late.bin")!.body)).toBe("theirs");
  });

  it("large files: the upload session carries the same condition", async () => {
    quiet();
    const { items, t, store, requests } = drive();
    const big = "x".repeat(4 * 1024 * 1024 + 1);
    store("big.bin", bytes("old"));
    await t.push(write("big.bin", big, marker("c1")));
    expect(items.get("big.bin")!.body.length).toBe(big.length);
    const session = requests.find((r) => r.url.endsWith("createUploadSession"))!;
    expect(session.headers["if-match"]).toBe("e1");
    expect(JSON.parse(session.body!).item["@microsoft.graph.conflictBehavior"]).toBe("replace");
    await expect(t.push(write("big.bin", big, ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    await expect(t.push(write("big.bin", big, marker("c0")))).rejects.toBeInstanceOf(RemoteChangedError);
  });
});

describe("Dropbox", () => {
  /** An account that keeps files by path; `content_hash` moves with the content, `rev` with every commit. */
  function account() {
    const files = new Map<string, { body: Uint8Array; hash: string; rev: string }>();
    const modes: unknown[] = [];
    let seq = 0;
    let sessionBody: number[] = [];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const meta = (path: string) => { const f = files.get(path)!; return { ".tag": "file", name: path, path_display: path, content_hash: f.hash, rev: f.rev, id: `id:${path}`, size: f.body.length }; };
    const commit = (path: string, body: Uint8Array, mode: any): Response => {
      modes.push(mode);
      const current = files.get(path);
      const hash = `h(${text(body)})`;
      if (mode === "add" && current && current.hash !== hash) return json(409, { error_summary: "path/conflict/file/.." });
      if (typeof mode === "object" && (!current || current.rev !== mode.update)) return json(409, { error_summary: "path/conflict/file/.." });
      files.set(path, { body, hash, rev: `r${++seq}` });
      return json(200, meta(path));
    };
    const fetchFn = async (url: string, init: any) => {
      const arg = init.headers?.["Dropbox-API-Arg"] ? JSON.parse(init.headers["Dropbox-API-Arg"]) : init.body ? JSON.parse(init.body) : {};
      const endpoint = url.replace(/^https:\/\/(api|content)\.dropboxapi\.com\/2\//, "");
      const strip = (p: string) => p.replace(/^\/[^/]+\//, "");
      if (endpoint === "files/get_metadata") {
        const p = strip(arg.path);
        return files.has(p) ? json(200, meta(p)) : json(409, { error_summary: "path/not_found/.." });
      }
      if (endpoint === "files/upload") return commit(strip(arg.path), new Uint8Array(init.body), arg.mode);
      if (endpoint === "files/upload_session/start") { sessionBody = [...new Uint8Array(init.body)]; return json(200, { session_id: "s1" }); }
      if (endpoint === "files/upload_session/append_v2") { sessionBody.push(...new Uint8Array(init.body)); return json(200, null); }
      if (endpoint === "files/upload_session/finish") {
        sessionBody.push(...new Uint8Array(init.body ?? new Uint8Array()));
        return commit(strip(arg.commit.path), new Uint8Array(sessionBody), arg.commit.mode);
      }
      throw new Error(`unexpected ${url}`);
    };
    const t = new DropboxSyncTarget({ appKey: "k", refreshToken: "r", accessToken: "a" } as any, fetchFn as any, 30000, { simpleUpload: 8, chunk: 4 });
    const put = (path: string, content: string) => files.set(path, { body: bytes(content), hash: `h(${content})`, rev: `r${++seq}` });
    return { files, modes, t, put };
  }

  it("asks for the file, compares its content_hash with the base, and commits on its rev", async () => {
    const { files, modes, t, put } = account();
    put("a.md", "old");
    const result = await t.push(write("a.md", "new", marker("h(old)")));
    expect(text(files.get("a.md")!.body)).toBe("new");
    expect(result).toMatchObject({ etag: "h(new)" });
    expect(modes).toEqual([{ ".tag": "update", update: "r1" }]);
  });

  it("writes nothing when the content moved, nor over a file that must not exist", async () => {
    quiet();
    const { files, t, put, modes } = account();
    put("a.md", "theirs");
    await expect(t.push(write("a.md", "mine", marker("h(old)")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(modes).toEqual([]);
    await expect(t.push(write("a.md", "mine", ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(files.get("a.md")!.body)).toBe("theirs");
    await t.push(write("b.md", "mine", ABSENT));
    expect(text(files.get("b.md")!.body)).toBe("mine");
  });

  it("only the revision moved between the question and the commit: once more on the new rev", async () => {
    const { files, modes, t, put } = account();
    put("a.md", "old");
    const orig = (t as any).statEntry.bind(t);
    let first = true;
    (t as any).statEntry = async (p: string) => {
      const answer = await orig(p);
      if (first) { first = false; files.set("a.md", { ...files.get("a.md")!, rev: "r-same-content" }); }
      return answer;
    };
    await t.push(write("a.md", "new", marker("h(old)")));
    expect(text(files.get("a.md")!.body)).toBe("new");
    expect(modes).toEqual([{ ".tag": "update", update: "r1" }, { ".tag": "update", update: "r-same-content" }]);
  });

  it("a folder at the path is no refused mode: the upload fails as before, and the conditions stay on", async () => {
    const warn = quiet();
    const { t, modes } = account();
    const fetchFn = (t as any).fetchFn;
    (t as any).fetchFn = async (url: string, init: any) => {
      if (url.endsWith("files/upload") && JSON.parse(init.headers["Dropbox-API-Arg"]).path.endsWith("dir.md")) {
        return new Response(JSON.stringify({ error_summary: "path/conflict/folder/.." }), { status: 409 });
      }
      return fetchFn(url, init);
    };
    await expect(t.push(write("dir.md", "mine", ABSENT))).rejects.not.toBeInstanceOf(RemoteChangedError);
    await t.push(write("ok.md", "mine", ABSENT));
    expect(modes).toEqual(["add"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("large files: the session's commit carries the same mode", async () => {
    quiet();
    const { files, modes, t, put } = account();
    put("big.md", "old");
    await t.push(write("big.md", "0123456789abc", marker("h(old)")));
    expect(text(files.get("big.md")!.body)).toBe("0123456789abc");
    expect(modes).toEqual([{ ".tag": "update", update: "r1" }]);
    await expect(t.push(write("big.md", "0123456789abc!", ABSENT))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(files.get("big.md")!.body)).toBe("0123456789abc");
  });
});
