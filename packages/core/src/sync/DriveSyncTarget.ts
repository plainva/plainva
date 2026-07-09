import { ISyncTarget, SyncOperation, PushResult, PullResult } from "./ISyncTarget.js";
import type { FetchFn } from "./WebDavSyncTarget.js";
import { mimeTypeForPath } from "./fileType.js";

/**
 * BYO Google Drive credentials. The user supplies their own OAuth "Desktop app"
 * client (see ADR 0006) plus the tokens obtained from the (maintainer-verified,
 * native) loopback OAuth flow. The client_secret is not confidential for installed
 * apps (PKCE carries the security), but Google's token endpoint still requires it.
 */
export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  /** Name of the app-managed root folder inside the user's Drive. May be a
   * nested path ("Apps/Plainva") since 2026-07-06 — resolved segment by
   * segment from My Drive's root, creating missing folders. */
  rootFolderName?: string;
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_ROOT = "Plainva";

/**
 * Folder names that hold device-local or VCS data and are never vault content: they must
 * not be walked during a remote listing. A Google Drive DESKTOP client that independently
 * mirrors the same folder uploads `.plainva/` (the SQLite index + hundreds of `.bak`
 * backup snapshots); recursing into it made every full listing crawl thousands of objects
 * the worker then skips anyway (`isLocalOnlyPath`) — slow, and it inflated the sync count.
 */
const INTERNAL_FOLDER_NAMES = new Set([
  ".plainva",
  ".git",
  ".trash",
  ".obsidian",
  "node_modules",
  ".smart-env",
]);
function isInternalFolderName(name: string): boolean {
  return INTERNAL_FOLDER_NAMES.has(name) || name.startsWith(".stfolder");
}

interface DriveFile {
  id: string;
  name: string;
  md5Checksum?: string;
  modifiedTime?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
}

/** Google-native types (Docs/Sheets/Slides/Forms/...) have no binary content. */
function isGoogleNative(mimeType?: string): boolean {
  return !!mimeType && mimeType.startsWith("application/vnd.google-apps.") && mimeType !== FOLDER_MIME;
}

/** Best-effort extraction of the Drive API error reason/message from a failed response. */
async function errorReason(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    return json?.error?.errors?.[0]?.reason || json?.error?.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * Google Drive implementation of {@link ISyncTarget} (phase 5.1 group A, A4).
 *
 * Drive is id- and change-token-based, not path-based. This adapter bridges the two
 * models: it keeps an in-memory path<->id cache (seeded by the initial full listing)
 * and exposes the same path-keyed surface the path-based WebDAV worker expects, while
 * additionally supporting the optional cursor pull (`changes.list` with a
 * `startPageToken`) from the extended ISyncTarget contract.
 *
 * NATIVE VERIFICATION: the real end-to-end OAuth flow and live Drive API behaviour
 * (especially nested-folder semantics, multipart upload and changes pagination) are
 * maintainer-verified against the real API — this harness has no native build or live
 * credentials. The logic here is unit-tested against an injected fake fetch and the
 * documented request shapes (ADR 0006, Drive_Spike.md). The change marker stored in
 * `etagMap` is the file's `md5Checksum` (content hash, aligning with the worker's
 * sha-based reconciliation); it falls back to `modifiedTime` when md5 is absent.
 */
export class DriveSyncTarget implements ISyncTarget {
  private fetchFn: FetchFn;
  private accessToken?: string;
  private rootFolderId?: string;
  /** Relative file path -> Drive file id. */
  private pathToId = new Map<string, string>();
  /** Drive file id -> relative file path (reverse of pathToId, for changes.list). */
  private idToPath = new Map<string, string>();
  /** Relative folder path ("" = root) -> Drive folder id. */
  private folderToId = new Map<string, string>();

  /** Optional hook so the app can persist a refreshed access token. */
  public onTokenRefreshed?: (accessToken: string, expiresInSec?: number) => void;

