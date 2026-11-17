import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.js";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.js";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.js";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";
import { RemoteChangedError, type ExpectedRemote, type SyncOperation } from "../../src/sync/ISyncTarget.js";
import { expectedDeletionOf } from "../../src/sync/SyncEngine.js";
import { byteExactDav } from "../helpers/byteExactDav.js";

/**
 * A DELETE removes only the version this device saw last, and a MOVE never
 * replaces what lies at its destination (Fehlerliste 0.9.0 A1), in the way
 * each service understands: WebDAV with `If-Match` and `Overwrite: F`,
 * OneDrive on the item's `eTag` and `conflictBehavior=fail` in the address, S3 by asking
 * right before (and `If-Match` where the store keeps conditional deletes),
 * Dropbox on the `rev` (`parent_rev`, `autorename: false`), Google Drive by
 * asking right before — it has no conditional delete. A refusal is
 * `RemoteChangedError`, and nothing is deleted or replaced.
 *
 * The services are played by small in-memory fakes that answer as the
 * documentation describes; none of this ran against a real provider.
 */

afterEach(() => vi.restoreAllMocks());

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);
const marker = (value: string): ExpectedRemote => ({ kind: "marker", marker: value });
const del = (path: string, expectedRemote?: ExpectedRemote): SyncOperation =>
  ({ id: 1, file_path: path, operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0, ...(expectedRemote ? { expectedRemote } : {}) });
const move = (from: string, to: string): SyncOperation =>
  ({ id: 1, file_path: from, new_path: to, operation: "rename", retry_count: 0, next_retry_at: 0, queued_at: 0 });

