/**
 * A Google Drive account with a trash, for the whole sync chain (F44).
 *
 * - `files.update` (PATCH) works on a trashed item and leaves it trashed
 *   unless `trashed: false` is sent;
 * - an item below a trashed folder is trashed too — `trashed` is "either
 *   explicitly or from a trashed parent folder" (File resource) — and a
 *   `trashed=false` query leaves it out;
 * - `files.create` under a trashed parent succeeds, and the new item is
 *   trashed through its parent;
 * - `files.delete` removes an item and what lies below it for good.
 *
 * What update and create do on a trashed item is not documented by Google;
 * the fake takes the case in which they succeed, where nothing tells the
 * caller but the `trashed` field. Not checked against a real account.
 */
type Item = { id: string; name: string; parent: string; folder: boolean; content: Uint8Array; md5: string; mtime: string; explicitTrash: boolean };

export function driveTrashFake() {
  const items = new Map<string, Item>();
  let seq = 0;
  let clock = Date.parse("2026-11-17T10:00:00Z");
  const FOLDER = "application/vnd.google-apps.folder";
  items.set("root-folder", { id: "root-folder", name: "Plainva", parent: "root", folder: true, content: new Uint8Array(), md5: "", mtime: new Date(clock).toISOString(), explicitTrash: false });
  const log: string[] = [];
  const md5 = (b: Uint8Array) => { let h = 0; for (const x of b) h = (h * 31 + x) >>> 0; return "m" + h.toString(16) + "-" + b.length; };
  const trashed = (id: string): boolean => { const it = items.get(id); if (!it) return false; if (it.explicitTrash) return true; return it.parent !== "root" && trashed(it.parent); };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const view = (it: Item) => ({ id: it.id, name: it.name, mimeType: it.folder ? FOLDER : "text/markdown", md5Checksum: it.folder ? undefined : it.md5, modifiedTime: it.mtime, size: String(it.content.length), trashed: trashed(it.id), parents: [it.parent] });
  const pathOf = (id: string): string => { const it = items.get(id)!; if (id === "root-folder") return ""; const p = pathOf(it.parent); return p ? `${p}/${it.name}` : it.name; };
  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input);
    const u = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    log.push(`${method} ${decodeURIComponent(u.pathname)}${u.search ? "?" + decodeURIComponent(u.search.slice(1)).slice(0, 90) : ""}`);
    if (u.pathname.endsWith("/token")) return json(200, { access_token: "a", expires_in: 3600 });
    if (u.pathname === "/drive/v3/changes/startPageToken") return json(200, { startPageToken: "1" });
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q") ?? "";
      const name = q.match(/name\s*=\s*'((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'");
      const parent = q.match(/'([^']*)' in parents/)?.[1];
      const onlyFolders = q.includes(`mimeType='${FOLDER}'`);
      const notTrashed = q.includes("trashed=false");
      const hits = [...items.values()].filter((it) => it.id !== "root-folder" || name === "Plainva")
        .filter((it) => (parent === undefined || it.parent === parent) && (name === undefined || it.name.toLowerCase() === name.toLowerCase()) && (!onlyFolders || it.folder) && (!notTrashed || !trashed(it.id)));
      return json(200, { files: hits.map(view) });
    }
    const idm = u.pathname.match(/^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/);
    if (idm) {
      const it = items.get(idm[1]!);
      if (!it) return json(404, { error: { code: 404, message: "File not found" } });
      if (method === "GET") {
        if (u.searchParams.get("alt") === "media") return new Response(it.content as unknown as BodyInit, { status: 200 });
        return json(200, view(it));
      }
      if (method === "DELETE") { const drop = (id: string) => { for (const c of [...items.values()]) if (c.parent === id) drop(c.id); items.delete(id); }; drop(it.id); return new Response(null, { status: 204 }); }
      if (method === "PATCH" && u.searchParams.get("uploadType") === "media") {
        const body = new Uint8Array(await new Response(init.body).arrayBuffer());
        it.content = body; it.md5 = md5(body); it.mtime = new Date(clock += 1000).toISOString();
        return json(200, view(it));
      }
      if (method === "PATCH") {
        const body = init.body ? JSON.parse(String(init.body)) : {};
        if (body.trashed === true) it.explicitTrash = true;
        if (body.trashed === false) it.explicitTrash = false;
        if (typeof body.name === "string") it.name = body.name;
        const add = u.searchParams.get("addParents");
        if (add) { if (!items.has(add)) return json(404, {}); it.parent = add; }
        return json(200, view(it));
      }
    }
    if ((u.pathname === "/upload/drive/v3/files" || u.pathname === "/drive/v3/files") && method === "POST") {
      let meta: any; let content = new Uint8Array();
      if (u.searchParams.get("uploadType") === "multipart") {
        const raw = new Uint8Array(await new Response(init.body).arrayBuffer());
        const text = new TextDecoder().decode(raw);
        const m = text.match(/\r\n\r\n(\{.*?\})\r\n--/s)!;
        meta = JSON.parse(m[1]!);
        const parts = text.split(/\r\n\r\n/);
        const last = parts.slice(2).join("\r\n\r\n");
        content = new TextEncoder().encode(last.replace(/\r\n--[^\r\n]*--$/, ""));
      } else meta = JSON.parse(String(init.body));
      const parent = meta.parents?.[0];
      if (!items.has(parent)) return json(404, { error: { code: 404, message: `File not found: ${parent}.` } });
      const id = `id${++seq}`;
      const it: Item = { id, name: meta.name, parent, folder: meta.mimeType === FOLDER, content, md5: md5(content), mtime: new Date(clock += 1000).toISOString(), explicitTrash: false };
      items.set(id, it);
      return json(200, view(it));
    }
    throw new Error(`fake: unexpected ${method} ${url}`);
  };
  const put = (path: string, text: string) => {
    const segs = path.split("/");
    let parent = "root-folder";
    for (const s of segs.slice(0, -1)) {
      let f = [...items.values()].find((it) => it.parent === parent && it.name === s && it.folder && !it.explicitTrash);
      if (!f) { f = { id: `id${++seq}`, name: s, parent, folder: true, content: new Uint8Array(), md5: "", mtime: new Date(clock).toISOString(), explicitTrash: false }; items.set(f.id, f); }
      parent = f.id;
    }
    const content = new TextEncoder().encode(text);
    const id = `id${++seq}`;
    items.set(id, { id, name: segs.at(-1)!, parent, folder: false, content, md5: md5(content), mtime: new Date(clock += 1000).toISOString(), explicitTrash: false });
    return id;
  };
  const mkdir = (path: string) => { put(path + "/__tmp", ""); const tmp = [...items.values()].find((i) => i.name === "__tmp")!; items.delete(tmp.id); };
  const tree = (withTrash = false) => [...items.values()].filter((it) => it.id !== "root-folder" && (withTrash || !trashed(it.id))).map((it) => pathOf(it.id) + (it.folder ? "/" : "") + (trashed(it.id) ? " [trash]" : "")).sort();
  return { items, fetchFn, put, mkdir, tree, log, trashed, pathOf };
}