  constructor(
    private creds: DriveCredentials,
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
      console.error(`[Drive] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Authenticated request. On a 401 it refreshes the access token once and retries,
   * so an expired short-lived token transparently recovers without surfacing as a
   * sync error.
   */
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
    const res = await this.request(method, url, { ...init, headers });
    if (res.status === 401 && !isRetry) {
      await this.refreshAccessToken();
      return this.authedFetch(method, url, init, true);
    }
    return res;
  }

  private async refreshAccessToken(): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      refresh_token: this.creds.refreshToken,
      grant_type: "refresh_token",
    });
    const res = await this.request("POST", TOKEN_ENDPOINT, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Drive token refresh failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.accessToken = json.access_token;
    if (this.onTokenRefreshed) this.onTokenRefreshed(json.access_token, json.expires_in);
  }

  private async getRootFolderId(): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId;
    // Since 2026-07-06 the folder setting may be a NESTED path ("Apps/Plainva",
    // written by the settings folder picker): resolve segment by segment,
    // creating as needed. A plain name ("Plainva") is the one-segment case and
    // behaves exactly as before.
    let parentId = "root";
    for (const segment of this.rootName.replace(/\\/g, "/").split("/").filter((s) => s.length > 0)) {
      parentId = await this.findOrCreateFolder(segment, parentId);
    }
    this.rootFolderId = parentId;
    this.folderToId.set("", this.rootFolderId);
    return this.rootFolderId;
  }

  /**
   * Child folder names one level below `path` in MY DRIVE ("" = Drive root) —
   * picker support (2026-07-06). Browse-only: path segments are resolved
   * WITHOUT creating anything, and the walk is independent of the configured
   * `rootFolderName` (the picker chooses that setting; nested picks work
   * because getRootFolderId resolves the stored value segment-wise).
   */
  public async listFolders(path: string): Promise<string[]> {
    let parentId = "root";
    for (const segment of path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0)) {
      const id = await this.findFolder(segment, parentId);
      if (!id) throw new Error(`Drive folder not found: ${segment}`);
      parentId = id;
    }

    const names: string[] = [];
    const q = `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    let pageToken: string | undefined;
    do {
      let url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("nextPageToken, files(name)")}&pageSize=1000`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await this.authedFetch("GET", url);
      if (!res.ok) throw new Error(`Drive folder listing failed: ${res.status} ${await errorReason(res)}`);
      const json = (await res.json()) as { files?: { name: string }[]; nextPageToken?: string };
      for (const f of json.files ?? []) names.push(f.name);
      pageToken = json.nextPageToken || undefined;
    } while (pageToken);
    return names.sort((a, b) => a.localeCompare(b));
  }

  /** Folder lookup by name under a parent — null when it does not exist. */
  private async findFolder(name: string, parentId: string): Promise<string | null> {
    const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const listUrl = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
    const res = await this.authedFetch("GET", listUrl);
    if (!res.ok) throw new Error(`Drive folder lookup failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { files: DriveFile[] };
    return json.files && json.files.length > 0 ? json.files[0].id : null;
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const existing = await this.findFolder(name, parentId);
    if (existing) return existing;

    const createRes = await this.authedFetch("POST", `${DRIVE_API}/files?fields=id`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!createRes.ok)
      throw new Error(`Drive folder create failed: ${createRes.status} ${createRes.statusText}`);
    const created = (await createRes.json()) as DriveFile;
    return created.id;
  }

  /**
   * Read-only variant of resolveFolderId for LOOKUPS (delete/rename/update
   * checks): resolves the folder id without ever creating missing segments.
   * A delete op for a child of an already-deleted folder must be a no-op —
   * resolving its parent through findOrCreateFolder resurrected the empty
   * folder structure on Drive. Returns null when any segment does not exist.
   */
  private async resolveFolderIdReadOnly(folderPath: string): Promise<string | null> {
    const normalized = folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (normalized === "") return this.getRootFolderId();
    const cached = this.folderToId.get(normalized);
    if (cached) return cached;

    const segments = normalized.split("/").filter((s) => s.length > 0);
    let parentId = await this.getRootFolderId();
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      const hit = this.folderToId.get(acc);
      if (hit) {
        parentId = hit;
        continue;
      }
      const found = await this.findFolder(seg, parentId);
      if (!found) return null;
      this.folderToId.set(acc, found);
      parentId = found;
    }
    return parentId;
  }

