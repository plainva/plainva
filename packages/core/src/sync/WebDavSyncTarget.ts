import { syncHttpError, SyncRootMissingError } from "./errorKind.js";
import { fetchWithTransferTimeout, discardResponse } from "./transferTimeout.js";
import { parseDavListing } from "./xmlListing.js";
import { ISyncTarget, RemoteStat, SyncOperation, PushResult, PullResult, SyncUploader, RemoteProbe, RemotePresence, RemoteChangedError, type ExpectedRemote } from "./ISyncTarget.js";
import { ConditionalWrites, foldsToSameName } from "./conditionalWrite.js";
import { fetchWithRetry } from "./httpRetry.js";
import { streamUpload } from "./streamUpload.js";
import { trimChars, trimEndChars } from "../textScan.js";
import { folderSegments } from "./folderIdentity.js";
import { FOLDER_TAGS_REFUTED_KEY, FolderTagLedger, type FolderTagListing } from "./webdavFolderTags.js";
import type { SyncMetaStore } from "./ISyncTarget.js";

/**
 * Canonical identity of a WebDAV files root (fourth review of plan
 * "Verbinden", finding 1): scheme and host in lower case, a default port
 * dropped, no trailing slash, segments decoded and NFC. Nextcloud and
 * ownCloud serve the same files under `/remote.php/webdav/` and
 * `/remote.php/dav/files/<user>/`; both become one form, and the owner goes
 * into `account` (lower case: those servers sign in without regard to case,
 * and two spellings of one user are never two targets). Undefined when the
 * address cannot be read - then nothing can be compared.
 */
export function webDavFolderIdentity(url: string, user?: string): { root: string; account?: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  const segments = folderSegments(parsed.pathname).map((segment) => {
    try {
      return decodeURIComponent(segment).normalize("NFC");
    } catch {
      return segment.normalize("NFC");
    }
  });
  let owner: string | undefined;
  const at = segments.findIndex((segment) => segment.toLowerCase() === "remote.php");
  if (at >= 0) {
    const next = segments[at + 1]?.toLowerCase();
    if (next === "webdav") {
      segments.splice(at, 2, "remote.php", "files");
    } else if (next === "dav" && segments[at + 2]?.toLowerCase() === "files" && segments[at + 3]) {
      owner = segments[at + 3].toLowerCase();
      segments.splice(at, 4, "remote.php", "files");
    }
  }
  const login = user?.trim().toLowerCase();
  const account = login || owner;
  const root = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}/${segments.join("/")}`;
  return account ? { root, account } : { root };
}

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
  /** getcontentlength, when the server reports one (C31: stat without a download). */
  size?: number;
  /** getlastmodified as epoch ms, when the server reports one. */
  modifiedAt?: number;
  /**
   * How the entry answered each property the slim listing asks for
   * (`SLIM_LISTING_PROPS`): "ok" in a 2xx propstat (or one without a status),
   * "absent" in another propstat (the server says it has none), and missing
   * where the entry does not name it at all.
   */
  answered: Partial<Record<SlimListingProp, "ok" | "absent">>;
  /** `oc:permissions` from a 2xx propstat (Nextcloud, ownCloud): "M" marks a mount. */
  permissions?: string;
}

/**
 * The properties a full listing needs, and nothing else: `pull` reads the
 * entity tag and the time of each file and which entries are folders. Asking
 * for them by name (`<d:prop>`) instead of everything (`allprop`, an empty
 * body) keeps out what a server adds besides — content types, quota, ids,
 * permissions, sizes of folders — which on a large vault is most of every
 * listing (plan L7a).
 */
export const SLIM_LISTING_PROPS = ["resourcetype", "getetag", "getlastmodified"] as const;
export type SlimListingProp = (typeof SLIM_LISTING_PROPS)[number];

export const SLIM_LISTING_BODY =
  `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>${SLIM_LISTING_PROPS.map((p) => `<d:${p}/>`).join("")}</d:prop></d:propfind>`;

/**
 * The same, also asking for `oc:permissions`, whose "M" marks a mount
 * (external storage, an incoming share): asked only of a server whose vault
 * folder has a tag, since only such a server can earn the shortcut
 * (webdavFolderTags.ts). A server without the property answers it in a 404
 * propstat, or not at all; neither stops the listing.
 */
export const SLIM_LISTING_BODY_WITH_MOUNTS =
  `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>${SLIM_LISTING_PROPS.map((p) => `<d:${p}/>`).join("")}<oc:permissions/></d:prop></d:propfind>`;

/** A probe of the vault folder's tag alone. */
const ROOT_TAG_PROBE_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`;

