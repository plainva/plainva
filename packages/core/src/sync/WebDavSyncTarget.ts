import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ISyncTarget, SyncOperation, PushResult, PullResult, SyncUploader } from "./ISyncTarget.js";
import { fetchWithRetry } from "./httpRetry.js";
import { timeoutForBody } from "./transferTimeout.js";
import { streamUpload } from "./streamUpload.js";

export interface WebDavCredentials {
  url: string;
  user: string;
  pass: string;
}

/** One flattened <response> entry of a PROPFIND multistatus body. */
export interface WebDavResponse {
  href: string | undefined;
  /** getetag of the (first) propstat that carries one; undefined for entries without an etag. */
  etag: string | undefined;
  isCollection: boolean;
}

/**
 * Parses a PROPFIND multistatus body into flat entries. Namespace prefixes are
 * stripped (d:response == D:Response == response), entities and CDATA are
 * decoded by the XML parser, tag values stay strings (an etag "123" must not
 * become a number).
 */
export function parseMultistatus(xml: string): WebDavResponse[] {
  // Strict validation first: the parser itself is lenient, and a garbage body
  // (e.g. an HTML login page served with HTTP 200 by a captive proxy) must
  // surface as a sync error — never as an "empty remote" listing.
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`invalid XML (line ${valid.err.line}): ${valid.err.msg}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => name === "response" || name === "propstat",
  });
  const doc = parser.parse(xml);
  const multistatus = doc?.multistatus;
  if (!multistatus) return [];
  const rawResponses: any[] = Array.isArray(multistatus.response) ? multistatus.response : [];

  const entries: WebDavResponse[] = [];
  for (const resp of rawResponses) {
    const href = typeof resp?.href === "string" ? resp.href : undefined;
    let etag: string | undefined;
    let isCollection = false;
    const propstats: any[] = Array.isArray(resp?.propstat) ? resp.propstat : [];
    for (const ps of propstats) {
      const prop = ps?.prop;
      if (!prop) continue;
      if (etag === undefined && typeof prop.getetag === "string") etag = prop.getetag;
      // <collection/> parses to an empty string; presence of the key is the signal.
      if (prop.resourcetype && typeof prop.resourcetype === "object" && "collection" in prop.resourcetype) {
        isCollection = true;
      }
    }
    entries.push({ href, etag, isCollection });
  }
  return entries;
}

/**
 * Percent-encodes a path one segment at a time. `encodeURI` is wrong here: it
 * leaves `#` and `?` untouched, so a note named "Draft #1.md" produced a URL
 * whose fragment started at the `#` — the PUT then landed on "Draft " and the
 * real name never reached the server.
 */
export function encodeDavPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * The inverse of `encodeDavPath`. Decoding per segment keeps an encoded `/`
 * inside a segment escaped — a file name can never carry the separator — and a
 * malformed escape (`%zz`, which `decodeURIComponent` throws on) keeps its raw
 * segment instead of failing the whole listing.
 */
export function decodeDavPath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class WebDavSyncTarget implements ISyncTarget {
  private fetchFn: FetchFn;
  /** Set once an uploader is injected — only then does the engine hand over
   *  a handle instead of a buffer. */
  public acceptsContentRef = false;

  constructor(
    private creds: WebDavCredentials,
    fetchFn?: FetchFn,
    private readonly timeoutMs: number = 30000,
    /** Streams a file straight from disk (issue #48); without it every write
     *  takes the buffer path, as before. */
    private readonly uploader?: SyncUploader
  ) {
    if (!this.creds.url.endsWith("/")) {
      this.creds.url += "/";
    }
    this.fetchFn = fetchFn || (typeof fetch !== "undefined" ? fetch : (() => { throw new Error("No fetch available"); }) as any);
    this.acceptsContentRef = Boolean(uploader);
  }

  private get headers(): Record<string, string> {
    const auth = btoa(unescape(encodeURIComponent(`${this.creds.user}:${this.creds.pass}`)));
    return {
      "Authorization": `Basic ${auth}`
    };
  }

  /**
   * Wraps every request with an abort-based timeout. Without this a single hung
   * request (server not responding, half-open connection) would block the sync
   * worker's await forever, leaving it permanently "syncing" after the first
   * cycle. On timeout the request rejects and the normal error/backoff handling
   * kicks in instead of freezing the worker.
   */
  private async request(method: string, url: string, init?: RequestInit): Promise<Response> {
    // Rate-limit/backoff (P3.2): PROPFIND/GET (listing, download) retry on
    // 429/5xx/network; every mutating verb only on 429 (server did not run it).
    const kind = method === "PROPFIND" || method === "GET" ? "read" : "write";
    return fetchWithRetry(() => this.singleRequest(method, url, init), kind);
  }

  private async singleRequest(method: string, url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    // The timeout covers the body as well, so it has to grow with it — a flat
    // budget turned a large upload into a network error the write path never
    // retries (issue #48).
    const budget = timeoutForBody(this.timeoutMs, init?.body);
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      return await this.fetchFn(url, { ...init, method, signal: controller.signal });
    } catch (err) {
      const reason = (err as any)?.name === "AbortError"
        ? `timeout after ${budget}ms`
        : (err instanceof Error ? err.message : String(err));
      console.error(`[WebDAV] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
    } finally {
      clearTimeout(timer);
    }
  }

  private urlForPath(filePath: string): string {
    let normalized = filePath.replace(/\\/g, "/");
    if (normalized.startsWith("/")) {
      normalized = normalized.substring(1);
    }
    return this.creds.url + encodeDavPath(normalized);
  }

  /**
   * One PUT of the file content. A write carrying a `contentRef` streams from
   * disk through the native uploader — the 90 MB attachment that used to travel
   * through the IPC boundary as a number array (issue #48) — and everything
   * else keeps the buffered request. Both hand back a `Response`, so the caller
   * (including the missing-parent retry) needs no second branch.
   */
  private async put(op: SyncOperation, url: string): Promise<Response> {
    if (op.contentRef && this.uploader) {
      return streamUpload(this.uploader, {
        ref: op.contentRef,
        url,
        method: "PUT",
        headers: this.headers,
      });
    }
    return this.request("PUT", url, {
      headers: this.headers,
      body: (op.content || new Uint8Array()) as any as BodyInit,
    });
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.file_path.includes(".CONFLICT")) {
      return;
    }

    if (op.operation === "write") {
      const url = this.urlForPath(op.file_path);

      const res = await this.put(op, url);

      if (!res.ok) {
        // RFC 4918 answers a PUT into a missing collection with 409, but real
        // servers (some Nextcloud/Apache setups) answer 404 instead — seen on
        // the maintainer's Nextcloud during the mobile roundtrip. A failing
        // PUT path can only mean a missing parent: create it and retry once.
        if (res.status === 409 || res.status === 404) {
            await this.ensureDir(op.file_path);
            const retryRes = await this.put(op, url);
            if (!retryRes.ok) throw new Error(`WebDAV PUT failed: ${retryRes.status} ${retryRes.statusText}`);
            const etag = retryRes.headers.get("ETag") || undefined;
            return { etag: etag?.replace(/"/g, "") };
        }
        throw new Error(`WebDAV PUT failed: ${res.status} ${res.statusText}`);
      }

      const etag = res.headers.get("ETag") || undefined;
      return { etag: etag?.replace(/"/g, "") };
    } else if (op.operation === "delete") {
      const url = this.urlForPath(op.file_path);
      const res = await this.request("DELETE", url, {
        headers: this.headers
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`WebDAV DELETE failed: ${res.status} ${res.statusText}`);
      }
    } else if (op.operation === "rename" && op.new_path) {
      if (op.new_path.includes(".CONFLICT")) return;

      const url = this.urlForPath(op.file_path);
      const destUrl = this.urlForPath(op.new_path);
      const res = await this.request("MOVE", url, {
        headers: {
          ...this.headers,
          "Destination": destUrl
        }
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`WebDAV MOVE failed: ${res.status} ${res.statusText}`);
      } else if (res.ok) {
        const etag = res.headers.get("ETag") || undefined;
        return { etag: etag?.replace(/"/g, "") };
      }
    }
  }

  private async ensureDir(filePath: string) {
      const normalizedPath = filePath.replace(/\\/g, "/");
      const parts = normalizedPath.split("/").filter(p => p.length > 0);
      parts.pop();
      let currentPath = "";
      for (const part of parts) {
          currentPath += part + "/";
          const res = await this.request("MKCOL", this.urlForPath(currentPath), {
              headers: this.headers
          });
          if (!res.ok && res.status !== 405) {
              throw new Error(`WebDAV MKCOL failed: ${res.status} ${res.statusText}`);
          }
      }
  }

  /**
   * Child folder names one level below `path` ("" = the server base URL) —
   * picker support (2026-07-13, unified online-vault setup). One PROPFIND with
   * Depth: 1; a 404 (folder does not exist yet) is an empty level, not an error.
   */
  public async listFolders(path: string): Promise<string[]> {
    const rel = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const url = rel ? this.urlForPath(rel + "/") : this.creds.url;
    const res = await this.request("PROPFIND", url, {
      headers: { ...this.headers, "Depth": "1" }
    });
    // Only the top level is asked for the base URL itself, so only its answer
    // reveals a redirect without having to subtract `rel` again.
    if (!rel) this.rememberEffectiveBase(res);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
    const names: string[] = [];
    for (const resp of this.parseListing(await res.text())) {
      if (!resp.href || !resp.isCollection) continue;
      // A Depth: 1 answer lists the collection itself first — skip it.
      const childRel = this.relativeHref(resp.href).replace(/\/+$/, "");
      if (!childRel || childRel === rel) continue;
      const name = childRel.split("/").pop() ?? childRel;
      if (WebDavSyncTarget.SKIPPED_COLLECTIONS.has(name)) continue;
      names.push(name);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Creates the folder chain for `path` relative to the server base URL —
   * picker "new folder" support (2026-07-13). MKCOL per level; 405 means the
   * collection already exists (same tolerance as ensureDir).
   */
  public async createFolder(path: string): Promise<void> {
    const rel = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!rel) return;
    let currentPath = "";
    for (const part of rel.split("/").filter((p) => p.length > 0)) {
      currentPath += part + "/";
      const res = await this.request("MKCOL", this.urlForPath(currentPath), {
        headers: this.headers
      });
      if (!res.ok && res.status !== 405) {
        throw new Error(`WebDAV MKCOL failed: ${res.status} ${res.statusText}`);
      }
    }
  }

  // WebDAV has no incremental change token: the `cursor` argument from the
  // ISyncTarget contract is intentionally ignored and a full PROPFIND listing is
  // always returned. Deletions are derived by the worker from the listing diff.
  public async pull(_cursor?: string): Promise<PullResult> {
    const res = await this.request("PROPFIND", this.creds.url, {
      headers: {
        ...this.headers,
        "Depth": "infinity"
      }
    });
    // Before the first href is resolved: a redirect moves the base path, and
    // resolving against the typed URL would put every entry outside the vault.
    this.rememberEffectiveBase(res);

    let responses: WebDavResponse[];
    if (res.ok) {
      responses = this.parseListing(await res.text());
    } else if (res.status === 404) {
      return { etagMap: new Map() };
    } else if (res.status === 403) {
      // RFC 4918 allows servers to refuse infinite-depth PROPFIND (Apache
      // mod_dav, webdav-server, ...; Nextcloud permits it). Fall back to a
      // breadth-first walk with Depth: 1 — same listing, one request per
      // collection.
      responses = await this.listByDepthOne();
    } else {
      throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
    }

    const etagMap = new Map<string, string>();
    // Empty-folder sync (2026-07-17): collections seen in the listing are
    // reported so the worker can create locally missing (possibly empty)
    // folders. Internal collections (.plainva, .git, …) stay out.
    const folders: string[] = [];
    for (const resp of responses) {
      if (!resp.href) continue;
      if (resp.isCollection) {
        const rel = this.relativeHref(resp.href).replace(/\/+$/, "");
        if (
          rel &&
          !rel.includes(".CONFLICT") &&
          !rel.split("/").some((seg) => WebDavSyncTarget.SKIPPED_COLLECTIONS.has(seg))
        ) {
          folders.push(rel);
        }
        continue;
      }
      if (resp.etag === undefined) continue;
      const href = this.relativeHref(resp.href);
      if (!href.includes(".CONFLICT")) {
        etagMap.set(href, resp.etag.replace(/"/g, ""));
      }
    }

    console.log(`[WebDAV] PROPFIND ${this.creds.url} -> ${etagMap.size} file(s), ${folders.length} folder(s)`);
    return { etagMap, folders };
  }

  // Real XML parsing instead of the former regex scan: namespace prefixes
  // (d:/D:/oc:), CDATA sections, XML entities (&amp; in file names!) and
  // multi-line <response> blocks are all server-dependent. A missed entry
  // here would feed the worker's "mirror remote deletions" path — the one
  // place where a parsing bug could turn into a local delete.
  private parseListing(xml: string): WebDavResponse[] {
    try {
      return parseMultistatus(xml);
    } catch (err) {
      throw new Error(`WebDAV PROPFIND returned unparseable XML: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  /**
   * Vault-relative path (no leading slash) for a multistatus href.
   *
   * Both sides are compared DECODED (issue #78). The old code decoded the href
   * but compared it against the still-encoded pathname of the configured URL,
   * so any vault whose own path carried a space or an umlaut failed the prefix
   * test — and a failed test silently returned the server's full path as if it
   * were vault-relative. The worker then created `<vault>/users/x/school/term1/…`
   * locally, pushed it back, and grew one level deeper on every cycle.
   *
   * A href that genuinely sits outside the vault is an error now. Skipping it
   * instead would feed the worker a listing missing those files, and "missing
   * from the remote listing" is what drives the mirror-deletions path — the one
   * failure worse than an aborted sync.
   */
  private relativeHref(rawHref: string): string {
    let href = rawHref;
    // RFC 4918 allows absolute URIs in <href> (webdav-server does this;
    // Nextcloud sends paths) — reduce to the path part first.
    if (/^https?:\/\//i.test(href)) {
      try {
        href = new URL(href).pathname;
      } catch {
        /* keep the raw value */
      }
    }
    const path = decodeDavPath(href);
    const base = decodeDavPath(this.basePath);
    // The collection itself comes back with or without the trailing slash.
    if (path === base || `${path}/` === base) return "";
    if (!path.startsWith(base)) {
      throw new Error(
        `WebDAV listing returned "${rawHref}", which is not below the configured vault path "${base}". ` +
        `Refusing to treat it as a vault-relative path — that would copy the server's folder structure ` +
        `into the vault (issue #78). A redirect to a different base path is the usual cause; check the URL.`
      );
    }
    return path.substring(base.length).replace(/^\/+/, "");
  }

  /**
   * Path the hrefs are resolved against. Normally the configured URL, but a
   * server that redirects (a bare host to `/remote.php/dav/files/<user>/`, say)
   * answers under a different base than the one that was typed — `fetch`
   * follows the redirect, the hrefs carry the new prefix, and every entry would
   * otherwise fail the check above. `pull` records the effective URL of the
   * listing response; before the first one, and for fetch mocks that carry no
   * `url`, this falls back to the configured value.
   */
  private get basePath(): string {
    return this.effectiveBasePath ?? new URL(this.creds.url).pathname;
  }

  private effectiveBasePath: string | undefined;

  /** Remembers where the listing actually came from (see `basePath`). */
  private rememberEffectiveBase(res: Response): void {
    if (typeof res.url !== "string" || !res.url) return;
    try {
      const pathname = new URL(res.url).pathname;
      this.effectiveBasePath = pathname.endsWith("/") ? pathname : `${pathname}/`;
    } catch {
      /* leave the configured path in place */
    }
  }

  /** Device-local folders never worth walking (the worker skips their files anyway). */
  private static readonly SKIPPED_COLLECTIONS = new Set([".plainva", ".git", ".trash", ".obsidian", "node_modules"]);

  private async listByDepthOne(): Promise<WebDavResponse[]> {
    const out: WebDavResponse[] = [];
    const queue: string[] = [""];
    while (queue.length > 0) {
      const rel = queue.shift()!;
      const url = rel ? this.urlForPath(rel) : this.creds.url;
      const res = await this.request("PROPFIND", url, {
        headers: {
          ...this.headers,
          "Depth": "1"
        }
      });
      if (!res.ok) {
        if (res.status === 404) continue;
        throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
      }
      for (const resp of this.parseListing(await res.text())) {
        if (!resp.href) continue;
        if (!resp.isCollection) {
          out.push(resp);
          continue;
        }
        // A Depth: 1 answer lists the collection itself first — only true
        // children go back into the queue (and into the result, so pull()
        // reports them for the empty-folder sync, 2026-07-17).
        const childRel = this.relativeHref(resp.href).replace(/\/+$/, "");
        if (!childRel || childRel === rel) continue;
        const name = childRel.split("/").pop() ?? childRel;
        if (WebDavSyncTarget.SKIPPED_COLLECTIONS.has(name)) continue;
        out.push(resp);
        queue.push(childRel);
      }
    }
    return out;
  }

  public async download(filePath: string): Promise<Uint8Array | null> {
    if (filePath.includes(".CONFLICT")) return null;

    const url = this.urlForPath(filePath);
    const res = await this.request("GET", url, {
      headers: this.headers
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`WebDAV GET failed: ${res.status} ${res.statusText}`);

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
