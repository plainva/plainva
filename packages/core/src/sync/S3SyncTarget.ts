import { ISyncTarget, SyncOperation, PushResult, PullResult } from "./ISyncTarget.js";
import type { FetchFn } from "./WebDavSyncTarget.js";
import { mimeTypeForPath } from "./fileType.js";
import { signS3Request, sha256Hex, encodeS3Key, rfc3986Encode } from "./sigv4.js";

/**
 * Credentials/config for an S3-compatible object store (AWS S3, Cloudflare R2,
 * Backblaze B2, MinIO, Wasabi, Hetzner, …). Key-based — no OAuth, no app review.
 */
export interface S3Credentials {
  /** Base endpoint, e.g. "https://s3.eu-central-1.amazonaws.com", "https://<acct>.r2.cloudflarestorage.com", "http://127.0.0.1:9000". */
  endpoint: string;
  /** SigV4 region; "us-east-1" works for most non-AWS stores, R2 uses "auto". */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional key prefix (a "subfolder" inside the bucket) the vault lives under. */
  prefix?: string;
  /**
   * true (default): path-style URLs (endpoint/bucket/key) — works for MinIO, R2 and
   * most compatibles. false: virtual-hosted style (bucket.endpoint-host/key).
   */
  forcePathStyle?: boolean;
}

const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Minimal XML entity decoder for S3 listing payloads (keys are XML-escaped, not URL-encoded). */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * S3-compatible implementation of {@link ISyncTarget} (sync-provider plan 2026-07-04,
 * P2). Path-keyed like WebDAV: `pull()` is always a full ListObjectsV2 sweep (the
 * worker's model), `ETag` is the change marker (single-part PUTs keep it
 * content-derived), and there is no cursor mode.
 *
 * Object stores have no real folders, so the folder cases are handled key-wise:
 * a rename/delete of a path that has no exact object sweeps all keys under
 * `<path>/` (copy+delete per key for renames). Zero-byte "folder marker" keys
 * (ending in "/") are skipped in listings.
 *
 * NATIVE VERIFICATION: request shapes are unit-tested against an injected fake
 * fetch; the roundtrip against a real bucket (R2/MinIO/AWS) is maintainer-verified
 * (M-C in the plan), matching the Drive adapter's verification model.
 */
export class S3SyncTarget implements ISyncTarget {
  private fetchFn: FetchFn;
  private readonly endpointUrl: URL;
  private readonly pathStyle: boolean;
  private readonly prefix: string;