  /** Resolves (creating as needed) the Drive folder id for a relative folder path. */
  private async resolveFolderId(folderPath: string): Promise<string> {
    const normalized = folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (normalized === "") return this.getRootFolderId();
    const cached = this.folderToId.get(normalized);
    if (cached) return cached;

    const segments = normalized.split("/").filter((s) => s.length > 0);
    let parentId = await this.getRootFolderId();
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      const hit = this.folderToId.get(acc);
      if (hit) {
        parentId = hit;
        continue;
      }
      parentId = await this.findOrCreateFolder(seg, parentId);
      this.folderToId.set(acc, parentId);
    }
    return parentId;
  }

  private splitPath(filePath: string): { folder: string; name: string } {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const idx = normalized.lastIndexOf("/");
    if (idx === -1) return { folder: "", name: normalized };
    return { folder: normalized.substring(0, idx), name: normalized.substring(idx + 1) };
  }

  private cachePath(path: string, id: string): void {
    this.pathToId.set(path, id);
    this.idToPath.set(id, path);
  }

  private uncachePath(path: string): void {
    const id = this.pathToId.get(path);
    if (id) this.idToPath.delete(id);
    this.pathToId.delete(path);
  }

  private async findFileId(filePath: string): Promise<string | null> {
    const cached = this.pathToId.get(filePath);
    if (cached) return cached;
    const { folder, name } = this.splitPath(filePath);
    // Pure lookup: never create missing parents here. The query carries no
    // mimeType filter, so this resolves FOLDERS too (a folder delete op finds
    // the folder object and Drive deletes it recursively).
    const parentId = await this.resolveFolderIdReadOnly(folder);
    if (parentId === null) return null;
    const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`;
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,md5Checksum)`;
    const res = await this.authedFetch("GET", url);
    if (!res.ok) throw new Error(`Drive file lookup failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { files: DriveFile[] };
    if (json.files && json.files.length > 0) {
      this.cachePath(filePath, json.files[0].id);
      return json.files[0].id;
    }
    return null;
  }

  private multipartBody(metadata: Record<string, unknown>, content: Uint8Array, boundary: string, contentType: string): Blob {
    if (typeof Blob === "undefined") {
      throw new Error("Blob is not available in this runtime; cannot build Drive multipart upload");
    }
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    return new Blob([head, content as BlobPart, tail], {
      type: `multipart/related; boundary=${boundary}`,
    });
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.file_path.includes(".CONFLICT")) return;

    if (op.operation === "write") {
      const content = op.content || new Uint8Array();
      // The Content-Type/mimeType must reflect the actual file (Drive stores the upload
      // Content-Type as the file's mimeType); a fixed text/markdown made images upload as
      // text files.
      const mimeType = mimeTypeForPath(op.file_path);
      const existingId = await this.findFileId(op.file_path);

      if (existingId) {
        // Update content of an existing file (uploadType=media).
        const res = await this.authedFetch(
          "PATCH",
          `${DRIVE_UPLOAD}/files/${existingId}?uploadType=media&fields=id,md5Checksum,modifiedTime`,
          { headers: { "Content-Type": mimeType }, body: content as any as BodyInit }
        );
        if (res.ok) {
          const f = (await res.json()) as DriveFile;
          this.cachePath(op.file_path, f.id);
          return { etag: f.md5Checksum || f.modifiedTime, remoteId: f.id };
        }
        if (res.status !== 404) throw new Error(`Drive update failed: ${res.status} ${res.statusText}`);
        // 404: the cached id is stale (file removed/moved on the remote). Drop it and fall
        // through to create a fresh file at this path.
        this.uncachePath(op.file_path);
      }

      // Create a new file inside its (resolved/created) parent folder.
      const { folder, name } = this.splitPath(op.file_path);
      const parentId = await this.resolveFolderId(folder);
      const boundary = `plainva-${name.length}-${op.file_path.length}`;
      const body = this.multipartBody({ name, parents: [parentId], mimeType }, content, boundary, mimeType);
      const res = await this.authedFetch(
        "POST",
        `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum,modifiedTime`,
        { headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: body as any as BodyInit }
      );
      if (!res.ok) throw new Error(`Drive create failed: ${res.status} ${res.statusText}`);
      const f = (await res.json()) as DriveFile;
      this.cachePath(op.file_path, f.id);
      return { etag: f.md5Checksum || f.modifiedTime, remoteId: f.id };
    }

    if (op.operation === "delete") {
      const id = await this.findFileId(op.file_path);
      if (!id) return;
      const res = await this.authedFetch("DELETE", `${DRIVE_API}/files/${id}`);
      if (!res.ok && res.status !== 404)
        throw new Error(`Drive delete failed: ${res.status} ${res.statusText}`);
      this.uncachePath(op.file_path);
      return;
    }

    if (op.operation === "rename" && op.new_path) {
      if (op.new_path.includes(".CONFLICT")) return;
      const id = await this.findFileId(op.file_path);
      // Source gone remotely: NOT a success — the engine re-uploads at the new
      // path, otherwise the file would exist under no remote path at all.
      if (!id) return { renameSourceMissing: true };
      const from = this.splitPath(op.file_path);
      const to = this.splitPath(op.new_path);
      const params = new URLSearchParams({ fields: "id,md5Checksum,modifiedTime" });
      const metadata: Record<string, unknown> = {};
      if (from.name !== to.name) metadata.name = to.name;
      if (from.folder !== to.folder) {
        const oldParent = await this.resolveFolderId(from.folder);
        const newParent = await this.resolveFolderId(to.folder);
        params.set("addParents", newParent);
        params.set("removeParents", oldParent);
      }
      const res = await this.authedFetch("PATCH", `${DRIVE_API}/files/${id}?${params.toString()}`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });
      if (!res.ok && res.status !== 404)
        throw new Error(`Drive rename failed: ${res.status} ${res.statusText}`);
      this.uncachePath(op.file_path);
      if (res.ok) {
        const f = (await res.json()) as DriveFile;
        this.cachePath(op.new_path, f.id);
        return { etag: f.md5Checksum || f.modifiedTime, remoteId: f.id };
      }
      // The PATCH answered 404 (id turned stale between lookup and rename).
      return { renameSourceMissing: true };
    }
  }

  /**
   * Without a cursor: full recursive listing of the app folder, rebuilding the
   * path<->id caches (returns `etagMap`, no `deleted`/`nextCursor`). With a cursor:
   * incremental `changes.list(startPageToken=cursor)`, returning changed files in
   * `etagMap`, removed/trashed files in `deleted`, and the follow-up token in
   * `nextCursor`.
   */
  public async pull(cursor?: string): Promise<PullResult> {
    if (cursor) return this.pullChanges(cursor);
    return this.pullFullListing();
  }

  private async pullFullListing(): Promise<PullResult> {
    // Rebuild the path<->id caches from scratch: entries for files deleted or moved on
    // the remote since the last listing must not linger, or a later push could target a
    // stale id and fail with a 404.
    this.pathToId.clear();
    this.idToPath.clear();
    this.folderToId.clear();
    const rootId = await this.getRootFolderId();
    this.folderToId.set("", rootId);
    const etagMap = new Map<string, string>();
    await this.listFolder(rootId, "", etagMap);
    return { etagMap };
  }

  private async listFolder(folderId: string, prefix: string, etagMap: Map<string, string>): Promise<void> {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name,md5Checksum,modifiedTime,mimeType)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.authedFetch("GET", `${DRIVE_API}/files?${params.toString()}`);
      if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      for (const f of json.files || []) {
        const path = prefix ? `${prefix}/${f.name}` : f.name;
        if (f.mimeType === FOLDER_MIME) {
          // Never walk device-local/VCS trees (.plainva backups, .git, …): they are not
          // vault content and only slow the listing down. See INTERNAL_FOLDER_NAMES.
          if (isInternalFolderName(f.name)) continue;
          this.folderToId.set(path, f.id);
          await this.listFolder(f.id, path, etagMap);
        } else if (isGoogleNative(f.mimeType)) {
          // Google-native files (Docs/Sheets/Slides/...) have no binary content and
          // cannot be downloaded with alt=media (they return 403). They are not vault
          // content, so skip them entirely.
          continue;
        } else if (!path.includes(".CONFLICT")) {
          this.cachePath(path, f.id);
          etagMap.set(path, f.md5Checksum || f.modifiedTime || f.id);
        }
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
  }

  private async pullChanges(cursor: string): Promise<PullResult> {
    const etagMap = new Map<string, string>();
    const deleted: string[] = [];
    let pageToken: string | undefined = cursor;
    let nextCursor = cursor;

    do {
      const params = new URLSearchParams({
        pageToken: pageToken as string,
        fields:
          "newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,md5Checksum,modifiedTime,mimeType,trashed))",
      });
      const res = await this.authedFetch("GET", `${DRIVE_API}/changes?${params.toString()}`);
      if (!res.ok) throw new Error(`Drive changes.list failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as {
        changes?: { fileId: string; removed?: boolean; file?: DriveFile }[];
        nextPageToken?: string;
        newStartPageToken?: string;
      };

      for (const ch of json.changes || []) {
        const known = this.idToPath.get(ch.fileId);
        const gone = ch.removed || ch.file?.trashed;
        if (gone) {
          if (known) {
            deleted.push(known);
            this.uncachePath(known);
          }
          continue;
        }
        const f = ch.file;
        if (!f || f.mimeType === FOLDER_MIME || isGoogleNative(f.mimeType)) continue;
        // For a known id we keep the established path; a brand-new id whose parent
        // folder we can't resolve from a single change is reconciled on the next
        // full listing (documented limit — full nested-path reconstruction from a
        // bare change is maintainer-verified against the live API).
        const path = known;
        if (path && !path.includes(".CONFLICT")) {
          etagMap.set(path, f.md5Checksum || f.modifiedTime || f.id);
        }
      }

      pageToken = json.nextPageToken;
      if (json.newStartPageToken) nextCursor = json.newStartPageToken;
    } while (pageToken);

    return { etagMap, deleted, nextCursor };
  }

  public async download(filePath: string): Promise<Uint8Array | null> {
    if (filePath.includes(".CONFLICT")) return null;
    const id = await this.findFileId(filePath);
    if (!id) return null;
    const res = await this.authedFetch("GET", `${DRIVE_API}/files/${id}?alt=media`);
    if (res.status === 404) return null;
    if (res.status === 403) {
      // A single un-downloadable file (e.g. a Google-native file that slipped through,
      // or an abuse-flagged file) must not abort the whole sync cycle. Skip it and log
      // the Drive-reported reason for diagnosis.
      const reason = await errorReason(res);
      console.warn(`[Drive] skipping download of ${filePath}: 403 ${reason}`);
      return null;
    }
    if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * Current remote change marker for a path (md5, falling back to modifiedTime), or null
   * if it no longer exists remotely. One lightweight metadata GET; used by the engine's
   * optimistic-concurrency guard right before a push (3b). The etag semantics match
   * `pull`/`push` (md5Checksum || modifiedTime).
   */
  public async remoteEtag(filePath: string): Promise<string | null> {
    if (filePath.includes(".CONFLICT")) return null;
    const id = await this.findFileId(filePath);
    if (!id) return null;
    const res = await this.authedFetch("GET", `${DRIVE_API}/files/${id}?fields=md5Checksum,modifiedTime`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Drive metadata failed: ${res.status} ${res.statusText}`);
    const f = (await res.json()) as DriveFile;
    return f.md5Checksum || f.modifiedTime || null;
  }

  /** Initial cursor for incremental change detection (Drive `changes.getStartPageToken`). */
  public async getStartCursor(): Promise<string> {
    const res = await this.authedFetch("GET", `${DRIVE_API}/changes/startPageToken`);
    if (!res.ok)
      throw new Error(`Drive getStartPageToken failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { startPageToken: string };
    return json.startPageToken;
  }
}
