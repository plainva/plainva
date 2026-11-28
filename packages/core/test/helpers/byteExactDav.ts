/**
 * An in-memory WebDAV server that stores names byte for byte, like Strato
 * HiDrive or a plain Apache mod_dav on Linux: "Neutralität" composed and
 * "Neutralität" decomposed are two different folders here. Enough of RFC 4918
 * for the sync: PROPFIND (Depth 0, 1, infinity), GET, PUT, MKCOL, DELETE,
 * MOVE. Every request is logged as "METHOD path" with the DECODED path, so a
 * test can tell the two spellings apart in its assertions.
 */
export interface ByteExactDav {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Files by decoded vault-relative path. `modified` (epoch ms) is listed as
   * `getlastmodified` where set: a PUT with `X-OC-Mtime` sets it, as Nextcloud
   * does, and so does `options.clock`.
   */
  files: Map<string, { bytes: Uint8Array; etag: string; modified?: number }>;
  /** Collections by decoded vault-relative path ("" is the vault folder). */
  folders: Set<string>;
  log: string[];
  url: string;
  /** Changes a file past WebDAV (null removes it), as another program on the server would (`lazyScan`). */
  pastWebdav: (path: string, text: string | null) => void;
  /** Switches the kind of folder tags while the server runs. */
  setFolderTags: (kind: FolderTagKind | undefined) => void;
  /** PROPFIND requests by depth, in order. */
  propfinds: string[];
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export interface ByteExactDavOptions {
  /** "honor" (default): If-Match / If-None-Match on PUT and DELETE, `Overwrite` on MOVE, as a real server; "ignore": none is looked at. */
  conditions?: "honor" | "ignore";
  /** Weak entity tags (`W/"…"`): a strong comparison, as If-Match demands, never matches them. */
  weakEtags?: boolean;
  /** The server's clock: a PUT without `X-OC-Mtime` records this time. Absent: such a PUT records none. */
  clock?: () => number;
  /**
   * Lists what Nextcloud adds besides in an `allprop` answer: each entry's
   * content type, ids, permissions and size, and each folder's tag, time and
   * quota. Off: an entry lists only what the sync reads.
   */
  nextcloudProps?: boolean;
  /**
   * How a PROPFIND that names its properties (`<d:prop>`) is answered:
   * - "honor" (default): as RFC 4918 has it, the named ones the entry has in
   *   a 200 propstat, the others in a 404 propstat;
   * - "ignore": the body is not read, the answer is the `allprop` one;
   * - "refuse" (400), "unsupported" (501), "fail" (500): the request fails;
   * - "garbage": a 207 whose body is no listing;
   * - "dropEtag", "dropResourcetype", "dropModified": that property is left
   *   out without a word, for one entry only (the first file; for
   *   "dropResourcetype" the first folder below the vault folder);
   * - "etagNotFound": the first file's tag comes in a 404 propstat, empty.
   * An `allprop` request (no body) is always answered in full.
   */
  propRequests?: "honor" | "ignore" | "refuse" | "unsupported" | "fail" | "garbage" | "dropEtag" | "dropResourcetype" | "dropModified" | "etagNotFound";
  /** Refuses `Depth: infinity` (403), as Apache mod_dav does by default: the sync walks with `Depth: 1`. */
  refuseInfinity?: boolean;
  /**
   * Folder tags (`getetag` on a collection), as the server kinds of the L7
   * review have them (webdavFolderTags.ts):
   * - "subtree": a hash of everything below (Nextcloud, ownCloud);
   * - "ownEntries": follows only the names right inside the folder (a folder's time on disk: Apache, Synology);
   * - "twoLevel": follows entries at most two levels below;
   * - "putOnly": counts the PUTs below, never a DELETE, MOVE or MKCOL;
   * - "static": never moves.
   * Absent: folders carry no tag. `setFolderTags` switches the kind while the server runs.
   */
  folderTags?: FolderTagKind;
  /**
   * Changes made past WebDAV (`pastWebdav`) reach the listing only with a
   * listing that is not `Depth: 0` (external storage scanned on access).
   * Without it they show at once.
   */
  lazyScan?: boolean;
  /** Lists `oc:permissions` for every entry ("M" for these folders and everything below them). */
  mounts?: ReadonlySet<string>;
}

export type FolderTagKind = "subtree" | "ownEntries" | "twoLevel" | "putOnly" | "static";

/** The properties a `<d:prop>` request names, by local name; null for `allprop` (no body, or `<allprop/>`). */
function namedProps(body: unknown): Set<string> | null {
  if (typeof body !== "string" || !/<([\w-]+:)?prop[\s>]/.test(body)) return null;
  const inner = /<([\w-]+:)?prop[^>]*>([\s\S]*?)<\/([\w-]+:)?prop>/.exec(body)?.[2] ?? "";
  return new Set([...inner.matchAll(/<(?:[\w-]+:)?([\w-]+)\s*\/>/g)].map((m) => m[1]!));
}

export function byteExactDav(base = "https://dav.example.com/dav/Vault/", options: ByteExactDavOptions = {}): ByteExactDav {
  const basePath = new URL(base).pathname;
  const files = new Map<string, { bytes: Uint8Array; etag: string; modified?: number }>();
  const folders = new Set<string>([""]);
  const log: string[] = [];
  let seq = 0;
  const tag = (etag: string) => (options.weakEtags ? `W/"${etag}"` : `"${etag}"`);
  let folderTags = options.folderTags;
  const staged = new Map<string, string | null>();
  const putsBelow = new Map<string, number>();
  const propfinds: string[] = [];
  const applyStaged = () => {
    for (const [p, text] of staged) {
      if (text === null) files.delete(p);
      else {
        const segments = p.split("/");
        for (let i = 1; i < segments.length; i++) folders.add(segments.slice(0, i).join("/"));
        files.set(p, { bytes: new TextEncoder().encode(text), etag: `x${++seq}`, ...(options.clock ? { modified: options.clock() } : {}) });
      }
    }
    staged.clear();
  };
  const fnv = (parts: string[]) => parts.sort().join("\n").split("").reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
  const folderTag = (p: string): string | undefined => {
    if (folderTags === undefined) return undefined;
    const below = (q: string) => (p === "" ? q !== "" : q.startsWith(`${p}/`));
    const rel = (q: string) => (p === "" ? q : q.slice(p.length + 1));
    switch (folderTags) {
      case "subtree":
        return "s" + fnv([...[...folders].filter(below).map((q) => `d:${q}`), ...[...files].filter(([q]) => below(q)).map(([q, f]) => `f:${q}:${f.etag}`)]);
      case "ownEntries":
        return "o" + fnv([...folders, ...files.keys()].filter((q) => below(q) && !rel(q).includes("/")));
      case "twoLevel":
        return "t" + fnv([...[...folders].filter((q) => below(q) && rel(q).split("/").length <= 2).map((q) => `d:${q}`), ...[...files].filter(([q]) => below(q) && rel(q).split("/").length <= 2).map(([q, f]) => `f:${q}:${f.etag}`)]);
      case "putOnly":
        return `p${putsBelow.get(p) ?? 0}`;
      case "static":
        return "static";
    }
  };
  const permissionsOf = (p: string): string | undefined => {
    if (!options.mounts) return undefined;
    const mounted = [...options.mounts].some((m) => p === m || p.startsWith(`${m}/`));
    return mounted ? "RGDNVCKM" : "RGDNVCK";
  };

  const rel = (url: string): string => {
    const pathname = new URL(url).pathname;
    const decoded = pathname.split("/").map((s) => decodeURIComponent(s)).join("/");
    const baseDecoded = basePath.split("/").map((s) => decodeURIComponent(s)).join("/");
    if (!decoded.startsWith(baseDecoded.replace(/\/$/, ""))) throw new Error(`outside the vault: ${decoded}`);
    return decoded.slice(baseDecoded.length).replace(/^\/+|\/+$/g, "");
  };
  const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const href = (p: string, collection: boolean) => `${basePath}${enc(p)}${collection && p ? "/" : ""}`;
  /** Every property the entry has, by local name, as XML. */
  const propsOf = (p: string): Array<[string, string]> => {
    const id = [...p].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261).toString(16).padStart(8, "0");
    const perms = permissionsOf(p);
    if (folders.has(p)) {
      const out: Array<[string, string]> = [["resourcetype", "<d:resourcetype><d:collection/></d:resourcetype>"]];
      const own = folderTag(p);
      if (own !== undefined) out.push(["getetag", `<d:getetag>"${own}"</d:getetag>`]);
      if (perms !== undefined) out.push(["permissions", `<oc:permissions>${perms}</oc:permissions>`]);
      if (options.nextcloudProps) {
        if (own === undefined) out.push(["getetag", `<d:getetag>"${id}f"</d:getetag>`]);
        out.push(
          ["getlastmodified", `<d:getlastmodified>${new Date(0).toUTCString()}</d:getlastmodified>`],
          ["quota-used-bytes", "<d:quota-used-bytes>123456789</d:quota-used-bytes>"],
          ["quota-available-bytes", "<d:quota-available-bytes>-3</d:quota-available-bytes>"],
          ["id", `<oc:id>${id}ocabcdef12345</oc:id>`],
          ["fileid", `<oc:fileid>${parseInt(id.slice(0, 6), 16)}</oc:fileid>`],
          ...(perms === undefined ? [["permissions", "<oc:permissions>RGDNVCK</oc:permissions>"] as [string, string]] : []),
          ["size", "<oc:size>123456</oc:size>"],
        );
      }
      return out;
    }
    const f = files.get(p)!;
    const out: Array<[string, string]> = [
      ["resourcetype", "<d:resourcetype/>"],
      ["getetag", `<d:getetag>${tag(f.etag)}</d:getetag>`],
      ["getcontentlength", `<d:getcontentlength>${f.bytes.length}</d:getcontentlength>`],
    ];
    if (f.modified !== undefined) out.push(["getlastmodified", `<d:getlastmodified>${new Date(f.modified).toUTCString()}</d:getlastmodified>`]);
    if (perms !== undefined) out.push(["permissions", `<oc:permissions>${perms}</oc:permissions>`]);
    if (options.nextcloudProps) {
      out.push(
        ["getcontenttype", "<d:getcontenttype>text/markdown</d:getcontenttype>"],
        ["id", `<oc:id>${id}ocabcdef12345</oc:id>`],
        ["fileid", `<oc:fileid>${parseInt(id.slice(0, 6), 16)}</oc:fileid>`],
        ...(perms === undefined ? [["permissions", "<oc:permissions>RGDNVW</oc:permissions>"] as [string, string]] : []),
        ["size", `<oc:size>${f.bytes.length}</oc:size>`],
        ["has-preview", "<nc:has-preview>false</nc:has-preview>"],
      );
    }
    return out;
  };
  const OK = "<d:status>HTTP/1.1 200 OK</d:status>";
  const NOT_FOUND = "<d:status>HTTP/1.1 404 Not Found</d:status>";
  const entry = (p: string, named: Set<string> | null, half: { path: string; prop: string } | null) => {
    const own = propsOf(p);
    const h = href(p, folders.has(p));
    if (named === null) return `<d:response><d:href>${h}</d:href><d:propstat><d:prop>${own.map(([, xml]) => xml).join("")}</d:prop>${options.nextcloudProps ? OK : ""}</d:propstat></d:response>`;
    const dropped = half !== null && half.path === p ? half.prop : null;
    const found = own.filter(([name]) => named.has(name) && name !== dropped);
    const missing = [...named].filter((name) => !own.some(([n]) => n === name) && name !== dropped);
    const etagNotFound = dropped === "getetag" && options.propRequests === "etagNotFound";
    if (etagNotFound) missing.push("getetag");
    return `<d:response><d:href>${h}</d:href>` +
      (found.length > 0 ? `<d:propstat><d:prop>${found.map(([, xml]) => xml).join("")}</d:prop>${OK}</d:propstat>` : "") +
      (missing.length > 0 ? `<d:propstat><d:prop>${missing.map((name) => `<d:${name}/>`).join("")}</d:prop>${NOT_FOUND}</d:propstat>` : "") +
      `</d:response>`;
  };
  const multistatus = (paths: string[], named: Set<string> | null = null) => {
    let half: { path: string; prop: string } | null = null;
    if (named !== null) {
      const firstFile = paths.find((q) => files.has(q));
      const firstFolder = paths.find((q) => q !== "" && folders.has(q));
      if (options.propRequests === "dropEtag" || options.propRequests === "etagNotFound") half = firstFile === undefined ? null : { path: firstFile, prop: "getetag" };
      if (options.propRequests === "dropModified") half = firstFile === undefined ? null : { path: firstFile, prop: "getlastmodified" };
      if (options.propRequests === "dropResourcetype") half = firstFolder === undefined ? null : { path: firstFolder, prop: "resourcetype" };
    }
    const ns = options.nextcloudProps || options.mounts ? ` xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"` : "";
    return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"${ns}>${paths.map((q) => entry(q, named, half)).join("")}</d:multistatus>`, { status: 207 });
  };
  const status = (code: number, headers?: Record<string, string>) =>
    new Response(code === 204 || code === 304 ? null : "", { status: code, headers });

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = String(input);
    const p = rel(url);
    log.push(`${method} ${p}`);
    // A write reaches the disk: a change made there past WebDAV and not yet
    // scanned is overwritten with it, as a real server's would be.
    if (method === "PUT" || method === "DELETE") {
      for (const q of [...staged.keys()]) if (q === p || q.startsWith(`${p}/`)) staged.delete(q);
    }
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    switch (method) {
      case "PROPFIND": {
        const depth = headers.get("Depth") ?? "infinity";
        propfinds.push(depth);
        if (!options.lazyScan || depth !== "0") applyStaged();
        const asked = namedProps(init?.body);
        const named = options.propRequests === "ignore" ? null : asked;
        if (named !== null) {
          if (options.propRequests === "refuse") return status(400);
          if (options.propRequests === "unsupported") return status(501);
          if (options.propRequests === "fail") return status(500);
        }
        if (!folders.has(p) && !files.has(p)) return status(404);
        if (depth === "infinity" && options.refuseInfinity) return status(403);
        if (named !== null && options.propRequests === "garbage") return new Response("<html><body>Login</body></html>", { status: 207 });
        if (files.has(p) || depth === "0") return multistatus([p], named);
        const inside = (q: string) => (p === "" ? q !== "" : q.startsWith(`${p}/`));
        const all = [...folders, ...files.keys()].filter(inside);
        const children = depth === "1" ? all.filter((q) => parent(q) === p) : all;
        return multistatus([p, ...children], named);
      }
      case "GET": {
        const f = files.get(p);
        return f ? new Response(f.bytes as BodyInit, { status: 200, headers: { ETag: tag(f.etag) } }) : status(404);
      }
      case "PUT": {
        // Preconditions as RFC 9110 has them (Nextcloud, Apache mod_dav): a
        // strong comparison of the entity tag, "*" for "any current file".
        // `conditions: "ignore"` plays a server that evaluates neither.
        if (options.conditions !== "ignore") {
          const ifMatch = headers.get("If-Match");
          const ifNoneMatch = headers.get("If-None-Match");
          const current = files.get(p);
          const strong = current ? `"${current.etag}"` : null;
          if (ifMatch !== null && (current === undefined || (ifMatch.trim() !== "*" && !ifMatch.split(",").some((t) => t.trim() === strong && !options.weakEtags)))) return status(412);
          if (ifNoneMatch !== null && current !== undefined && (ifNoneMatch.trim() === "*" || ifNoneMatch.split(",").some((t) => t.trim() === strong))) return status(412);
        }
        if (!folders.has(parent(p))) return status(409);
        const body = init?.body as Uint8Array | undefined;
        const etag = `e${++seq}`;
        for (let q = parent(p); ; q = parent(q)) {
          putsBelow.set(q, (putsBelow.get(q) ?? 0) + 1);
          if (q === "") break;
        }
        const mtime = headers.get("X-OC-Mtime");
        const modified = mtime !== null ? Number(mtime) * 1000 : options.clock?.();
        files.set(p, { bytes: body ? new Uint8Array(body) : new Uint8Array(), etag, ...(modified === undefined ? {} : { modified }) });
        return status(201, { ETag: tag(etag) });
      }
      case "MKCOL": {
        if (folders.has(p) || files.has(p)) return status(405);
        if (!folders.has(parent(p))) return status(409);
        folders.add(p);
        return status(201);
      }
      case "DELETE": {
        if (!folders.has(p) && !files.has(p)) return status(404);
        // A conditional DELETE (RFC 9110): the strong entity tag of the file.
        if (options.conditions !== "ignore") {
          const ifMatch = headers.get("If-Match");
          const current = files.get(p);
          if (ifMatch !== null && (current === undefined || (ifMatch.trim() !== "*" && !ifMatch.split(",").some((t) => t.trim() === `"${current.etag}"` && !options.weakEtags)))) return status(412);
        }
        for (const q of [...files.keys()]) if (q === p || q.startsWith(`${p}/`)) files.delete(q);
        for (const q of [...folders]) if (q === p || q.startsWith(`${p}/`)) folders.delete(q);
        return status(204);
      }
      case "MOVE": {
        const dest = rel(headers.get("Destination")!);
        if (!folders.has(p) && !files.has(p)) return status(404);
        if (!folders.has(parent(dest))) return status(409);
        // RFC 4918: `Overwrite: F` refuses an existing destination (412); the
        // default, T, replaces it.
        const taken = files.has(dest) || folders.has(dest);
        if (taken && (headers.get("Overwrite") ?? "T").toUpperCase() === "F" && options.conditions !== "ignore") return status(412);
        if (taken) {
          for (const q of [...files.keys()]) if (q === dest || q.startsWith(`${dest}/`)) files.delete(q);
          for (const q of [...folders]) if (q === dest || q.startsWith(`${dest}/`)) folders.delete(q);
        }
        const move = (q: string) => dest + q.slice(p.length);
        for (const q of [...files.keys()]) if (q === p || q.startsWith(`${p}/`)) {
          files.set(move(q), files.get(q)!);
          files.delete(q);
        }
        for (const q of [...folders]) if (q === p || q.startsWith(`${p}/`)) {
          folders.delete(q);
          folders.add(move(q));
        }
        return status(201);
      }
      default:
        return status(405);
    }
  };
  const pastWebdav = (path: string, text: string | null) => {
    staged.set(path, text);
    if (!options.lazyScan) applyStaged();
  };
  return { fetch, files, folders, log, url: base, pastWebdav, setFolderTags: (kind) => { folderTags = kind; }, propfinds };
}
