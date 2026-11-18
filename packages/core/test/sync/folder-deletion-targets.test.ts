import { afterEach, describe, expect, it, vi } from "vitest";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.js";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.js";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.js";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";
import { RemoteChangedError, type SyncOperation } from "../../src/sync/ISyncTarget.js";
import { byteExactDav } from "../helpers/byteExactDav.js";

/**
 * A folder's deletion takes everything below it on every service. A folder
 * goes only while the remote holds no file in it (Fehlerliste 0.9.0 F44):
 * another device may have put a note there since this device last looked —
 * and a conflict copy or a hidden file, which no listing of the sync reports,
 * is a file too. A folder that still holds one is refused as a moved remote
 * (`RemoteChangedError`), and nothing is deleted; a folder that holds only
 * empty folders goes.
 *
 * The services are played by small in-memory fakes that answer as the
 * documentation describes; none of this ran against a real provider.
 */

afterEach(() => vi.restoreAllMocks());

const bytes = (text: string) => new TextEncoder().encode(text);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const del = (path: string): SyncOperation => ({ id: 1, file_path: path, operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 });
const move = (from: string, to: string): SyncOperation =>
  ({ id: 1, file_path: from, new_path: to, operation: "rename", retry_count: 0, next_retry_at: 0, queued_at: 0 });

describe("WebDAV", () => {
  function server() {
    const dav = byteExactDav();
    const t = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) => dav.fetch(input, init));
    const put = (path: string) => dav.files.set(path, { bytes: bytes(path), etag: `x-${path}` });
    return { dav, t, put };
  }

  it("keeps a folder that holds a note, a conflict copy or a hidden file", async () => {
    for (const name of ["Neu.md", "Neu.CONFLICT-2026-11-16.md", ".keep"]) {
      const { dav, t, put } = server();
      dav.folders.add("Ordner");
      dav.folders.add("Ordner/Unter");
      put(`Ordner/Unter/${name}`);
      await expect(t.push(del("Ordner"))).rejects.toBeInstanceOf(RemoteChangedError);
      expect(dav.files.has(`Ordner/Unter/${name}`)).toBe(true);
      expect(dav.folders.has("Ordner")).toBe(true);
    }
  });

  it("deletes a folder that holds only empty folders, and a file as before", async () => {
    const { dav, t, put } = server();
    dav.folders.add("Leer");
    dav.folders.add("Leer/Unter");
    put("a.md");
    await t.push(del("Leer"));
    await t.push(del("a.md"));
    expect(dav.folders.has("Leer")).toBe(false);
    expect(dav.folders.has("Leer/Unter")).toBe(false);
    expect(dav.files.has("a.md")).toBe(false);
  });
});