/** The cursor the target hands the worker while the vault folder's tag is trusted (`getStartCursor`). */
export const ROOT_TAG_CURSOR = "webdav-root-tag";

/** A slim listing the server refused or answered in part: the listing is asked again with `allprop`. */
const SLIM_INCOMPLETE = Symbol("slim listing incomplete");

/**
 * Whether a slim listing says all that `allprop` would for `pull`: every
 * entry names its resource type in a 2xx propstat, and every file its entity
 * tag there and its time either way (a time the server says it has not is
 * what `allprop` would leave out too; a folder's tag and time are not read).
 * An entity tag only in a failed propstat, or a property left out without a
 * word, is a half answer: a file without a tag drops out of the listing, and
 * a file missing from a listing is what mirrors a deletion, so such an answer
 * is never used.
 */
export function slimAnswerComplete(responses: readonly WebDavResponse[]): boolean {
  return responses.every((r) =>
    r.answered.resourcetype === "ok" &&
    (r.isCollection || (r.answered.getetag === "ok" && r.answered.getlastmodified !== undefined)),
  );
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
  const multistatus = parseDavListing(xml);
  const rawResponses: any[] = Array.isArray(multistatus.response) ? multistatus.response : [];

  const entries: WebDavResponse[] = [];
  for (const resp of rawResponses) {
    const href = typeof resp?.href === "string" ? resp.href : undefined;
    let etag: string | undefined;
    let isCollection = false;
    let size: number | undefined;
    let modifiedAt: number | undefined;
    let okEtag: string | undefined;
    let permissions: string | undefined;
    const answered: WebDavResponse["answered"] = {};
    const propstats: any[] = Array.isArray(resp?.propstat) ? resp.propstat : [];
    for (const ps of propstats) {
      const prop = ps?.prop;
      if (!prop) continue;
      const code = typeof ps?.status === "string" ? /^\s*HTTP\/\S+\s+(\d{3})/i.exec(ps.status)?.[1] : undefined;
      const ok = code === undefined || code.startsWith("2");
      for (const name of SLIM_LISTING_PROPS) {
        if (!(name in prop)) continue;
        if (ok) answered[name] = "ok";
        else if (answered[name] === undefined) answered[name] = "absent";
      }
      if (ok && okEtag === undefined && typeof prop.getetag === "string") okEtag = prop.getetag;
      if (ok && permissions === undefined && typeof prop.permissions === "string") permissions = prop.permissions;
      if (etag === undefined && typeof prop.getetag === "string") etag = prop.getetag;
      if (size === undefined && typeof prop.getcontentlength === "string" && /^\d+$/.test(prop.getcontentlength)) {
        size = Number(prop.getcontentlength);
      }
      if (modifiedAt === undefined && typeof prop.getlastmodified === "string") {
        const t = Date.parse(prop.getlastmodified);
        if (!Number.isNaN(t)) modifiedAt = t;
      }
      // <collection/> parses to an empty string; presence of the key is the signal.
      if (prop.resourcetype && typeof prop.resourcetype === "object" && "collection" in prop.resourcetype) {
        isCollection = true;
      }
    }
    // A tag in a 2xx propstat wins over one in a failed propstat (often an
    // empty `<d:getetag/>` the server says it does not have).
    if (okEtag !== undefined) etag = okEtag;
    entries.push({ href, etag, isCollection, answered, ...(permissions === undefined ? {} : { permissions }), ...(size === undefined ? {} : { size }), ...(modifiedAt === undefined ? {} : { modifiedAt }) });
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
    try {
      return await fetchWithTransferTimeout(this.fetchFn, url, { ...init, method }, this.timeoutMs);
    } catch (err) {
      const reason = err instanceof Error ? (err.message || String(err)) : String(err);
      console.error(`[WebDAV] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
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
  private async put(op: SyncOperation, url: string, condition: Record<string, string> = {}): Promise<Response> {
    // When the file was edited, for the servers that keep it (Nextcloud,
    // ownCloud: `X-OC-Mtime`, whole seconds): the next device to download the
    // file lists it by that time, not by this upload's. Other servers ignore
    // the header and keep the upload's time.
    const edited: Record<string, string> = op.localModifiedAt !== undefined && Number.isFinite(op.localModifiedAt) && op.localModifiedAt > 0
      ? { "X-OC-Mtime": String(Math.floor(op.localModifiedAt / 1000)) }
      : {};
    if (op.contentRef && this.uploader) {
      return streamUpload(this.uploader, {
        ref: op.contentRef,
        url,
        method: "PUT",
        headers: { ...this.headers, ...edited, ...condition },
      });
    }
    return this.request("PUT", url, {
      headers: { ...this.headers, ...edited, ...condition },
      body: (op.content || new Uint8Array()) as any as BodyInit,
    });
  }

  /** Whether the server evaluates the preconditions below; see `ConditionalWrites`. */
  private readonly conditions = new ConditionalWrites("WebDAV");

  /**
   * The precondition for an upload that expects `expected` on the server
   * (Sammelplan § 3.103): the entity tag of its merge base, compared strongly
   * as `If-Match` demands — or "no file" (`If-None-Match: *`). A weak tag
   * (`W/…`) never matches strongly, so it gets none; the upload then asks
   * right before it writes.
   */
  private static conditionFor(expected: ExpectedRemote): Record<string, string> | null {
    if (expected.kind === "absent") return { "If-None-Match": "*" };
    if (!expected.marker || expected.marker.startsWith("W/")) return null;
    return { "If-Match": `"${expected.marker}"` };
  }

  /**
   * One PUT, and once more after creating a missing parent. RFC 4918 answers a
   * PUT into a missing collection with 409, but real servers (some
   * Nextcloud/Apache setups) answer 404 instead — seen on the maintainer's
   * Nextcloud during the mobile roundtrip. A failing PUT path can only mean a
   * missing parent: create it and retry once.
   */
  private async putCreatingParents(op: SyncOperation, url: string, condition: Record<string, string>): Promise<Response> {
    const res = await this.put(op, url, condition);
    if (res.status !== 409 && res.status !== 404) return res;
    discardResponse(res);
    await this.ensureDir(op.file_path);
    return this.put(op, url, condition);
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    // Whatever this device writes moves the folder tags: the next cycle
    // lists in full rather than take the new tag as known.
    this.wroteSinceListing = true;
    if (op.file_path.includes(".CONFLICT")) {
      return;
    }

    if (op.operation === "write") {
      const url = this.urlForPath(op.file_path);
      const expected = op.expectedRemote;
      const stat = () => this.stat(op.file_path);
      const condition = expected && this.conditions.conditionsHold ? WebDavSyncTarget.conditionFor(expected) : null;
      if (expected && !condition) await this.conditions.askFirst(op.file_path, expected, stat);

      let res = await this.putCreatingParents(op, url, condition ?? {});
      if (expected && condition && (res.status === 412 || res.status === 501)) {
        // 412: the server holds another version — or did not evaluate the
        // condition as meant; 501: it does not implement it. Only the first
        // is a reason not to write (`ConditionalWrites`).
        discardResponse(res);
        if (res.status === 412) await this.conditions.refused(op.file_path, expected, stat, "412");
        else {
          this.conditions.notSupported("501");
          await this.conditions.askFirst(op.file_path, expected, stat);
        }
        res = await this.putCreatingParents(op, url, {});
      }
      if (!res.ok) throw syncHttpError(`WebDAV PUT failed: ${res.status} ${res.statusText}`, res);

      const etag = res.headers.get("ETag") || undefined;
      return { etag: etag?.replace(/"/g, "") };
    } else if (op.operation === "delete") {
      const url = this.urlForPath(op.file_path);
      // A deletion removes only the version this device saw last
      // (Fehlerliste 0.9.0 A1): `If-Match` on it, or a question right before
      // where the tag is weak or the server ignores the condition.
      const expected = op.expectedRemote?.kind === "marker" ? op.expectedRemote : undefined;
      // A DELETE of a collection takes everything below it. A folder goes
      // only while the server holds no file in it (F44): another device may
      // have put a note there since this one last looked, and whatever is
      // there decides on its own, file by file.
      if (!expected && await this.folderHoldsFiles(op.file_path)) throw new RemoteChangedError(op.file_path, "the folder holds files");
      const stat = () => this.stat(op.file_path);
      const condition = expected && this.conditions.conditionsHold ? WebDavSyncTarget.conditionFor(expected) : null;
      if (expected && !condition && !(await this.conditions.askBeforeDelete(op.file_path, expected, stat))) return;
      const remove = (headers: Record<string, string>) => this.request("DELETE", url, { headers: { ...this.headers, ...headers } });
      let res = await remove(condition ?? {});
      if (expected && condition && (res.status === 412 || res.status === 501)) {
        discardResponse(res);
        if (res.status === 412) {
          if (!(await this.conditions.refusedDelete(op.file_path, expected, stat, "412"))) return;
        } else {
          this.conditions.notSupported("501");
          if (!(await this.conditions.askBeforeDelete(op.file_path, expected, stat))) return;
        }
        res = await remove({});
      }
      if (!res.ok && res.status !== 404) {
        throw syncHttpError(`WebDAV DELETE failed: ${res.status} ${res.statusText}`, res);
      }
    } else if (op.operation === "rename" && op.new_path) {
      if (op.new_path.includes(".CONFLICT")) return;

      const url = this.urlForPath(op.file_path);
      const destUrl = this.urlForPath(op.new_path);
      // A move never replaces what lies at its destination (A1): another
      // device may have just created a file of that name. `Overwrite: F` makes
      // the server refuse (412) instead. Not for a change of letter case
      // only: on a server that folds case the destination IS the source.
      const caseOnly = foldsToSameName(op.file_path, op.new_path);
      const res = await this.request("MOVE", url, {
        headers: {
          ...this.headers,
          "Destination": destUrl,
          ...(caseOnly ? {} : { "Overwrite": "F" }),
        }
      });
      if (res.status === 404) return { renameSourceMissing: true };
      if (res.status === 412 && !caseOnly) {
        discardResponse(res);
        throw new RemoteChangedError(op.new_path, "412 on MOVE: the destination exists");
      }
      if (!res.ok && res.status !== 404) {
        throw syncHttpError(`WebDAV MOVE failed: ${res.status} ${res.statusText}`, res);
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
              throw syncHttpError(`WebDAV MKCOL failed: ${res.status} ${res.statusText}`, res);
          }
      }
  }

  /**
   * Child folder names one level below `path` ("" = the server base URL) —
   * picker support (2026-07-13, unified online-vault setup). One PROPFIND with
   * Depth: 1; a 404 (folder does not exist yet) is an empty level, not an error.
   */
  public async listFolders(path: string): Promise<string[]> {
    const rel = trimChars(path.replace(/\\/g, "/"), "/");
    const url = rel ? this.urlForPath(rel + "/") : this.creds.url;
    const res = await this.request("PROPFIND", url, {
      headers: { ...this.headers, "Depth": "1" }
    });
    // Only the top level is asked for the base URL itself, so only its answer
    // reveals a redirect without having to subtract `rel` again.
    if (!rel) this.rememberEffectiveBase(res);
    if (res.status === 404) return [];
    if (!res.ok) throw syncHttpError(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`, res);
    const names: string[] = [];
    for (const resp of this.parseListing(await res.text())) {
      if (!resp.href || !resp.isCollection) continue;
      // A Depth: 1 answer lists the collection itself first — skip it.
      const childRel = trimEndChars(this.relativeHref(resp.href), "/");
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
    this.wroteSinceListing = true;
    const rel = trimChars(path.replace(/\\/g, "/"), "/");
    if (!rel) return;
    let currentPath = "";
    for (const part of rel.split("/").filter((p) => p.length > 0)) {
      currentPath += part + "/";
      const res = await this.request("MKCOL", this.urlForPath(currentPath), {
        headers: this.headers
      });
      if (!res.ok && res.status !== 405) {
        throw syncHttpError(`WebDAV MKCOL failed: ${res.status} ${res.statusText}`, res);
      }
    }
  }

  /**
   * Creates the folder chain for a VAULT-RELATIVE `path` (issue #112). On
   * WebDAV the configured URL IS the vault folder, so both coordinate systems
   * coincide and this is `createFolder`; it exists so the engine never has to
   * know which provider it talks to.
   */
  public async createVaultFolder(path: string): Promise<void> {
    await this.createFolder(path);
  }

  /**
   * Names directly inside a vault folder, as the server stores them (ADR
   * 0016): one PROPFIND with Depth: 1, null for a folder that is not there.
   * Asked only for a folder the cycle's listing did not show, before a write
   * next to a name that could be stored in the other normalization form.
   */
  public async listVaultFolder(path: string): Promise<string[] | null> {
    const rel = trimChars(path.replace(/\\/g, "/"), "/");
    const url = rel ? this.urlForPath(rel + "/") : this.creds.url;
    const res = await this.request("PROPFIND", url, {
      headers: { ...this.headers, "Depth": "1" }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw syncHttpError(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`, res);
    const names: string[] = [];
    for (const resp of this.parseListing(await res.text())) {
      if (!resp.href) continue;
      const childRel = trimEndChars(this.relativeHref(resp.href), "/");
      if (!childRel || childRel === rel) continue;
      names.push(childRel.split("/").pop() ?? childRel);
    }
    return names;
  }

  /**
   * False once the vault has synced files before: a folder that is gone is then
   * an error with a way out, never an empty remote (finding 2026-09-20).
   */
  public allowRootCreation = true;

  /**
   * Whether full listings ask for `SLIM_LISTING_PROPS` alone. Cleared, for as
   * long as this target lives, by the first slim listing the server refuses
   * or answers in part; every listing from then on asks `allprop`, as before.
   */
  public slimListing = true;

  // WebDAV has no incremental change token: the `cursor` argument from the
  // ISyncTarget contract is intentionally ignored and a full PROPFIND listing is
  // always returned. Deletions are derived by the worker from the listing diff.
  public async pull(cursor?: string): Promise<PullResult> {
    const probedTag = this.probedTag;
    this.probedTag = undefined;
    if (cursor !== undefined) {
      // A cursor pull (plan L7b) lists nothing: `shouldListFully` has just
      // asked the vault folder's tag and found it where the last full listing
      // left it. Nothing is downloaded and nothing deleted on its word.
      if (cursor !== ROOT_TAG_CURSOR || !this.shortcutUsable()) return { etagMap: new Map(), needsFullListing: true };
      return { etagMap: new Map(), nextCursor: cursor };
    }
    this.wroteSinceListing = false;
    this.observed = undefined;
    const result = await this.listFully();
    if (this.observed) {
      const listing = this.observed;
      this.observed = undefined;
      if (this.folderTags.observe(listing, probedTag) === "contradiction") await this.storeContradiction();
    }
    return result;
  }

  /**
   * Plan L7b: cursor pulls ask the vault folder's tag alone, at most
   * `cursorPullsBetween` in a row and for at most `maxAgeMs` since the last
   * full listing; a foreign change the tag did not show arrives at most one
   * minute later than with a full listing every cycle.
   */
  public readonly fullListingCadence = { cursorPullsBetween: 3, maxAgeMs: 60_000 };

  private folderTags = new FolderTagLedger();
  private metaStore: SyncMetaStore | undefined;
  private refutationLoaded: Promise<void> | undefined;
  private wroteSinceListing = false;
  /** The vault folder's tag a probe saw in this cycle, for the full listing right after it. */
  private probedTag: string | undefined;
  /** The last accepted listing as the ledger compares it (set by `listVault`). */
  private observed: FolderTagListing | undefined;

  public useSyncMeta(store: SyncMetaStore): void {
    this.metaStore = store;
    this.refutationLoaded = undefined;
  }

  private get refutationKey(): string {
    let host = this.creds.url;
    try { host = new URL(this.creds.url).origin; } catch { /* keep the URL */ }
    return FOLDER_TAGS_REFUTED_KEY + host;
  }

  /** Reads, once, whether this host contradicted its folder tags before. */
  private loadRefutation(): Promise<void> {
    const store = this.metaStore;
    if (!store) return Promise.resolve();
    this.refutationLoaded ??= store.get(this.refutationKey).then(
      (value) => { if (value !== null && !this.folderTags.refuted) this.folderTags = new FolderTagLedger(true); },
      // A store that cannot be read: no shortcut for as long as this target lives.
      () => { this.metaStore = undefined; },
    );
    return this.refutationLoaded;
  }

  private async storeContradiction(): Promise<void> {
    console.warn("[WebDAV] the server's folder tags missed a change; listing in full on every cycle from now on");
    try {
      await this.metaStore?.set(this.refutationKey, new Date().toISOString());
    } catch (e) {
      console.warn("[WebDAV] could not keep that the folder tags missed a change", e);
    }
  }

  /** Whether a cycle may rest on the vault folder's tag (a store must hold any contradiction across restarts). */
  private shortcutUsable(): boolean {
    return this.metaStore !== undefined && this.refutationLoaded !== undefined && this.folderTags.trusted && !this.wroteSinceListing;
  }

  public async getStartCursor(): Promise<string> {
    await this.loadRefutation();
    // An empty cursor is none: the worker lists in full next cycle as well.
    return this.shortcutUsable() ? ROOT_TAG_CURSOR : "";
  }

  public async shouldListFully(): Promise<boolean> {
    this.probedTag = undefined;
    await this.loadRefutation();
    if (!this.shortcutUsable()) return true;
    const tag = await this.probeRootTag();
    this.probedTag = tag;
    return tag === undefined || tag !== this.folderTags.rootTag;
  }

  /** The vault folder's tag as the server lists it now; undefined for any answer but a plain one. */
  private async probeRootTag(): Promise<string | undefined> {
    const res = await this.request("PROPFIND", this.creds.url, {
      headers: { ...this.headers, "Depth": "0", "Content-Type": "application/xml; charset=utf-8" },
      body: ROOT_TAG_PROBE_BODY,
    });
    if (res.status !== 207) {
      discardResponse(res);
      return undefined;
    }
    // Answered from another place than the last listing: list in full.
    if (typeof res.url === "string" && res.url) {
      try {
        const pathname = new URL(res.url).pathname;
        if ((pathname.endsWith("/") ? pathname : `${pathname}/`) !== this.basePath) return undefined;
      } catch {
        return undefined;
      }
    }
    try {
      const entries = parseMultistatus(await res.text());
      const own = entries.filter((e) => e.href !== undefined && this.relativeHref(e.href) === "");
      if (own.length !== 1 || own[0]!.answered.getetag !== "ok") return undefined;
      return own[0]!.etag;
    } catch {
      return undefined;
    }
  }

  private async listFully(): Promise<PullResult> {
    const slim = this.slimListing ? await this.listVault(true) : SLIM_INCOMPLETE;
    if (slim !== SLIM_INCOMPLETE) return slim;
    // Asked again in the same pull, so the listing says what `allprop` says;
    // never a listing built from a half answer. An `allprop` listing that
    // fails as well fails as it always did, and the next pull asks by name
    // again (the server may just have been down).
    const full = await this.listVault(false);
    if (full === SLIM_INCOMPLETE) throw new Error("unreachable: an allprop listing is never incomplete");
    if (this.slimListing) {
      this.slimListing = false;
      console.warn("[WebDAV] the server refused or answered a listing by name in part; listing everything from now on");
    }
    return full;
  }

  private propfindInit(depth: string, slim: boolean): RequestInit {
    const body = this.folderTags.candidate && depth === "infinity" ? SLIM_LISTING_BODY_WITH_MOUNTS : SLIM_LISTING_BODY;
    return slim
      ? { headers: { ...this.headers, "Depth": depth, "Content-Type": "application/xml; charset=utf-8" }, body }
      : { headers: { ...this.headers, "Depth": depth } };
  }

  /** The slim listing's answer, or `SLIM_INCOMPLETE` where it cannot be used (`slimAnswerComplete`). */
  private parseSlim(xml: string): WebDavResponse[] | typeof SLIM_INCOMPLETE {
    let responses: WebDavResponse[];
    try {
      responses = parseMultistatus(xml);
    } catch {
      return SLIM_INCOMPLETE;
    }
    return slimAnswerComplete(responses) ? responses : SLIM_INCOMPLETE;
  }

  private async listVault(slim: boolean): Promise<PullResult | typeof SLIM_INCOMPLETE> {
    const init = this.propfindInit("infinity", slim);
    const res = await this.request("PROPFIND", this.creds.url, init);
    // Before the first href is resolved: a redirect moves the base path, and
    // resolving against the typed URL would put every entry outside the vault.
    this.rememberEffectiveBase(res);

    let responses: WebDavResponse[];
    // Any other answer to a listing by name than a listing, a folder that is
    // not there, or a refused infinite depth may be about the body (400, 415,
    // 422, 501, a server that fails on it with a 500): asked again without one.
    if (slim && !res.ok && res.status !== 404 && res.status !== 403) {
      return SLIM_INCOMPLETE;
    } else if (res.ok) {
      if (slim) {
        const parsed = this.parseSlim(await res.text());
        if (parsed === SLIM_INCOMPLETE) return SLIM_INCOMPLETE;
        responses = parsed;
      } else {
        responses = this.parseListing(await res.text());
      }
    } else if (res.status === 404) {
      // A vault that has synced before and a folder that is gone: say so
      // instead of reporting an empty remote (finding 2026-09-20).
      if (!this.allowRootCreation) {
        // The path only: never the host, never anything a credential could sit in.
        let folder = "/";
        try { folder = decodeURIComponent(new URL(this.creds.url).pathname) || "/"; } catch { /* keep "/" */ }
        throw new SyncRootMissingError(folder, "The WebDAV server");
      }
      return { etagMap: new Map() };
    } else if (res.status === 403) {
      // RFC 4918 allows servers to refuse infinite-depth PROPFIND (Apache
      // mod_dav, webdav-server, ...; Nextcloud permits it). Fall back to a
      // breadth-first walk with Depth: 1 — same listing, one request per
      // collection.
      const walked = await this.listByDepthOne(slim);
      if (walked === SLIM_INCOMPLETE) return SLIM_INCOMPLETE;
      responses = walked;
    } else {
      throw syncHttpError(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`, res);
    }

    const etagMap = new Map<string, string>();
    // When each file last changed on the server (`getlastmodified`): what the
    // index shows as "edited" for a file this device only downloaded.
    const mtimeMap = new Map<string, number>();
    // Empty-folder sync (2026-07-17): collections seen in the listing are
    // reported so the worker can create locally missing (possibly empty)
    // folders. Internal collections (.plainva, .git, …) stay out.
    const folders: string[] = [];
    for (const resp of responses) {
      if (!resp.href) continue;
      if (resp.isCollection) {
        const rel = trimEndChars(this.relativeHref(resp.href), "/");
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
        if (resp.modifiedAt !== undefined) mtimeMap.set(href, resp.modifiedAt);
      }
    }

    console.log(`[WebDAV] PROPFIND ${this.creds.url} -> ${etagMap.size} file(s), ${folders.length} folder(s)`);
    // What the folder-tag ledger compares (webdavFolderTags.ts): every entry
    // the listing carries, the vault folder as "". Only a Depth: infinity
    // listing names the vault folder itself; a walk leaves it out, and such
    // a server never earns the shortcut.
    const askedMounts = init.body === SLIM_LISTING_BODY_WITH_MOUNTS;
    const ledgerFiles = new Map<string, string>();
    const ledgerFolders = new Map<string, string | undefined>();
    let mounted = false;
    let marked = false;
    for (const resp of responses) {
      if (!resp.href) continue;
      const rel = trimEndChars(this.relativeHref(resp.href), "/");
      const tag = resp.answered.getetag === "ok" ? resp.etag : undefined;
      if (resp.permissions !== undefined) {
        marked = true;
        if (resp.permissions.includes("M")) mounted = true;
      }
      if (resp.isCollection) ledgerFolders.set(rel, tag);
      else if (tag !== undefined) ledgerFiles.set(rel, tag);
    }
    this.observed = { files: ledgerFiles, folders: ledgerFolders, mounted: askedMounts || marked ? mounted : undefined };

    return { etagMap, folders, mtimeMap };
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
      // The vault folder's own name typed composed in the URL, stored
      // decomposed by the server (a folder made in Finder, issue #112): the
      // same folder by identity (ADR 0016), compared segment by segment.
      const baseSegments = base.split("/").filter((s) => s.length > 0);
      const pathSegments = path.split("/").filter((s) => s.length > 0);
      if (
        pathSegments.length >= baseSegments.length &&
        baseSegments.every((segment, i) => segment.normalize("NFC") === pathSegments[i]!.normalize("NFC"))
      ) {
        return pathSegments.slice(baseSegments.length).join("/");
      }
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

  private async listByDepthOne(slim: boolean): Promise<WebDavResponse[] | typeof SLIM_INCOMPLETE> {
    const out: WebDavResponse[] = [];
    const queue: string[] = [""];
    while (queue.length > 0) {
      const rel = queue.shift()!;
      const url = rel ? this.urlForPath(rel) : this.creds.url;
      const res = await this.request("PROPFIND", url, this.propfindInit("1", slim));
      if (slim && !res.ok && res.status !== 404) return SLIM_INCOMPLETE;
      if (!res.ok) {
        if (res.status === 404) continue;
        throw syncHttpError(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`, res);
      }
      let level: WebDavResponse[];
      if (slim) {
        const parsed = this.parseSlim(await res.text());
        if (parsed === SLIM_INCOMPLETE) return SLIM_INCOMPLETE;
        level = parsed;
      } else {
        level = this.parseListing(await res.text());
      }
      for (const resp of level) {
        if (!resp.href) continue;
        if (!resp.isCollection) {
          out.push(resp);
          continue;
        }
        // A Depth: 1 answer lists the collection itself first — only true
        // children go back into the queue (and into the result, so pull()
        // reports them for the empty-folder sync, 2026-07-17).
        const childRel = trimEndChars(this.relativeHref(resp.href), "/");
        if (!childRel || childRel === rel) continue;
        const name = childRel.split("/").pop() ?? childRel;
        if (WebDavSyncTarget.SKIPPED_COLLECTIONS.has(name)) continue;
        out.push(resp);
        queue.push(childRel);
      }
    }
    return out;
  }

  /**
   * One PROPFIND with Depth: 0 on the file itself (C31). Same marker as the
   * listing (getetag without quotes); a server that reports no etag yields ""
   * and the caller hashes the bytes, exactly as the listing path does.
   */
  /**
   * True when `path` is a collection on the server with a file anywhere
   * below it — any file, conflict copies and hidden files included, which no
   * listing of the sync reports. One PROPFIND with Depth: 1 per folder level.
   */
  private async folderHoldsFiles(path: string): Promise<boolean> {
    const rel = trimChars(path.replace(/\\/g, "/"), "/");
    if (!rel) return true;
    const res = await this.request("PROPFIND", this.urlForPath(rel + "/"), { headers: { ...this.headers, "Depth": "1" } });
    if (res.status === 404) return false;
    if (!res.ok) throw syncHttpError(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`, res);
    const entries = this.parseListing(await res.text()).filter((r) => r.href);
    const self = entries.find((r) => trimEndChars(this.relativeHref(r.href!), "/") === rel);
    if (self && !self.isCollection) return false;
    for (const entry of entries) {
      const childRel = trimEndChars(this.relativeHref(entry.href!), "/");
      if (!childRel || childRel === rel) continue;
      if (!entry.isCollection) return true;
      if (await this.folderHoldsFiles(childRel)) return true;
    }
    return false;
  }

  public async stat(filePath: string): Promise<RemoteStat | null> {
    if (filePath.includes(".CONFLICT")) return null;
    const res = await this.request("PROPFIND", this.urlForPath(filePath), {
      headers: { ...this.headers, "Depth": "0" }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw syncHttpError(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`, res);
    const entry = this.parseListing(await res.text()).find((r) => r.href && !r.isCollection);
    if (!entry) return null;
    return {
      etag: (entry.etag ?? "").replace(/"/g, ""),
      size: entry.size ?? 0,
      ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
    };
  }

  /**
   * Path-addressed store: the metadata call reads the object itself, so both
   * answers are definitive (the worker asks before it deletes a local file on
   * the word of a listing — finding 2026-09-20).
   */
  public async probeExists(probe: RemoteProbe): Promise<RemotePresence> {
    return (await this.stat(probe.path)) ? "present" : "absent";
  }

  public async download(filePath: string): Promise<Uint8Array | null> {
    if (filePath.includes(".CONFLICT")) return null;

    const url = this.urlForPath(filePath);
    const res = await this.request("GET", url, {
      headers: this.headers
    });

    if (res.status === 404) return null;
    if (!res.ok) throw syncHttpError(`WebDAV GET failed: ${res.status} ${res.statusText}`, res);

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  public async downloadConditional(filePath: string, etag?: string) {
    const res = await this.request("GET", this.urlForPath(filePath), {
      headers: { ...this.headers, ...(etag ? { "If-None-Match": etag } : {}) },
    });
    if (res.status === 304 && etag) return { notModified: true as const, etag: res.headers.get("ETag") ?? etag };
    if (res.status === 404) return { notModified: false as const, bytes: null };
    if (!res.ok) throw syncHttpError(`WebDAV GET failed: ${res.status} ${res.statusText}`, res);
    return { notModified: false as const, bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get("ETag") ?? undefined };
  }
}
