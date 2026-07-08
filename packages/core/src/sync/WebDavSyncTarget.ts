import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ISyncTarget, SyncOperation, PushResult, PullResult } from "./ISyncTarget.js";

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

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class WebDavSyncTarget implements ISyncTarget {
  private fetchFn: FetchFn;

  constructor(
    private creds: WebDavCredentials,
    fetchFn?: FetchFn,
    private readonly timeoutMs: number = 30000
  ) {
    if (!this.creds.url.endsWith("/")) {
      this.creds.url += "/";
    }
    this.fetchFn = fetchFn || (typeof fetch !== "undefined" ? fetch : (() => { throw new Error("No fetch available"); }) as any);
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, method, signal: controller.signal });
    } catch (err) {
      const reason = (err as any)?.name === "AbortError"
        ? `timeout after ${this.timeoutMs}ms`
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
    return this.creds.url + encodeURI(normalized);
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.file_path.includes(".CONFLICT")) {
      return;
    }

    if (op.operation === "write") {
      const url = this.urlForPath(op.file_path);

      const res = await this.request("PUT", url, {
        headers: this.headers,
        body: (op.content || new Uint8Array()) as any as BodyInit
      });

      if (!res.ok) {
        if (res.status === 409) {
            await this.ensureDir(op.file_path);
            const retryRes = await this.request("PUT", url, {
                headers: this.headers,
                body: (op.content || new Uint8Array()) as any as BodyInit
            });
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

    if (!res.ok) {
        if (res.status === 404) {
            return { etagMap: new Map() };
        }
        throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
    }

    const xml = await res.text();
    const etagMap = new Map<string, string>();

    // Real XML parsing instead of the former regex scan: namespace prefixes
    // (d:/D:/oc:), CDATA sections, XML entities (&amp; in file names!) and
    // multi-line <response> blocks are all server-dependent. A missed entry
    // here would feed the worker's "mirror remote deletions" path — the one
    // place where a parsing bug could turn into a local delete.
    let responses: WebDavResponse[];
    try {
      responses = parseMultistatus(xml);
    } catch (err) {
      throw new Error(`WebDAV PROPFIND returned unparseable XML: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }

    const basePath = new URL(this.creds.url).pathname;
    for (const resp of responses) {
      if (resp.isCollection || !resp.href || resp.etag === undefined) continue;

      let href = decodeURI(resp.href);
      if (href.startsWith(basePath)) {
        href = href.substring(basePath.length);
      }
      if (href.startsWith("/")) href = href.substring(1);

      if (!href.includes(".CONFLICT")) {
        etagMap.set(href, resp.etag.replace(/"/g, ""));
      }
    }

    console.log(`[WebDAV] PROPFIND ${this.creds.url} -> ${etagMap.size} file(s)`);
    return { etagMap };
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
