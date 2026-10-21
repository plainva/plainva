import { syncHttpError, SyncRootMissingError } from "./errorKind.js";
import { fetchWithTransferTimeout, discardResponse } from "./transferTimeout.js";
import { ISyncTarget, RemoteStat, SyncOperation, PushResult, PullResult, SyncContentRef, SyncUploader, RemoteProbe, RemotePresence, RemoteChangedError, type ExpectedRemote } from "./ISyncTarget.js";
import { ConditionalWrites } from "./conditionalWrite.js";
import type { FetchFn } from "./WebDavSyncTarget.js";
import { mimeTypeForPath } from "./fileType.js";
import { fetchWithRetry } from "./httpRetry.js";
import { streamUpload } from "./streamUpload.js";
import { refreshOneDriveAccessToken } from "./OneDriveAuth.js";
import { trimChars } from "../textScan.js";

/**
 * OneDrive credentials. Public client (no secret, ADR-0006-style loopback + PKCE);
 * the clientId is either Plainva's central app registration or a user-supplied one
 * until that registration exists.
 */
export interface OneDriveCredentials {
  clientId: string;
  refreshToken: string;
  accessToken?: string;
  /** Name of the app-managed root folder inside the user's OneDrive. */
  rootFolderName?: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const DEFAULT_ROOT = "Plainva";
/** Path-based simple upload limit; larger bodies go through an upload session. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload-session chunk size: must be a multiple of 320 KiB; 16×320 KiB = 5 MiB. */
const UPLOAD_CHUNK = 16 * 320 * 1024;

/** How an upload is made conditional (see `OneDriveSyncTarget.conditionFor`); empty: unconditional. */
interface UploadCondition {
  /** The item's `eTag`: Graph answers 412 when it changed. */
  ifMatch?: string;
  /** `conflictBehavior=fail`: Graph answers 409 when the file exists. */
  mustNotExist?: boolean;
}

interface GraphItem {
  id: string;
  name: string;
  cTag?: string;
  eTag?: string;
  lastModifiedDateTime?: string;
  folder?: object;
  file?: object;
  size?: number;
  /** Present on delta results; used to reconstruct the vault-relative path. */
  parentReference?: { path?: string };
  /** Present on delta results for removed items. */
  deleted?: object;
}

/**
 * OneDrive (Microsoft Graph) implementation of {@link ISyncTarget} (sync-provider
 * plan 2026-07-04, P4). Path-addressed throughout (`/me/drive/root:/<root>/<path>:`),
 * so no path<->id cache is needed. `pull()` without a cursor is a full recursive children
 * listing (the worker's model); with a cursor it is an incremental Graph `delta` (only
 * items changed/deleted since the token) so the worker does one cheap call per cycle
 * instead of walking every folder (2026-07-09). The change marker is the item's `cTag`,
 * which — unlike `eTag` — only changes when the CONTENT changes (renames/metadata edits
 * don't spoil the reconciliation), with eTag/lastModified fallbacks.
 *
 * Folder ops (delete/rename of a folder path) are natively recursive in Graph.
 * Parents are NOT auto-created by path-based uploads, so writes retry once after
 * creating the missing folder chain (the WebDAV 409/MKCOL pattern).
 *
 * TOKEN ROTATION: Microsoft may return a NEW refresh token on every refresh; the
 * adapter adopts it in-memory and reports it via {@link onTokensRefreshed} so the
 * desktop can persist it immediately — a stale stored token dies quickly otherwise.
 *
 * NATIVE VERIFICATION: request shapes are unit-tested against an injected fake fetch;
 * the real OAuth + file roundtrip is maintainer-verified (M-A in the plan).
 */
export class OneDriveSyncTarget implements ISyncTarget {
  private fetchFn: FetchFn;
  /** Set once an uploader is injected (issue #48). */
  public acceptsContentRef = false;
  private accessToken?: string;

  /** Fired whenever a token refresh succeeded (rotation-aware persistence hook). */
  public onTokensRefreshed?: (accessToken: string, refreshToken?: string, expiresInSec?: number) => void | Promise<void>;

