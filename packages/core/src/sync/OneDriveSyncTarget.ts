import { ISyncTarget, SyncOperation, PushResult, PullResult } from "./ISyncTarget.js";
import type { FetchFn } from "./WebDavSyncTarget.js";
import { mimeTypeForPath } from "./fileType.js";
import { fetchWithRetry } from "./httpRetry.js";
import { refreshOneDriveAccessToken } from "./OneDriveAuth.js";

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

interface GraphItem {
  id: string;
  name: string;
  cTag?: string;
  eTag?: string;
  lastModifiedDateTime?: string;
  folder?: object;
  file?: object;
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
  private accessToken?: string;

  /** Fired whenever a token refresh succeeded (rotation-aware persistence hook). */
  public onTokensRefreshed?: (accessToken: string, refreshToken?: string, expiresInSec?: number) => void | Promise<void>;

  constructor(
    private creds: OneDriveCredentials,
    fetchFn?: FetchFn,
    private readonly timeoutMs: number = 30000
  ) {
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
      console.error(`[OneDrive] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Single-flight guard (P3.1). CRITICAL for Microsoft: the refresh token
   * ROTATES — two concurrent refreshes race for the one valid token, and the
   * loser can invalidate the winner's replacement.
   */
  private refreshInFlight: Promise<void> | null = null;

  private refreshAccessToken(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.doRefreshAccessToken().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefreshAccessToken(): Promise<void> {
    const result = await refreshOneDriveAccessToken(
      { clientId: this.creds.clientId, refreshToken: this.creds.refreshToken },
      this.fetchFn
    );
    this.accessToken = result.accessToken;
    if (result.refreshToken) {
      this.creds.refreshToken = result.refreshToken;
    }
    if (this.onTokensRefreshed) {
      // Awaited (P3.1b): a ROTATED refresh token that fails to persist locks
      // the next app start out of sync — surface that as a cycle error now.
      await this.onTokensRefreshed(result.accessToken, result.refreshToken, result.expiresIn);
    }
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
      await this.refreshAccessToken();
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
    const clean = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
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
      if (!res.ok) throw new Error(`OneDrive folder listing failed: ${res.status} ${res.statusText}`);
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
        throw new Error(`OneDrive folder create failed: ${res.status} ${res.statusText}`);
      }
      parentRel = parentRel ? `${parentRel}/${name}` : name;
    }
  }

  private itemEtag(item: GraphItem): string {
    return item.cTag || item.eTag || item.lastModifiedDateTime || item.id;
  }

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
        throw new Error(`OneDrive folder create failed: ${res.status} ${res.statusText}`);
      }
    }
  }

  private parentFolderOf(relPath: string): string {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? "" : normalized.substring(0, idx);
  }

  private async uploadSmall(relPath: string, content: Uint8Array): Promise<Response> {
    return this.authedFetch("PUT", this.itemUrl(relPath, "content"), {
      headers: { "Content-Type": mimeTypeForPath(relPath) },
      body: (content as unknown) as BodyInit,
    });
  }

  /** Large upload via an upload session (sequential 320-KiB-multiple chunks). */
  private async uploadLarge(relPath: string, content: Uint8Array): Promise<GraphItem> {
    const sessionRes = await this.authedFetch("POST", this.itemUrl(relPath, "createUploadSession"), {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    });
    if (!sessionRes.ok) {
      throw new Error(`OneDrive upload session failed: ${sessionRes.status} ${sessionRes.statusText}`);
    }
    const session = (await sessionRes.json()) as { uploadUrl: string };

    let item: GraphItem | undefined;
    for (let start = 0; start < content.length; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, content.length);
      const chunk = content.subarray(start, end);
      // The uploadUrl is pre-authenticated — deliberately NO Authorization header.
      const res = await this.request("PUT", session.uploadUrl, {
        headers: {
          "Content-Range": `bytes ${start}-${end - 1}/${content.length}`,
        },
        body: (chunk as unknown) as BodyInit,
      });
      if (!res.ok) {
        throw new Error(`OneDrive chunk upload failed: ${res.status} ${res.statusText}`);
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

      if (content.length > SIMPLE_UPLOAD_LIMIT) {
        const item = await this.uploadLarge(op.file_path, content);
        return { etag: this.itemEtag(item), remoteId: item.id };
      }

      let res = await this.uploadSmall(op.file_path, content);
      if (res.status === 404 || res.status === 409) {
        // Missing parent chain: create it once, then retry (WebDAV MKCOL pattern).
        await this.ensureFolder(this.parentFolderOf(op.file_path));
        res = await this.uploadSmall(op.file_path, content);
      }
      if (!res.ok) throw new Error(`OneDrive upload failed: ${res.status} ${res.statusText}`);
      const item = (await res.json()) as GraphItem;
      return { etag: this.itemEtag(item), remoteId: item.id };
    }

    if (op.operation === "delete") {
      const res = await this.authedFetch("DELETE", this.itemUrl(op.file_path));
      if (!res.ok && res.status !== 404) {
        throw new Error(`OneDrive delete failed: ${res.status} ${res.statusText}`);
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
      if (!res.ok) throw new Error(`OneDrive rename failed: ${res.status} ${res.statusText}`);
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
    const rootExists = await this.listInto("", etagMap, folders);
    if (!rootExists) {
      // First connect: the app root doesn't exist yet — create it, report empty.
      await this.ensureFolder("");
    }
    console.log(`[OneDrive] listing -> ${etagMap.size} file(s), ${folders.length} folder(s)`);
    return { etagMap, folders };
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
    if (!res.ok) throw new Error(`OneDrive delta token failed: ${res.status} ${res.statusText}`);
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
      if (!res.ok) throw new Error(`OneDrive delta failed: ${res.status} ${res.statusText}`);
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
      if (!res.ok) throw new Error(`OneDrive list failed: ${res.status} ${res.statusText}`);
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

  public async download(filePath: string): Promise<Uint8Array | null> {
    if (filePath.includes(".CONFLICT")) return null;
    // fetch follows the 302 to the pre-signed download URL transparently.
    const res = await this.authedFetch("GET", this.itemUrl(filePath, "content"));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OneDrive download failed: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