describe("S3", () => {
  const CREDS = { endpoint: "http://127.0.0.1:9000", region: "us-east-1", bucket: "vault", accessKeyId: "k", secretAccessKey: "s" };
  function bucket() {
    const objects = new Map<string, string>();
    const fetchFn = async (url: string, init: any) => {
      const u = new URL(url);
      const key = decodeURIComponent(u.pathname.replace(/^\/vault\/?/, ""));
      if (init.method === "GET" && u.searchParams.get("list-type") === "2") {
        const prefix = u.searchParams.get("prefix") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
        return new Response(`<?xml version="1.0"?><ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e"</ETag><Size>1</Size><LastModified>2026-10-21T00:00:00.000Z</LastModified></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`, { status: 200 });
      }
      if (init.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    };
    const t = new S3SyncTarget(CREDS as any, fetchFn as any, 30000, () => new Date(Date.UTC(2026, 9, 21)));
    return { objects, t };
  }

  it("keeps the keys under a folder that holds a file: none of them is swept", async () => {
    const { objects, t } = bucket();
    for (const key of ["Ordner/", "Ordner/Neu.md", "Ordner/Unter/"]) objects.set(key, key);
    await expect(t.push(del("Ordner"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect([...objects.keys()].sort()).toEqual(["Ordner/", "Ordner/Neu.md", "Ordner/Unter/"]);
  });

  it("deletes the folder markers of a folder that holds no file", async () => {
    const { objects, t } = bucket();
    for (const key of ["Leer/", "Leer/Unter/"]) objects.set(key, key);
    await t.push(del("Leer"));
    expect([...objects.keys()]).toEqual([]);
  });
});

describe("OneDrive", () => {
  const ROOT = "https://graph.microsoft.com/v1.0/me/drive/root:/Plainva/";
  function drive() {
    /** Paths of the vault; a folder ends without content. */
    const items = new Map<string, { folder: boolean }>();
    const requests: { method: string; url: string; body?: string }[] = [];
    const fetchFn = async (url: string, init: any) => {
      const method = init.method as string;
      requests.push({ method, url, body: typeof init.body === "string" ? init.body : undefined });
      const rest = decodeURIComponent(url.slice(ROOT.length));
      const children = rest.match(/^(.*):\/children(\?.*)?$/);
      if (method === "GET" && children) {
        const folder = children[1]!;
        if (!items.get(folder)?.folder) return json(404, { error: { code: "itemNotFound" } });
        const below = [...items].filter(([p]) => p.startsWith(folder + "/") && !p.slice(folder.length + 1).includes("/"));
        return json(200, { value: below.map(([p, i]) => ({ id: p, name: p.split("/").pop(), ...(i.folder ? { folder: {} } : { file: {} }) })) });
      }
      const p = rest.replace(/:?\?.*$/, "").replace(/:$/, "");
      if (method === "DELETE") {
        if (!items.has(p)) return json(404, { error: { code: "itemNotFound" } });
        for (const key of [...items.keys()]) if (key === p || key.startsWith(p + "/")) items.delete(key);
        return new Response(null, { status: 204 });
      }
      if (method === "GET") {
        if (!items.has(p)) return json(404, { error: { code: "itemNotFound" } });
        return json(200, { id: p, name: p.split("/").pop(), ...(items.get(p)!.folder ? { folder: {} } : { file: {} }) });
      }
      if (method === "PATCH") {
        const body = JSON.parse(init.body);
        // A name another device just took: a refusal, whichever way Graph words it.
        if (items.has(body.name)) return json(409, { error: { code: "nameAlreadyExists" } });
        items.set(body.name, items.get(p)!);
        items.delete(p);
        return json(200, { id: body.name, name: body.name, eTag: "e", file: {} });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const t = new OneDriveSyncTarget({ clientId: "cid", refreshToken: "r", accessToken: "a" } as any, fetchFn as any);
    return { items, requests, t };
  }

  it("keeps a folder that holds a file, also a conflict copy deep down", async () => {
    const { items, t } = drive();
    items.set("Ordner", { folder: true });
    items.set("Ordner/Unter", { folder: true });
    items.set("Ordner/Unter/Neu.CONFLICT-2026-11-16.md", { folder: false });
    await expect(t.push(del("Ordner"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(items.has("Ordner/Unter/Neu.CONFLICT-2026-11-16.md")).toBe(true);
  });

  it("deletes a folder that holds only empty folders", async () => {
    const { items, t } = drive();
    items.set("Leer", { folder: true });
    items.set("Leer/Unter", { folder: true });
    await t.push(del("Leer"));
    expect([...items.keys()]).toEqual([]);
  });

  it("sends a move as it always has, without a parameter its documentation does not name, and refuses a taken destination before it", async () => {
    const { items, requests, t } = drive();
    items.set("old.md", { folder: false });
    items.set("new.md", { folder: false });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(requests.some((r) => r.url.includes("conflictBehavior"))).toBe(false);
    expect(items.has("old.md")).toBe(true);
  });

  it("a destination taken between the check and the move is a refusal too (409 nameAlreadyExists)", async () => {
    const { items, requests, t } = drive();
    items.set("old.md", { folder: false });
    let asked = false;
    const original = (t as any).itemExists.bind(t);
    (t as any).itemExists = async (path: string) => {
      const found = await original(path);
      if (!asked) { asked = true; items.set("new.md", { folder: false }); }
      return found;
    };
    await expect(t.push(move("old.md", "new.md"))).rejects.toBeInstanceOf(RemoteChangedError);
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).not.toContain("conflictBehavior");
    expect(JSON.parse(patch.body!)).toEqual({ name: "new.md" });
    expect(items.has("old.md")).toBe(true);
  });
});

describe("Dropbox", () => {
  function account() {
    const entries = new Map<string, "file" | "folder">();
    const fetchFn = async (url: string, init: any) => {
      const arg = init.body ? JSON.parse(init.body) : {};
      const endpoint = url.replace(/^https:\/\/(api|content)\.dropboxapi\.com\/2\//, "");
      const strip = (p: string) => p.replace(/^\/[^/]+\//, "");
      if (endpoint === "files/list_folder") {
        const p = strip(arg.path);
        if (!entries.has(p)) return json(409, { error_summary: "path/not_found/.." });
        if (entries.get(p) === "file") return json(409, { error_summary: "path/not_folder/.." });
        const below = [...entries].filter(([k]) => k.startsWith(p + "/"));
        return json(200, { entries: below.map(([k, tag]) => ({ ".tag": tag, name: k.split("/").pop(), path_display: `/Plainva/${k}` })), cursor: "c", has_more: false });
      }
      if (endpoint === "files/delete_v2") {
        const p = strip(arg.path);
        if (!entries.has(p)) return json(409, { error_summary: "path_lookup/not_found/.." });
        for (const key of [...entries.keys()]) if (key === p || key.startsWith(p + "/")) entries.delete(key);
        return json(200, { metadata: { ".tag": "folder" } });
      }
      if (endpoint === "files/move_v2") {
        if (!entries.has(strip(arg.from_path))) return json(409, { error_summary: "from_lookup/not_found/.." });
      }
      throw new Error(`unexpected ${url}`);
    };
    const t = new DropboxSyncTarget({ appKey: "k", refreshToken: "r", accessToken: "a" } as any, fetchFn as any, 30000, { simpleUpload: 8, chunk: 4 });
    return { entries, t };
  }

  it("keeps a folder that holds a file anywhere below it", async () => {
    const { entries, t } = account();
    entries.set("Ordner", "folder");
    entries.set("Ordner/Unter", "folder");
    entries.set("Ordner/Unter/Neu.md", "file");
    await expect(t.push(del("Ordner"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(entries.has("Ordner/Unter/Neu.md")).toBe(true);
  });

  it("deletes a folder that holds only empty folders", async () => {
    const { entries, t } = account();
    entries.set("Leer", "folder");
    entries.set("Leer/Unter", "folder");
    await t.push(del("Leer"));
    expect([...entries.keys()]).toEqual([]);
  });

  it("reports a move whose source is gone, so that the file is uploaded under its new name", async () => {
    const { t } = account();
    await expect(t.push(move("gone.md", "new.md"))).resolves.toEqual({ renameSourceMissing: true });
  });
});

describe("Google Drive", () => {
  function drive() {
    const items = new Map<string, { name: string; parent: string; folder: boolean }>();
    const FOLDER = "application/vnd.google-apps.folder";
    const fetchFn = async (url: string, init: any) => {
      const u = decodeURIComponent(String(url).replace(/\+/g, " "));
      const method = init.method as string;
      if (method === "GET" && u.includes("/drive/v3/files?")) {
        const name = u.match(/name='([^']*)'/)?.[1];
        const parent = u.match(/'([^']*)' in parents/)?.[1];
        if (name === "Plainva") return json(200, { files: [{ id: "root-folder", name: "Plainva", mimeType: FOLDER }] });
        const hits = [...items].filter(([, i]) => i.parent === parent && (name === undefined || i.name === name));
        return json(200, { files: hits.map(([id, i]) => ({ id, name: i.name, mimeType: i.folder ? FOLDER : "text/markdown" })) });
      }
      const idMatch = u.match(/\/drive\/v3\/files\/([^?]+)/);
      if (method === "DELETE" && idMatch) {
        const drop = (id: string) => { for (const [child, i] of [...items]) if (i.parent === id) drop(child); items.delete(id); };
        drop(idMatch[1]!);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${u}`);
    };
    const t = new DriveSyncTarget({ clientId: "cid", clientSecret: "s", refreshToken: "r", accessToken: "a" }, fetchFn as any);
    return { items, t };
  }

  it("keeps a folder that holds a file anywhere below it", async () => {
    const { items, t } = drive();
    items.set("f1", { name: "Ordner", parent: "root-folder", folder: true });
    items.set("f2", { name: "Unter", parent: "f1", folder: true });
    items.set("n1", { name: "Neu.md", parent: "f2", folder: false });
    await expect(t.push(del("Ordner"))).rejects.toBeInstanceOf(RemoteChangedError);
    expect(items.has("n1")).toBe(true);
  });

  it("deletes a folder that holds only empty folders", async () => {
    const { items, t } = drive();
    items.set("f1", { name: "Leer", parent: "root-folder", folder: true });
    items.set("f2", { name: "Unter", parent: "f1", folder: true });
    await t.push(del("Leer"));
    expect([...items.keys()]).toEqual([]);
  });
});