  constructor(
    private creds: OneDriveCredentials,
    fetchFn?: FetchFn,
    private readonly timeoutMs: number = 30000,
    /** Streams a file straight from disk (issue #48); without it every write
     *  takes the buffer path, as before. */
    private readonly uploader?: SyncUploader
  ) {
    this.acceptsContentRef = Boolean(uploader);
    this.accessToken = creds.accessToken;
    this.fetchFn =
      fetchFn ||
      (typeof fetch !== "undefined"
        ? fetch
        : ((() => {
            throw new Error("No fetch available");
          }) as any));
  }

  private get rootName(): string {
    return this.creds.rootFolderName || DEFAULT_ROOT;
  }

  /** Encoded drive path for the colon syntax; "" -> root folder itself. */
  private drivePath(relPath: string): string {
    const full = relPath ? `${this.rootName}/${relPath}` : this.rootName;
    return full
      .split("/")
      .filter((s) => s.length > 0)
      .map((s) => encodeURIComponent(s))
      .join("/");
  }

  /** Graph URL for an item by relative path, with an optional :/suffix (e.g. "content"). */
  private itemUrl(relPath: string, suffix?: string): string {
    const base = `${GRAPH}/me/drive/root:/${this.drivePath(relPath)}`;
    return suffix ? `${base}:/${suffix}` : `${base}:`;
  }

  private async request(method: string, url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetchWithTransferTimeout(this.fetchFn, url, { ...init, method }, this.timeoutMs);
    } catch (err) {
      const reason = err instanceof Error ? (err.message || String(err)) : String(err);
      console.error(`[OneDrive] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
    }
  }

  /**
   * Single-flight guard (P3.1). CRITICAL for Microsoft: the refresh token
   * ROTATES — two concurrent refreshes race for the one valid token, and the
   * loser can invalidate the winner's replacement.
   */
  private refreshInFlight: Promise<void> | null = null;

  /**
   * Set by the shell when the account's refresh token is owned by a shared
   * broker (cloud accounts stage B): this target then never refreshes itself,
   * it only asks for an access token. `force` is passed on a 401 so the broker
   * drops a cached token that the server has already rejected.
   */
  public accessTokenProvider?: (force: boolean) => Promise<string>;

  private refreshAccessToken(force = false): Promise<void> {
    if (this.accessTokenProvider) {
      // The broker serialises across ALL services of the account, so the
      // per-target single-flight below would only add a second, weaker guard.
      return this.accessTokenProvider(force).then((token) => {
        this.accessToken = token;
      });
    }
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.doRefreshAccessToken().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private pendingRefresh: Awaited<ReturnType<typeof refreshOneDriveAccessToken>> | null = null;

  private async doRefreshAccessToken(): Promise<void> {
    const result = this.pendingRefresh ?? await refreshOneDriveAccessToken(
      { clientId: this.creds.clientId, refreshToken: this.creds.refreshToken },
      this.fetchFn
    );
    this.pendingRefresh = result;
    this.accessToken = undefined;
    if (result.refreshToken) {
      this.creds.refreshToken = result.refreshToken;
    }
    if (this.onTokensRefreshed) {
      // Awaited (P3.1b): a ROTATED refresh token that fails to persist locks
      // the next app start out of sync — surface that as a cycle error now.
      await this.onTokensRefreshed(result.accessToken, result.refreshToken, result.expiresIn);
    }
    this.accessToken = result.accessToken;
    this.pendingRefresh = null;
  }

  /** Authenticated request with a single 401 refresh-retry (Drive pattern). */
  private async authedFetch(
    method: string,
    url: string,
    init: RequestInit = {},
    isRetry = false
  ): Promise<Response> {
    if (!this.accessToken) {
      await this.refreshAccessToken();
    }
    const headers = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${this.accessToken}`,
    };
    // Rate-limit handling (P3.2): Graph throttles with 429 + Retry-After.
    const res = await fetchWithRetry(
      () => this.request(method, url, { ...init, headers }),
      method === "GET" ? "read" : "write"
    );
    if (res.status === 401 && !isRetry) {
      discardResponse(res);
      // force: a broker-cached token the server just rejected must not be
      // handed back to us a second time.
      await this.refreshAccessToken(true);
      return this.authedFetch(method, url, init, true);
    }
    return res;
  }

