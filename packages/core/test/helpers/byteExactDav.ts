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
  /** Files by decoded vault-relative path. */
  files: Map<string, { bytes: Uint8Array; etag: string }>;
  /** Collections by decoded vault-relative path ("" is the vault folder). */
  folders: Set<string>;
  log: string[];
  url: string;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export function byteExactDav(base = "https://dav.example.com/dav/Vault/"): ByteExactDav {
  const basePath = new URL(base).pathname;
  const files = new Map<string, { bytes: Uint8Array; etag: string }>();
  const folders = new Set<string>([""]);
  const log: string[] = [];
  let seq = 0;

  const rel = (url: string): string => {
    const pathname = new URL(url).pathname;
    const decoded = pathname.split("/").map((s) => decodeURIComponent(s)).join("/");
    const baseDecoded = basePath.split("/").map((s) => decodeURIComponent(s)).join("/");
    if (!decoded.startsWith(baseDecoded.replace(/\/$/, ""))) throw new Error(`outside the vault: ${decoded}`);
    return decoded.slice(baseDecoded.length).replace(/^\/+|\/+$/g, "");
  };
  const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const href = (p: string, collection: boolean) => `${basePath}${enc(p)}${collection && p ? "/" : ""}`;
  const entry = (p: string) => {
    if (folders.has(p)) {
      return `<d:response><d:href>${href(p, true)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`;
    }
    const f = files.get(p)!;
    return `<d:response><d:href>${href(p, false)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getetag>"${f.etag}"</d:getetag><d:getcontentlength>${f.bytes.length}</d:getcontentlength></d:prop></d:propstat></d:response>`;
  };
  const multistatus = (paths: string[]) =>
    new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${paths.map(entry).join("")}</d:multistatus>`, { status: 207 });
  const status = (code: number, headers?: Record<string, string>) =>
    new Response(code === 204 || code === 304 ? null : "", { status: code, headers });

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = String(input);
    const p = rel(url);
    log.push(`${method} ${p}`);
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    switch (method) {
      case "PROPFIND": {
        const depth = headers.get("Depth") ?? "infinity";
        if (!folders.has(p) && !files.has(p)) return status(404);
        if (files.has(p) || depth === "0") return multistatus([p]);
        const inside = (q: string) => (p === "" ? q !== "" : q.startsWith(`${p}/`));
        const all = [...folders, ...files.keys()].filter(inside);
        const children = depth === "1" ? all.filter((q) => parent(q) === p) : all;
        return multistatus([p, ...children]);
      }
      case "GET": {
        const f = files.get(p);
        return f ? new Response(f.bytes as BodyInit, { status: 200, headers: { ETag: `"${f.etag}"` } }) : status(404);
      }
      case "PUT": {
        if (!folders.has(parent(p))) return status(409);
        const body = init?.body as Uint8Array | undefined;
        const etag = `e${++seq}`;
        files.set(p, { bytes: body ? new Uint8Array(body) : new Uint8Array(), etag });
        return status(201, { ETag: `"${etag}"` });
      }
      case "MKCOL": {
        if (folders.has(p) || files.has(p)) return status(405);
        if (!folders.has(parent(p))) return status(409);
        folders.add(p);
        return status(201);
      }
      case "DELETE": {
        if (!folders.has(p) && !files.has(p)) return status(404);
        for (const q of [...files.keys()]) if (q === p || q.startsWith(`${p}/`)) files.delete(q);
        for (const q of [...folders]) if (q === p || q.startsWith(`${p}/`)) folders.delete(q);
        return status(204);
      }
      case "MOVE": {
        const dest = rel(headers.get("Destination")!);
        if (!folders.has(p) && !files.has(p)) return status(404);
        if (!folders.has(parent(dest))) return status(409);
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
  return { fetch, files, folders, log, url: base };
}