describe("what a deletion expects (the engine)", () => {
  it("the base's marker; nothing where the row has none or there is no row", () => {
    expect(expectedDeletionOf({ base_etag: "e1" })).toEqual(marker("e1"));
    expect(expectedDeletionOf({ base_etag: null })).toBeUndefined();
    expect(expectedDeletionOf(null)).toBeUndefined();
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
    return { dav, t, requests, put };
  }

  it("deletes with If-Match on the version this device saw", async () => {
    const { dav, t, put, requests } = target();
    put("a.md", "seen");
    await t.push(del("a.md", marker("x1")));
    expect(dav.files.has("a.md")).toBe(false);
    expect(requests.find((r) => r.method === "DELETE")!.headers.get("If-Match")).toBe(`"x1"`);
  });

  it("deletes nothing when another device changed the file", async () => {
    quiet();
    const { dav, t, put } = target();
    put("a.md", "theirs");
    await expect(t.push(del("a.md", marker("x0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(dav.files.get("a.md")!.bytes)).toBe("theirs");
  });

  it("a file that is gone already is done", async () => {
    const { t } = target();
    await expect(t.push(del("a.md", marker("x1")))).resolves.toBeUndefined();
  });

  it("weak tags: asks right before deleting", async () => {
    quiet();
    const { dav, t, put, requests } = target({ weakEtags: true });
    put("a.md", "theirs");
    await expect(t.push(del("a.md", marker("W/x0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(dav.files.has("a.md")).toBe(true);
    await t.push(del("a.md", marker("W/x1")));
    expect(dav.files.has("a.md")).toBe(false);
    expect(requests.filter((r) => r.method === "DELETE").every((r) => !r.headers.has("If-Match"))).toBe(true);
  });

  it("without an expectation (a folder, a file never synced) deletes after asking whether it is a folder that holds files", async () => {
    const { dav, t, put, requests } = target();
    put("a.md", "x");
    await t.push(del("a.md"));
    expect(dav.files.has("a.md")).toBe(false);
    expect(requests.map((r) => r.method)).toEqual(["PROPFIND", "DELETE"]);
  });

  it("a move never replaces its destination: Overwrite: F, and a refusal leaves both files", async () => {
    quiet();
    const { dav, t, put, requests } = target();
    put("old.md", "mine");
    put("new.md", "theirs");
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(dav.files.get("new.md")!.bytes)).toBe("theirs");
    expect(text(dav.files.get("old.md")!.bytes)).toBe("mine");
    expect(requests.find((r) => r.method === "MOVE")!.headers.get("Overwrite")).toBe("F");
  });

  it("a move to a free name goes as before; a change of letter case only carries no Overwrite", async () => {
    const { dav, t, put, requests } = target();
    put("old.md", "mine");
    await t.push(move("old.md", "new.md"));
    expect(text(dav.files.get("new.md")!.bytes)).toBe("mine");
    await t.push(move("new.md", "New.md"));
    expect(requests.filter((r) => r.method === "MOVE").map((r) => r.headers.get("Overwrite"))).toEqual(["F", null]);
  });
});

describe("S3", () => {
  const CREDS = { endpoint: "http://127.0.0.1:9000", region: "us-east-1", bucket: "vault", accessKeyId: "k", secretAccessKey: "s" };

  function bucket(mode: "aws" | "501" = "aws") {
    const objects = new Map<string, { body: Uint8Array; etag: string }>();
    const requests: { method: string; headers: Record<string, string>; key: string }[] = [];
    let seq = 0;
    const respond = (status: number, headers: Record<string, string> = {}, body = "") => new Response(status === 204 ? null : body, { status, headers });
    const fetchFn = async (url: string, init: any) => {
      const method = init.method as string;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
      const u = new URL(url);
      const key = decodeURIComponent(u.pathname.replace(/^\/vault\/?/, ""));
      requests.push({ method, headers, key });
      const current = objects.get(key);
      if (method === "GET" && u.searchParams.get("list-type") === "2") {
        const prefix = u.searchParams.get("prefix") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
        const xml = `<?xml version="1.0"?><ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><ETag>"${objects.get(k)!.etag}"</ETag><Size>1</Size><LastModified>2026-10-21T00:00:00.000Z</LastModified></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`;
        return respond(200, {}, xml);
      }
      if (method === "HEAD") return current ? respond(200, { ETag: `"${current.etag}"`, "Content-Length": String(current.body.length) }) : respond(404);
      if (method === "DELETE") {
        const ifMatch = headers["if-match"];
        if (ifMatch && mode === "501") return respond(501);
        if (ifMatch && current && ifMatch !== `"${current.etag}"`) return respond(412);
        objects.delete(key);
        return respond(204);
      }
      if (method === "PUT" && headers["x-amz-copy-source"]) {
        const from = decodeURIComponent(headers["x-amz-copy-source"].replace(/^\/vault\//, ""));
        const etag = `s${++seq}`;
        objects.set(key, { body: objects.get(from)!.body, etag });
        return respond(200, {}, `<CopyObjectResult><ETag>"${etag}"</ETag></CopyObjectResult>`);
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const t = new S3SyncTarget(CREDS as any, fetchFn as any, 30000, () => new Date(Date.UTC(2026, 9, 21)));
    const put = (key: string, content: string) => objects.set(key, { body: bytes(content), etag: `s${++seq}` });
    return { objects, requests, t, put };
  }

  it("asks right before, then deletes with If-Match on the ETag this device saw", async () => {
    const { objects, t, put, requests } = bucket();
    put("a.md", "seen");
    await t.push(del("a.md", marker("s1")));
    expect(objects.has("a.md")).toBe(false);
    expect(requests.find((r) => r.method === "DELETE" && r.key === "a.md")!.headers["if-match"]).toBe(`"s1"`);
  });

  it("deletes nothing when another device changed the object", async () => {
    quiet();
    const { objects, t, put } = bucket();
    put("a.md", "theirs");
    await expect(t.push(del("a.md", marker("s0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(objects.get("a.md")!.body)).toBe("theirs");
  });

  it("a store without conditional deletes (501) deletes after the question", async () => {
    quiet();
    const { objects, t, put } = bucket("501");
    put("a.md", "seen");
    await t.push(del("a.md", marker("s1")));
    expect(objects.has("a.md")).toBe(false);
  });

  it("a move never copies over an object at its destination", async () => {
    quiet();
    const { objects, t, put } = bucket();
    put("old.md", "mine");
    put("new.md", "theirs");
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(objects.get("new.md")!.body)).toBe("theirs");
    expect(text(objects.get("old.md")!.body)).toBe("mine");
    await t.push(move("old.md", "free.md"));
    expect(text(objects.get("free.md")!.body)).toBe("mine");
    expect(objects.has("old.md")).toBe(false);
  });
});

describe("OneDrive", () => {
  const ROOT = "https://graph.microsoft.com/v1.0/me/drive/root:/Plainva/";

  function drive() {
    const items = new Map<string, { body: Uint8Array; cTag: string; eTag: string; id: string }>();
    const requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
    let seq = 0;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const itemJson = (path: string) => { const i = items.get(path)!; return { id: i.id, name: path, cTag: i.cTag, eTag: i.eTag, size: i.body.length, file: {} }; };
    const store = (path: string, content: string) => {
      seq++;
      items.set(path, { body: bytes(content), cTag: `c${seq}`, eTag: `e${seq}`, id: `id-${path}` });
    };
    const fetchFn = async (url: string, init: any) => {
      const method = init.method as string;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
      requests.push({ method, url, headers, body: typeof init.body === "string" ? init.body : undefined });
      const rest = decodeURIComponent(url.slice(ROOT.length));
      const p = rest.replace(/:?\?.*$/, "").replace(/:$/, "");
      const current = items.get(p);
      if (method === "GET") return current ? json(200, itemJson(p)) : json(404, { error: { code: "itemNotFound" } });
      if (method === "DELETE") {
        if (!current) return json(404, { error: { code: "itemNotFound" } });
        if (headers["if-match"] && headers["if-match"] !== current.eTag) return json(412, { error: { code: "resourceModified" } });
        items.delete(p);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        if (!current) return json(404, { error: { code: "itemNotFound" } });
        const body = JSON.parse(init.body);
        const to = body.name as string;
        if (items.has(to) && to !== p) {
          if (new URL(url).searchParams.get("@microsoft.graph.conflictBehavior") === "fail") return json(409, { error: { code: "nameAlreadyExists" } });
        }
        items.delete(p);
        items.set(to, current);
        return json(200, itemJson(to));
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const t = new OneDriveSyncTarget({ clientId: "cid", refreshToken: "r", accessToken: "a" } as any, fetchFn as any);
    return { items, requests, t, store };
  }

  it("asks for the item, compares its cTag, and deletes on its eTag", async () => {
    const { items, t, store, requests } = drive();
    store("a.md", "seen");
    await t.push(del("a.md", marker("c1")));
    expect(items.has("a.md")).toBe(false);
    expect(requests.find((r) => r.method === "DELETE")!.headers["if-match"]).toBe("e1");
  });

  it("deletes nothing when another device changed the file", async () => {
    quiet();
    const { items, t, store } = drive();
    store("a.md", "theirs");
    await expect(t.push(del("a.md", marker("c0")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(items.get("a.md")!.body)).toBe("theirs");
  });

  it("a move never replaces its destination: conflictBehavior=fail, refused as a moved remote", async () => {
    quiet();
    const { items, t, store } = drive();
    store("old.md", "mine");
    store("new.md", "theirs");
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(items.get("new.md")!.body)).toBe("theirs");
    expect(text(items.get("old.md")!.body)).toBe("mine");
  });
});

describe("Dropbox", () => {
  function account() {
    const files = new Map<string, { body: Uint8Array; hash: string; rev: string }>();
    const calls: { endpoint: string; arg: any }[] = [];
    let seq = 0;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const meta = (path: string) => { const f = files.get(path)!; return { ".tag": "file", name: path, path_display: path, content_hash: f.hash, rev: f.rev, id: `id:${path}`, size: f.body.length }; };
    const fetchFn = async (url: string, init: any) => {
      const arg = init.body ? JSON.parse(init.body) : {};
      const endpoint = url.replace(/^https:\/\/(api|content)\.dropboxapi\.com\/2\//, "");
      calls.push({ endpoint, arg });
      const strip = (p: string) => p.replace(/^\/[^/]+\//, "");
      if (endpoint === "files/get_metadata") {
        const p = strip(arg.path);
        return files.has(p) ? json(200, meta(p)) : json(409, { error_summary: "path/not_found/.." });
      }
      if (endpoint === "files/delete_v2") {
        const p = strip(arg.path);
        const f = files.get(p);
        if (!f) return json(409, { error_summary: "path_lookup/not_found/.." });
        if (arg.parent_rev && arg.parent_rev !== f.rev) return json(409, { error_summary: "path_write/conflict/file/.." });
        files.delete(p);
        return json(200, { metadata: { ".tag": "file" } });
      }
      if (endpoint === "files/move_v2") {
        const from = strip(arg.from_path), to = strip(arg.to_path);
        if (!files.has(from)) return json(409, { error_summary: "from_lookup/not_found/.." });
        if (files.has(to) && to.toLowerCase() !== from.toLowerCase()) return json(409, { error_summary: "to/conflict/file/.." });
        files.set(to, files.get(from)!);
        files.delete(from);
        return json(200, { metadata: meta(to) });
      }
      throw new Error(`unexpected ${url}`);
    };
    const t = new DropboxSyncTarget({ appKey: "k", refreshToken: "r", accessToken: "a" } as any, fetchFn as any, 30000, { simpleUpload: 8, chunk: 4 });
    const put = (path: string, content: string) => files.set(path, { body: bytes(content), hash: `h(${content})`, rev: `r${++seq}` });
    return { files, calls, t, put };
  }

  it("asks for the file, compares its content_hash, and deletes on its rev", async () => {
    const { files, calls, t, put } = account();
    put("a.md", "seen");
    await t.push(del("a.md", marker("h(seen)")));
    expect(files.has("a.md")).toBe(false);
    expect(calls.find((c) => c.endpoint === "files/delete_v2")!.arg.parent_rev).toBe("r1");
  });

  it("deletes nothing when another device changed the file", async () => {
    quiet();
    const { files, t, put } = account();
    put("a.md", "theirs");
    await expect(t.push(del("a.md", marker("h(seen)")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(files.get("a.md")!.body)).toBe("theirs");
  });

  it("a move onto an existing name is refused as a moved remote, both files kept", async () => {
    quiet();
    const { files, t, put } = account();
    put("old.md", "mine");
    put("new.md", "theirs");
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(text(files.get("new.md")!.body)).toBe("theirs");
    expect(text(files.get("old.md")!.body)).toBe("mine");
  });
});

describe("Google Drive", () => {
  /** One folder of files by name; `md5Checksum` is the marker. */
  function drive() {
    const files = new Map<string, { id: string; md5: string }>();
    /** Drive's trash: a deletion goes there, never past it (F44). */
    const trash = new Set<string>();
    let seq = 0;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const byId = (id: string) => [...files].find(([, f]) => f.id === id);
    const fetchFn = async (url: string, init: any) => {
      const u = decodeURIComponent(String(url));
      const method = init.method as string;
      if (method === "GET" && u.includes("/drive/v3/files?") && u.includes("vnd.google-apps.folder")) return json(200, { files: [{ id: "root-folder", name: "Plainva" }] });
      if (method === "GET" && u.includes("/drive/v3/files?")) {
        const name = u.match(/name='([^']*)'/)?.[1] ?? "";
        const hits = [...files].filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([n, f]) => ({ id: f.id, name: n, md5Checksum: f.md5 }));
        return json(200, { files: hits });
      }
      const idMatch = u.match(/\/drive\/v3\/files\/([^?]+)/);
      if (idMatch) {
        const hit = byId(idMatch[1]!);
        if (!hit) return json(404, {});
        if (method === "GET") return json(200, { id: hit[1].id, md5Checksum: hit[1].md5 });
        if (method === "PATCH" && JSON.parse(init.body).trashed === true) { files.delete(hit[0]); trash.add(hit[0]); return json(200, { id: hit[1].id }); }
        if (method === "PATCH") {
          const body = JSON.parse(init.body);
          files.delete(hit[0]);
          files.set(body.name ?? hit[0], hit[1]);
          return json(200, { id: hit[1].id, md5Checksum: hit[1].md5 });
        }
      }
      throw new Error(`unexpected ${method} ${u}`);
    };
    const t = new DriveSyncTarget({ clientId: "cid", clientSecret: "s", refreshToken: "r", accessToken: "a" }, fetchFn as any);
    const put = (name: string, md5: string) => files.set(name, { id: `id${++seq}`, md5 });
    return { files, t, put, trash };
  }

  it("asks right before deleting: the version this device saw goes — into the trash", async () => {
    const { files, t, put, trash } = drive();
    put("a.md", "m1");
    await t.push(del("a.md", marker("m1")));
    expect(files.has("a.md")).toBe(false);
    expect(trash.has("a.md")).toBe(true);
  });

  it("deletes nothing when another device changed the file", async () => {
    quiet();
    const { files, t, put } = drive();
    put("a.md", "m2");
    await expect(t.push(del("a.md", marker("m1")))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(files.get("a.md")!.md5).toBe("m2");
  });

  it("a move never puts a second file of the destination's name beside it; a change of letter case still goes", async () => {
    quiet();
    const { files, t, put } = drive();
    put("old.md", "m1");
    put("new.md", "m2");
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect([...files.keys()].sort()).toEqual(["new.md", "old.md"]);
    await t.push(move("old.md", "Old.md"));
    expect([...files.keys()].sort()).toEqual(["Old.md", "new.md"]);
  });
});