  /**
   * Child folder names one level below `path` in the DRIVE root ("" = OneDrive
   * root) — picker support (2026-07-06). Deliberately independent of
   * `rootFolderName` (the picker chooses that setting); nested picks are fine,
   * `drivePath` splits the stored name into segments.
   */
  public async listFolders(path: string): Promise<string[]> {
    const clean = trimChars(path.replace(/\\/g, "/"), "/");
    const encoded = clean
      .split("/")
      .filter((s) => s.length > 0)
      .map((s) => encodeURIComponent(s))
      .join("/");
    let url = clean
      ? `${GRAPH}/me/drive/root:/${encoded}:/children?$select=name,folder&$top=200`
      : `${GRAPH}/me/drive/root/children?$select=name,folder&$top=200`;
    const names: string[] = [];
    while (url) {
      const res = await this.authedFetch("GET", url);
      if (!res.ok) throw syncHttpError(`OneDrive folder listing failed: ${res.status} ${res.statusText}`, res);
      const json = (await res.json()) as { value?: GraphItem[]; "@odata.nextLink"?: string };
      for (const item of json.value ?? []) {
        if (item.folder) names.push(item.name);
      }
      url = json["@odata.nextLink"] ?? "";
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Creates the folder chain for `path` relative to the DRIVE root — picker
   * "new folder" support (2026-07-13). Same coordinate system as listFolders
   * (deliberately independent of `rootFolderName`); 409 = already exists.
   */
  public async createFolder(path: string): Promise<void> {
    const segments = path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
    let parentRel = "";
    for (const name of segments) {
      const encodedParent = parentRel
        .split("/")
        .filter((s) => s.length > 0)
        .map((s) => encodeURIComponent(s))
        .join("/");
      const url = encodedParent
        ? `${GRAPH}/me/drive/root:/${encodedParent}:/children`
        : `${GRAPH}/me/drive/root/children`;
      const res = await this.authedFetch("POST", url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      if (!res.ok && res.status !== 409) {
        throw syncHttpError(`OneDrive folder create failed: ${res.status} ${res.statusText}`, res);
      }
      parentRel = parentRel ? `${parentRel}/${name}` : name;
    }
  }

  /**
   * Creates the folder chain for a VAULT-RELATIVE `path` inside the vault's
   * root folder — the sync's own coordinate system (issue #112). The same
   * walk a write uses for its parent folders; 409 = already exists.
   */
  public async createVaultFolder(path: string): Promise<void> {
    await this.ensureFolder(path.replace(/\\/g, "/"));
  }

  private itemEtag(item: GraphItem): string {
    return item.cTag || item.eTag || item.lastModifiedDateTime || item.id;
  }

  /**
   * Fired once when the vault's ROOT folder had to be created rather than
   * found. Creating it is correct for a genuinely new connection and quietly
   * wrong for a reconnected one: the vault then syncs into a fresh, empty
   * remote while its real folder sits untouched, and nothing on screen says so.
   * Drive has said this since 2026-08-19; here and on Dropbox it stayed silent
   * on BOTH shells until the mobile parity sweep found it.
   */
  public onRootFolderCreated?: (name: string) => void;

  /**
   * False once the vault has synced files before: a root that cannot be found
   * is then an error with a way out, never a reason to create an empty
   * replacement and compare every known file against it (finding 2026-09-20).
   */
  public allowRootCreation = true;

  private announcedRootCreated = false;

  /**
   * Creates the folder chain for a relative FOLDER path ("" = app root). Existing
   * folders are tolerated (Graph nameAlreadyExists on conflictBehavior=fail).
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const segments = folderPath.split("/").filter((s) => s.length > 0);
    // Create the app root first, then each level below it.
    let parentRel = "";
    const chain: { parent: string; name: string }[] = [{ parent: "", name: this.rootName }];
    for (const seg of segments) {
      chain.push({ parent: parentRel, name: seg });
      parentRel = parentRel ? `${parentRel}/${seg}` : seg;
    }

    for (const { parent, name } of chain) {
      const url =
        name === this.rootName && parent === ""
          ? `${GRAPH}/me/drive/root/children`
          : this.itemUrl(parent, "children");
      const res = await this.authedFetch("POST", url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      // 201 created, 409 already exists — both fine; anything else is a real error.
      if (!res.ok && res.status !== 409) {
        throw syncHttpError(`OneDrive folder create failed: ${res.status} ${res.statusText}`, res);
      }
      // Only the root is worth reporting, and only when it did not exist: 409
      // is the ordinary case on every later call.
      if (res.ok && name === this.rootName && parent === "" && !this.announcedRootCreated) {
        this.announcedRootCreated = true;
        this.onRootFolderCreated?.(this.rootName);
      }
    }
  }

  private parentFolderOf(relPath: string): string {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? "" : normalized.substring(0, idx);
  }

  private async uploadSmall(relPath: string, content: Uint8Array, condition: UploadCondition = {}): Promise<Response> {
    const url = this.itemUrl(relPath, "content") + (condition.mustNotExist ? "?@microsoft.graph.conflictBehavior=fail" : "");
    return this.authedFetch("PUT", url, {
      headers: { "Content-Type": mimeTypeForPath(relPath), ...(condition.ifMatch ? { "if-match": condition.ifMatch } : {}) },
      body: (content as unknown) as BodyInit,
    });
  }

  /** Whether Graph evaluates the conditions below; see `ConditionalWrites`. */
  private readonly conditions = new ConditionalWrites("OneDrive");

  /**
   * The condition of an upload that expects `expected` (Sammelplan § 3.103).
   * The marker of the listing is the item's `cTag` (it moves with the content
   * only), and Graph's `if-match` is documented for the `eTag`: so the item is
   * asked first, its `cTag` compared with the merge base, and the upload is
   * made conditional on the `eTag` of that very answer — whatever changes the
   * item after the question, the write is refused. "No file" is
   * `conflictBehavior=fail`.
   */
  private async conditionFor(relPath: string, expected: ExpectedRemote): Promise<UploadCondition> {
    if (expected.kind === "absent") {
      if (this.conditions.conditionsHold) return { mustNotExist: true };
      await this.conditions.askFirst(relPath, expected, () => this.statFor(relPath, expected));
      return {};
    }
    const item = await this.statItem(relPath);
    if (!this.holds(expected, item)) throw new RemoteChangedError(relPath, "found before the upload");
    return this.conditions.conditionsHold && item?.eTag ? { ifMatch: item.eTag } : {};
  }

  /**
   * Does the item hold the version the upload expects? The marker is the
   * item's `cTag` where the listing carried one — and its `eTag` where it did
   * not: Graph's delta leaves the `cTag` out on OneDrive for Business and
   * SharePoint, so a row a delta wrote names the version by its `eTag`, while
   * the item, asked, answers with both.
   */
  private holds(expected: ExpectedRemote, item: GraphItem | null): boolean {
    if (expected.kind === "absent") return item === null;
    return item !== null && (this.itemEtag(item) === expected.marker || item.eTag === expected.marker);
  }

  /** `stat` for `ConditionalWrites`: the item's answer, its marker the expected one wherever it holds. */
  private async statFor(relPath: string, expected: ExpectedRemote): Promise<RemoteStat | null> {
    const item = await this.statItem(relPath);
    if (!item) return null;
    const current = this.statOf(item);
    return expected.kind === "marker" && this.holds(expected, item) ? { ...current, etag: expected.marker } : current;
  }

  /**
   * Graph refused the condition `tried` (412; 409 for a file that must not
   * exist). Throws `RemoteChangedError` when the content really moved.
   * Answers the condition for one more attempt: the item's new `eTag` where
   * only its metadata moved (a rename of nothing, a property Graph keeps),
   * none where Graph did not evaluate the condition as meant.
   */
  private async afterRefusal(relPath: string, expected: ExpectedRemote, tried: UploadCondition, status: number): Promise<UploadCondition> {
    if (tried.ifMatch && expected.kind === "marker") {
      const item = await this.statItem(relPath);
      if (!this.holds(expected, item)) throw new RemoteChangedError(relPath, String(status));
      if (item?.eTag && item.eTag !== tried.ifMatch) return { ifMatch: item.eTag };
    }
    await this.conditions.refused(relPath, expected, () => this.statFor(relPath, expected), String(status));
    return {};
  }

  /**
   * Large upload via an upload session (sequential 320-KiB-multiple chunks).
   *
   * With a `ref` each chunk is streamed straight from disk by byte range — the
   * whole file never exists in memory (issue #48). The session protocol is
   * identical either way.
   */
  private async uploadLarge(relPath: string, content: Uint8Array | undefined, ref?: SyncContentRef, expected?: ExpectedRemote): Promise<GraphItem> {
    const open = (condition: UploadCondition) => this.authedFetch("POST", this.itemUrl(relPath, "createUploadSession"), {
      headers: { "Content-Type": "application/json", ...(condition.ifMatch ? { "if-match": condition.ifMatch } : {}) },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": condition.mustNotExist ? "fail" : "replace" } }),
    });
    const condition = expected ? await this.conditionFor(relPath, expected) : {};
    let sessionRes = await open(condition);
    if (expected && (condition.ifMatch || condition.mustNotExist) && (sessionRes.status === 412 || sessionRes.status === 409)) {
      discardResponse(sessionRes);
      const next = await this.afterRefusal(relPath, expected, condition, sessionRes.status);
      sessionRes = await open(next);
      if (next.ifMatch && sessionRes.status === 412) throw new RemoteChangedError(relPath, "412");
    }
    if (!sessionRes.ok) {
      throw syncHttpError(`OneDrive upload session failed: ${sessionRes.status} ${sessionRes.statusText}`, sessionRes);
    }
    const session = (await sessionRes.json()) as { uploadUrl: string };

    const total = ref ? ref.size : content!.length;
    let item: GraphItem | undefined;
    for (let start = 0; start < total; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, total);
      // The uploadUrl is pre-authenticated — deliberately NO Authorization header.
      const headers = { "Content-Range": `bytes ${start}-${end - 1}/${total}` };
      const res = ref && this.uploader
        ? await streamUpload(this.uploader, {
            ref,
            url: session.uploadUrl,
            method: "PUT",
            headers,
            offset: start,
            length: end - start,
          })
        : await this.request("PUT", session.uploadUrl, {
            headers,
            body: (content!.subarray(start, end) as unknown) as BodyInit,
          });
      // The session's last chunk commits the item: with `conflictBehavior`
      // `fail`, a file that appeared meanwhile is refused there (409), and a
      // precondition, where Graph checks it again, with 412.
      if (expected && (res.status === 409 || res.status === 412) && end === total) {
        discardResponse(res);
        throw new RemoteChangedError(relPath, String(res.status));
      }
      if (!res.ok) {
        throw syncHttpError(`OneDrive chunk upload failed: ${res.status} ${res.statusText}`, res);
      }
      if (res.status === 200 || res.status === 201) {
        item = (await res.json()) as GraphItem;
      }
    }
    if (!item) throw new Error("OneDrive upload session ended without a final item");
    return item;
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.file_path.includes(".CONFLICT")) return;

    if (op.operation === "write") {
      const content = op.content || new Uint8Array();
      const size = op.contentRef ? op.contentRef.size : content.length;

      const expected = op.expectedRemote;
      if (size > SIMPLE_UPLOAD_LIMIT) {
        const item = await this.uploadLarge(op.file_path, op.contentRef ? undefined : content, op.contentRef, expected);
        return { etag: this.itemEtag(item), remoteId: item.id };
      }

      const condition = expected ? await this.conditionFor(op.file_path, expected) : {};
      let res = await this.uploadSmall(op.file_path, content, condition);
      // A file that must not exist and a missing parent chain can both answer
      // 409: only an item that is there tells them apart.
      const exists = condition.mustNotExist === true && res.status === 409 && (await this.stat(op.file_path)) !== null;
      if (!exists && (res.status === 404 || res.status === 409)) {
        // Missing parent chain: create it once, then retry (WebDAV MKCOL pattern).
        discardResponse(res);
        await this.ensureFolder(this.parentFolderOf(op.file_path));
        res = await this.uploadSmall(op.file_path, content, condition);
      }
      if (expected && (res.status === 412 || (condition.mustNotExist && res.status === 409))) {
        discardResponse(res);
        const next = await this.afterRefusal(op.file_path, expected, condition, res.status);
        res = await this.uploadSmall(op.file_path, content, next);
        if (next.ifMatch && res.status === 412) throw new RemoteChangedError(op.file_path, "412");
      }
      if (!res.ok) throw syncHttpError(`OneDrive upload failed: ${res.status} ${res.statusText}`, res);
      const item = (await res.json()) as GraphItem;
      return { etag: this.itemEtag(item), remoteId: item.id };
    }

    if (op.operation === "delete") {
      const res = await this.authedFetch("DELETE", this.itemUrl(op.file_path));
      if (!res.ok && res.status !== 404) {
        throw syncHttpError(`OneDrive delete failed: ${res.status} ${res.statusText}`, res);
      }
      return;
    }

    if (op.operation === "rename" && op.new_path) {
      if (op.new_path.includes(".CONFLICT")) return;
      const oldParent = this.parentFolderOf(op.file_path);
      const newParent = this.parentFolderOf(op.new_path);
      const newName = op.new_path.substring(op.new_path.lastIndexOf("/") + 1);

      const body: Record<string, unknown> = { name: newName };
      if (oldParent !== newParent) {
        await this.ensureFolder(newParent);
        body.parentReference = { path: `/drive/root:/${this.drivePath(newParent)}` };
      }
      const res = await this.authedFetch("PATCH", this.itemUrl(op.file_path), {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Source gone remotely: NOT a success — the engine re-uploads at the new
      // path, otherwise the file would exist under no remote path at all.
      if (res.status === 404) return { renameSourceMissing: true };
      if (!res.ok) throw syncHttpError(`OneDrive rename failed: ${res.status} ${res.statusText}`, res);
      const item = (await res.json()) as GraphItem;
      return { etag: this.itemEtag(item), remoteId: item.id };
    }
  }

  /**
   * Without a cursor: a full recursive children listing (the worker's model). With a
   * cursor: an incremental Graph `delta` (only items changed/deleted since the token), so
   * the worker does one cheap call per cycle instead of walking every folder.
   */
  public async pull(cursor?: string): Promise<PullResult> {
    if (cursor) return this.pullDelta(cursor);
    const etagMap = new Map<string, string>();
    // Empty-folder sync (2026-07-17): the walk reports every remote folder so
    // the worker can create locally missing (possibly empty) ones.
    const folders: string[] = [];
    const startedAt = Date.now();
    const rootExists = await this.listInto("", etagMap, folders);
    if (!rootExists) {
      if (!this.allowRootCreation) throw new SyncRootMissingError(this.rootName, "OneDrive");
      // First connect: the app root doesn't exist yet — create it, report empty.
      await this.ensureFolder("");
    }
    console.log(`[OneDrive] listing -> ${etagMap.size} file(s), ${folders.length} folder(s)`);
    return { etagMap, folders, listing: { folders: folders.length + 1, pages: 0, files: etagMap.size, ms: Date.now() - startedAt } };
  }

  /**
   * A change token representing "now" for the vault-root delta (Graph `?token=latest`
   * returns an empty page plus a deltaLink). The worker seeds this right before a full
   * listing and then passes it to `pull(cursor)`. On first connect the root may not exist
   * yet — this throws, the worker stays on the full listing (which creates the root), and
   * the next cycle seeds successfully.
   */
  public async getStartCursor(): Promise<string> {
    const res = await this.authedFetch("GET", this.itemUrl("", "delta") + "?token=latest");
    if (!res.ok) throw syncHttpError(`OneDrive delta token failed: ${res.status} ${res.statusText}`, res);
    const json = (await res.json()) as { "@odata.deltaLink"?: string };
    if (!json["@odata.deltaLink"]) throw new Error("OneDrive delta returned no deltaLink");
    return json["@odata.deltaLink"];
  }

  /** Incremental delta pull: only items changed/deleted since `cursor` (a deltaLink URL). */
  private async pullDelta(cursor: string): Promise<PullResult> {
    const etagMap = new Map<string, string>();
    const deleted: string[] = [];
    let url: string | undefined = cursor;
    let nextCursor = cursor;
    while (url) {
      const res: Response = await this.authedFetch("GET", url);
      if (!res.ok) throw syncHttpError(`OneDrive delta failed: ${res.status} ${res.statusText}`, res);
      const json = (await res.json()) as {
        value?: GraphItem[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      };
      for (const item of json.value || []) {
        if (item.folder) continue; // folders (incl. the vault root itself) are not content
        const path = this.deltaItemPath(item);
        if (!path || path.includes(".CONFLICT")) continue;
        if (item.deleted) deleted.push(path);
        else etagMap.set(path, this.itemEtag(item));
      }
      url = json["@odata.nextLink"];
      if (json["@odata.deltaLink"]) nextCursor = json["@odata.deltaLink"];
    }
    return { etagMap, deleted, nextCursor };
  }

  /**
   * Vault-relative path of a delta item from its `parentReference.path` + name. The delta
   * is scoped to the vault root, so items sit under `/drive/root:/<rootName>`. Returns null
   * for items we can't place (e.g. no parentReference).
   */
  private deltaItemPath(item: GraphItem): string | null {
    const parent = item.parentReference?.path;
    if (!parent || !item.name) return null;
    let decoded: string;
    try { decoded = decodeURIComponent(parent); } catch { decoded = parent; }
    const prefix = `/drive/root:/${this.rootName}`;
    if (decoded === prefix) return item.name;
    if (decoded.startsWith(`${prefix}/`)) return `${decoded.slice(prefix.length + 1)}/${item.name}`;
    return null;
  }

  /** Lists one folder level (paginated) and recurses into subfolders. false = folder missing. */
  private async listInto(relFolder: string, etagMap: Map<string, string>, folders?: string[]): Promise<boolean> {
    let url: string | undefined =
      this.itemUrl(relFolder, "children") + "?$select=id,name,folder,file,cTag,eTag,lastModifiedDateTime";
    while (url) {
      const res: Response = await this.authedFetch("GET", url);
      if (res.status === 404) return false;
      if (!res.ok) throw syncHttpError(`OneDrive list failed: ${res.status} ${res.statusText}`, res);
      const json = (await res.json()) as { value?: GraphItem[]; "@odata.nextLink"?: string };
      for (const item of json.value || []) {
        const path = relFolder ? `${relFolder}/${item.name}` : item.name;
        if (item.folder) {
          if (folders && !path.includes(".CONFLICT")) folders.push(path);
          await this.listInto(path, etagMap, folders);
        } else if (!path.includes(".CONFLICT")) {
          etagMap.set(path, this.itemEtag(item));
        }
      }
      url = json["@odata.nextLink"];
    }
    return true;
  }

  /** One item GET without `:/content` (C31); marker as in `pull` (`itemEtag`). */
  public async stat(filePath: string): Promise<RemoteStat | null> {
    const item = await this.statItem(filePath);
    return item ? this.statOf(item) : null;
  }

  /** The file's item as Graph answers it, or null (no file, a folder, a conflict copy). */
  private async statItem(filePath: string): Promise<GraphItem | null> {
    if (filePath.includes(".CONFLICT")) return null;
    const res = await this.authedFetch("GET", `${this.itemUrl(filePath)}?select=id,name,cTag,eTag,lastModifiedDateTime,size,folder,file`);
    if (res.status === 404) return null;
    if (!res.ok) throw syncHttpError(`OneDrive metadata lookup failed: ${res.status} ${res.statusText}`, res);
    const item = (await res.json()) as GraphItem;
    return item.folder ? null : item;
  }

  private statOf(item: GraphItem): RemoteStat {
    const modifiedAt = item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : Number.NaN;
    return {
      etag: this.itemEtag(item),
      size: typeof item.size === "number" && item.size >= 0 ? item.size : 0,
      ...(Number.isNaN(modifiedAt) ? {} : { modifiedAt }),
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
    // fetch follows the 302 to the pre-signed download URL transparently.
    const res = await this.authedFetch("GET", this.itemUrl(filePath, "content"));
    if (res.status === 404) return null;
    if (!res.ok) throw syncHttpError(`OneDrive download failed: ${res.status} ${res.statusText}`, res);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