  constructor(
    private creds: S3Credentials,
    fetchFn?: FetchFn,
    private readonly timeoutMs: number = 30000,
    private readonly nowFn: () => Date = () => new Date()
  ) {
    this.fetchFn =
      fetchFn ||
      (typeof fetch !== "undefined"
        ? fetch
        : ((() => {
            throw new Error("No fetch available");
          }) as any));
    this.endpointUrl = new URL(creds.endpoint);
    this.pathStyle = creds.forcePathStyle !== false;
    this.prefix = (creds.prefix ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  /** Host header value (includes a non-default port, e.g. MinIO on :9000). */
  private get host(): string {
    return this.pathStyle ? this.endpointUrl.host : `${this.creds.bucket}.${this.endpointUrl.host}`;
  }

  private get origin(): string {
    return `${this.endpointUrl.protocol}//${this.host}`;
  }

  /** Bucket-relative canonical URI for an (already encoded) key path; "" = bucket root. */
  private canonicalUriFor(encodedKey: string): string {
    const keyPart = encodedKey ? `/${encodedKey}` : "";
    return this.pathStyle ? `/${this.creds.bucket}${keyPart || "/"}` : keyPart || "/";
  }

  private keyFor(filePath: string): string {
    let normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  private relPathFor(key: string): string | null {
    if (!this.prefix) return key;
    const want = `${this.prefix}/`;
    return key.startsWith(want) ? key.substring(want.length) : null;
  }

  /** Builds the request URL for a canonical URI + sorted query (same string is signed). */
  private urlFor(canonicalUri: string, queryParams?: Record<string, string>): string {
    // Same encoding as the signature's canonical query string (rfc3986, "/" -> %2F),
    // so the URL on the wire and the signed form can never diverge.
    const qs = queryParams
      ? Object.entries(queryParams)
          .map(([k, v]) => [rfc3986Encode(k), rfc3986Encode(v)] as const)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${k}=${v}`)
          .join("&")
      : "";
    return `${this.origin}${canonicalUri}${qs ? `?${qs}` : ""}`;
  }

  private async request(method: string, url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, method, signal: controller.signal });
    } catch (err) {
      const reason =
        (err as any)?.name === "AbortError"
          ? `timeout after ${this.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`[S3] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Signed request. `signedHeaders` become part of the signature (all x-amz-* headers
   * must be signed); `unsignedHeaders` (e.g. Content-Type) are sent but not signed, so
   * an HTTP layer that rewrites them cannot break the signature.
   */
  private async signedFetch(
    method: string,
    encodedKey: string,
    opts: {
      queryParams?: Record<string, string>;
      signedHeaders?: Record<string, string>;
      unsignedHeaders?: Record<string, string>;
      body?: Uint8Array;
    } = {}
  ): Promise<Response> {
    const canonicalUri = this.canonicalUriFor(encodedKey);
    const payloadHash = opts.body ? await sha256Hex(opts.body) : EMPTY_HASH;
    const { headers } = await signS3Request({
      method,
      host: this.host,
      canonicalUri,
      queryParams: opts.queryParams,
      headers: opts.signedHeaders,
      payloadHash,
      credentials: {
        accessKeyId: this.creds.accessKeyId,
        secretAccessKey: this.creds.secretAccessKey,
        region: this.creds.region,
      },
      now: this.nowFn(),
    });
    return this.request(method, this.urlFor(canonicalUri, opts.queryParams), {
      headers: { ...headers, ...(opts.unsignedHeaders ?? {}) },
      body: opts.body ? ((opts.body as unknown) as BodyInit) : undefined,
    });
  }

  /** One ListObjectsV2 page for a raw (un-encoded) key prefix. */
  private async listPage(
    rawPrefix: string,
    continuationToken?: string
  ): Promise<{ keys: { key: string; etag: string }[]; nextToken?: string }> {
    const queryParams: Record<string, string> = { "list-type": "2" };
    if (rawPrefix) queryParams["prefix"] = rawPrefix;
    if (continuationToken) queryParams["continuation-token"] = continuationToken;

    const res = await this.signedFetch("GET", "", { queryParams });
    if (!res.ok) {
      throw new Error(`S3 list failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    const keys: { key: string; etag: string }[] = [];
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match;
    while ((match = contentsRegex.exec(xml)) !== null) {
      const block = match[1];
      const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(block);
      if (!keyMatch) continue;
      const etagMatch = /<ETag>([\s\S]*?)<\/ETag>/.exec(block);
      const lastModifiedMatch = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block);
      const key = decodeXmlEntities(keyMatch[1]);
      // Some stores omit ETag in listings; fall back to LastModified as change marker.
      const etag = decodeXmlEntities(etagMatch?.[1] ?? lastModifiedMatch?.[1] ?? "").replace(/"/g, "");
      keys.push({ key, etag });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
    return { keys, nextToken: truncated ? decodeXmlEntities(tokenMatch?.[1] ?? "") || undefined : undefined };
  }

  /** All keys under a raw prefix (paginated). */
  private async listAll(rawPrefix: string): Promise<{ key: string; etag: string }[]> {
    const all: { key: string; etag: string }[] = [];
    let token: string | undefined;
    do {
      const page = await this.listPage(rawPrefix, token);
      all.push(...page.keys);
      token = page.nextToken;
    } while (token);
    return all;
  }

  /**
   * Child folder names one level below `path` (bucket-root-relative, "" = bucket
   * root) via delimiter listing — CommonPrefixes need no folder-marker objects.
   * Picker support (2026-07-06): deliberately ignores `creds.prefix`, because the
   * picker's job is to CHOOSE that prefix.
   */
  public async listFolders(path: string): Promise<string[]> {
    const clean = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const rawPrefix = clean ? `${clean}/` : "";
    const names: string[] = [];
    let token: string | undefined;
    do {
      const queryParams: Record<string, string> = { "list-type": "2", delimiter: "/" };
      if (rawPrefix) queryParams["prefix"] = rawPrefix;
      if (token) queryParams["continuation-token"] = token;
      const res = await this.signedFetch("GET", "", { queryParams });
      if (!res.ok) throw new Error(`S3 list failed: ${res.status} ${res.statusText}`);
      const xml = await res.text();
      const cpRegex = /<CommonPrefixes>[\s\S]*?<Prefix>([\s\S]*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g;
      let m;
      while ((m = cpRegex.exec(xml)) !== null) {
        const name = decodeXmlEntities(m[1]).substring(rawPrefix.length).replace(/\/$/, "");
        if (name) names.push(name);
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
      token = truncated ? decodeXmlEntities(tokenMatch?.[1] ?? "") || undefined : undefined;
    } while (token);
    return names.sort((a, b) => a.localeCompare(b));
  }

  // S3 has no incremental change token in the worker's model: always a full listing
  // (the optional `cursor` from the ISyncTarget contract is ignored, like WebDAV).
  public async pull(_cursor?: string): Promise<PullResult> {
    const rawPrefix = this.prefix ? `${this.prefix}/` : "";
    const etagMap = new Map<string, string>();
    for (const { key, etag } of await this.listAll(rawPrefix)) {
      if (key.endsWith("/")) continue; // zero-byte folder marker objects
      const rel = this.relPathFor(key);
      if (!rel || rel.includes(".CONFLICT")) continue;
      etagMap.set(rel, etag);
    }
    console.log(`[S3] list ${this.creds.bucket}/${rawPrefix} -> ${etagMap.size} file(s)`);
    return { etagMap };
  }

  public async download(filePath: string): Promise<Uint8Array | null> {
    if (filePath.includes(".CONFLICT")) return null;
    const res = await this.signedFetch("GET", encodeS3Key(this.keyFor(filePath)));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET failed: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  private async headExists(encodedKey: string): Promise<boolean> {
    const res = await this.signedFetch("HEAD", encodedKey);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`S3 HEAD failed: ${res.status} ${res.statusText}`);
    return true;
  }

  /** Copies one object (encoded keys); returns the new ETag when the store reports it. */
  private async copyObject(encodedFromKey: string, encodedToKey: string): Promise<string | undefined> {
    const res = await this.signedFetch("PUT", encodedToKey, {
      signedHeaders: {
        "x-amz-copy-source": `/${this.creds.bucket}/${encodedFromKey}`,
      },
    });
    if (!res.ok) throw new Error(`S3 copy failed: ${res.status} ${res.statusText}`);
    // S3 quirk: a copy can return 200 with an <Error> body (e.g. timeout mid-copy).
    const xml = await res.text();
    if (/<Error>/.test(xml)) throw new Error(`S3 copy failed: error body on 200`);
    const etagMatch = /<ETag>([\s\S]*?)<\/ETag>/.exec(xml);
    return etagMatch ? decodeXmlEntities(etagMatch[1]).replace(/"/g, "") : undefined;
  }

  private async deleteObject(encodedKey: string): Promise<void> {
    const res = await this.signedFetch("DELETE", encodedKey);
    // S3 DELETE is idempotent (204 even for missing keys); tolerate 404 for dialects.
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE failed: ${res.status} ${res.statusText}`);
    }
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.file_path.includes(".CONFLICT")) return;

    if (op.operation === "write") {
      const content = op.content || new Uint8Array();
      const res = await this.signedFetch("PUT", encodeS3Key(this.keyFor(op.file_path)), {
        body: content,
        unsignedHeaders: { "Content-Type": mimeTypeForPath(op.file_path) },
      });
      if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${res.statusText}`);
      const etag = res.headers.get("ETag") || undefined;
      return { etag: etag?.replace(/"/g, "") };
    }

    if (op.operation === "delete") {
      const key = this.keyFor(op.file_path);
      // Folder case first: sweep every key under "<path>/" (a folder has no exact
      // object of its own — and S3's DELETE returns 204 even for missing keys, so
      // the sweep is the only reliable signal).
      const children = await this.listAll(`${key}/`);
      for (const child of children) {
        await this.deleteObject(encodeS3Key(child.key));
      }
      await this.deleteObject(encodeS3Key(key));
      return;
    }

    if (op.operation === "rename" && op.new_path) {
      if (op.new_path.includes(".CONFLICT")) return;
      const fromKey = this.keyFor(op.file_path);
      const toKey = this.keyFor(op.new_path);

      if (await this.headExists(encodeS3Key(fromKey))) {
        // Single file: copy + delete.
        const etag = await this.copyObject(encodeS3Key(fromKey), encodeS3Key(toKey));
        await this.deleteObject(encodeS3Key(fromKey));
        return etag ? { etag } : undefined;
      }

      // Folder: copy+delete every key under the old prefix.
      const children = await this.listAll(`${fromKey}/`);
      for (const child of children) {
        const childTo = `${toKey}/${child.key.substring(fromKey.length + 1)}`;
        await this.copyObject(encodeS3Key(child.key), encodeS3Key(childTo));
        await this.deleteObject(encodeS3Key(child.key));
      }
      return;
    }
  }
}
