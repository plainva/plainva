import { ISyncTarget, SyncOperation, PushResult, PullResult } from "./ISyncTarget.js";
import type { FetchFn } from "./WebDavSyncTarget.js";
import { refreshDropboxAccessToken } from "./DropboxAuth.js";

/**
 * Dropbox credentials. Public client (PKCE, no secret); Full-Dropbox access — an
 * app-folder-scoped app would miss existing vaults elsewhere in the tree (the same
 * lesson as Google's drive.file, phase-0 spike).
 */
export interface DropboxCredentials {
  appKey: string;
  refreshToken: string;
  accessToken?: string;
  /** Absolute Dropbox folder the vault lives in, e.g. "/Plainva" (default). */
  rootPath?: string;
}

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const DEFAULT_ROOT = "/Plainva";
/** files/upload hard limit is 150 MB; larger bodies go through an upload session. */
const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024;
const UPLOAD_CHUNK = 32 * 1024 * 1024;

interface DropboxEntry {
  ".tag": "file" | "folder" | "deleted";
  name: string;
  path_display?: string;
  path_lower?: string;
  content_hash?: string;
  rev?: string;
  id?: string;
}

/**
 * JSON for the Dropbox-API-Arg HTTP header must be HTTP-header-safe: all
 * non-ASCII (and DEL, 0x7f) characters escaped as \uXXXX.
 */
export function httpHeaderSafeJson(value: unknown): string {
  let out = "";
  for (const ch of JSON.stringify(value)) {
    const code = ch.charCodeAt(0);
    out += code >= 0x7f ? "\\u" + code.toString(16).padStart(4, "0") : ch;
  }
  return out;
}

/**
 * Dropbox implementation of {@link ISyncTarget} (sync-provider plan 2026-07-04, P6).
 * Path-addressed; `pull()` without a cursor is a full recursive `files/list_folder`
 * (+continue) sweep — the worker's model. With a cursor it is an incremental
 * `files/list_folder/continue` delta (only changes since the cursor, deletions as
 * `deleted` entries), so the worker does one cheap call per cycle (2026-07-09). The
 * change marker is `content_hash` (content-stable: a rename doesn't change it, an edit
 * does), falling back to `rev`.
 *
 * Folder semantics are native: move_v2/delete_v2 are recursive, and uploads create
 * missing parent folders implicitly — no MKCOL-style dance needed. Non-downloadable
 * entries (Dropbox Paper etc.) are excluded from listings.
 *
 * NATIVE VERIFICATION: request shapes are unit-tested against an injected fake
 * fetch; the real OAuth + file roundtrip is maintainer-verified (M-B in the plan).
 */
export class DropboxSyncTarget implements ISyncTarget {
  private fetchFn: FetchFn;
  private accessToken?: string;

  /** Fired after a successful token refresh (persistence hook, rotation-safe). */
  public onTokensRefreshed?: (accessToken: string, refreshToken?: string, expiresInSec?: number) => void;

  private readonly simpleUploadLimit: number;
  private readonly uploadChunk: number;

  constructor(
    private creds: DropboxCredentials,
    fetchFn?: FetchFn,
    private readonly timeoutMs: number = 30000,
    /** Test-only override of the upload thresholds (production uses the API limits). */
    limits?: { simpleUpload?: number; chunk?: number }
  ) {
    this.simpleUploadLimit = limits?.simpleUpload ?? SIMPLE_UPLOAD_LIMIT;
    this.uploadChunk = limits?.chunk ?? UPLOAD_CHUNK;
    this.accessToken = creds.accessToken;
    this.fetchFn =
      fetchFn ||
      (typeof fetch !== "undefined"
        ? fetch
        : ((() => {
            throw new Error("No fetch available");
          }) as any));
  }

  private get rootPath(): string {
    let root = (this.creds.rootPath || DEFAULT_ROOT).replace(/\\/g, "/").trim();
    if (!root.startsWith("/")) root = `/${root}`;
    return root.replace(/\/+$/, "") || DEFAULT_ROOT;
  }

  private dropboxPath(relPath: string): string {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized ? `${this.rootPath}/${normalized}` : this.rootPath;
  }

  /** path_display of an entry -> vault-relative path (case-robust via path_lower). */
  private relPathFor(entry: DropboxEntry): string | null {
    const lower = entry.path_lower;
    const display = entry.path_display;
    if (!lower || !display) return null;
    const rootLower = this.rootPath.toLowerCase();
    if (!lower.startsWith(`${rootLower}/`)) return null;
    return display.substring(this.rootPath.length + 1);
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
      console.error(`[Dropbox] ${method} ${url} failed: ${reason}`);
      throw err instanceof Error ? err : new Error(reason);
    } finally {
      clearTimeout(timer);
    }
  }

  private async refreshAccessToken(): Promise<void> {
    const result = await refreshDropboxAccessToken(
      { appKey: this.creds.appKey, refreshToken: this.creds.refreshToken },
      this.fetchFn
    );
    this.accessToken = result.accessToken;
    if (result.refreshToken) {
      this.creds.refreshToken = result.refreshToken;
    }
    if (this.onTokensRefreshed) {
      this.onTokensRefreshed(result.accessToken, result.refreshToken, result.expiresIn);
    }
  }

  private async authedFetch(url: string, init: RequestInit, isRetry = false): Promise<Response> {
    if (!this.accessToken) {
      await this.refreshAccessToken();
    }
    const headers = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${this.accessToken}`,
    };
    const res = await this.request("POST", url, { ...init, headers });
    if (res.status === 401 && !isRetry) {
      await this.refreshAccessToken();
      return this.authedFetch(url, init, true);
    }
    return res;
  }

  /** RPC endpoint (api.dropboxapi.com): JSON in, JSON out. */
  private async rpc(path: string, body: unknown): Promise<Response> {
    return this.authedFetch(`${API}/${path}`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Child folder names one level below `path` ("" or "/" = Dropbox root) —
   * picker support (2026-07-06). Deliberately independent of `rootPath` (the
   * picker chooses that setting). Non-recursive list_folder + continue.
   */
  public async listFolders(path: string): Promise<string[]> {
    const clean = path.replace(/\\/g, "/").replace(/\/+$/g, "");
    // Dropbox addresses the root as "" (an empty path), never "/".
    const dbxPath = !clean || clean === "/" ? "" : clean.startsWith("/") ? clean : `/${clean}`;
    const names: string[] = [];
    let res = await this.rpc("files/list_folder", {
      path: dbxPath,
      recursive: false,
      include_deleted: false,
      include_non_downloadable_files: false,
    });
    for (;;) {
      if (!res.ok) throw new Error(`Dropbox folder listing failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { entries: DropboxEntry[]; cursor: string; has_more: boolean };
      for (const entry of json.entries || []) {
        if (entry[".tag"] === "folder") names.push(entry.name);
      }
      if (!json.has_more) break;
      res = await this.rpc("files/list_folder/continue", { cursor: json.cursor });
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /** Content endpoint (content.dropboxapi.com): args in the Dropbox-API-Arg header. */
  private async contentCall(path: string, arg: unknown, body?: Uint8Array): Promise<Response> {
    return this.authedFetch(`${CONTENT}/${path}`, {
      headers: {
        "Dropbox-API-Arg": httpHeaderSafeJson(arg),
        "Content-Type": "application/octet-stream",
      },
      body: body ? ((body as unknown) as BodyInit) : undefined,
    });
  }

  /** Best-effort error_summary from a Dropbox 409 (logical error) response. */
  private async errorSummary(res: Response): Promise<string> {
    try {
      const json = (await res.json()) as { error_summary?: string };
      return json.error_summary ?? "";
    } catch {
      return "";
    }
  }

  private fileEtag(entry: DropboxEntry): string {
    return entry.content_hash || entry.rev || entry.id || "";
  }

  /**
   * A change cursor representing "now" for the vault root (`files/list_folder/get_latest_cursor`
   * returns a cursor without enumerating anything). The worker seeds this right before a
   * full listing and then passes it to `pull(cursor)`. On first connect the root may not
   * exist yet — this throws, the worker stays on the full listing (which creates the root),
   * and the next cycle seeds successfully.
   */
  public async getStartCursor(): Promise<string> {
    const res = await this.rpc("files/list_folder/get_latest_cursor", {
      path: this.rootPath,
      recursive: true,
      include_deleted: false,
      include_non_downloadable_files: false,
    });
    if (!res.ok) {
      const summary = await this.errorSummary(res);
      throw new Error(`Dropbox get_latest_cursor failed: ${summary || res.status}`);
    }
    const json = (await res.json()) as { cursor: string };
    return json.cursor;
  }

  /**
   * Incremental delta: only entries changed since `cursor` (deletions arrive as `deleted`
   * entries). A 409 means the cursor was reset/expired — surfaced as an error so the worker
   * drops it and re-syncs via a full listing next cycle (self-heal).
   */
  private async pullDelta(cursor: string): Promise<PullResult> {
    const etagMap = new Map<string, string>();
    const deleted: string[] = [];
    let currentCursor = cursor;
    for (;;) {
      const res = await this.rpc("files/list_folder/continue", { cursor: currentCursor });
      if (!res.ok) {
        const summary = await this.errorSummary(res);
        throw new Error(`Dropbox list_folder/continue failed: ${summary || res.status}`);
      }
      const json = (await res.json()) as { entries: DropboxEntry[]; cursor: string; has_more: boolean };
      for (const entry of json.entries || []) {
        const rel = this.relPathFor(entry);
        if (!rel || rel.includes(".CONFLICT")) continue;
        if (entry[".tag"] === "deleted") deleted.push(rel);
        else if (entry[".tag"] === "file") etagMap.set(rel, this.fileEtag(entry));
        // folder entries are ignored
      }
      currentCursor = json.cursor;
      if (!json.has_more) return { etagMap, deleted, nextCursor: currentCursor };
    }
  }

  public async pull(cursor?: string): Promise<PullResult> {
    if (cursor) return this.pullDelta(cursor);
    const etagMap = new Map<string, string>();

    let res = await this.rpc("files/list_folder", {
      path: this.rootPath,
      recursive: true,
      include_deleted: false,
      include_non_downloadable_files: false,
    });

    if (res.status === 409) {
      const summary = await this.errorSummary(res);
      if (summary.includes("not_found")) {
        // First connect: the vault root doesn't exist yet — create it, report empty.
        const create = await this.rpc("files/create_folder_v2", { path: this.rootPath, autorename: false });
        if (!create.ok && create.status !== 409) {
          throw new Error(`Dropbox create root failed: ${create.status} ${create.statusText}`);
        }
        return { etagMap };
      }
      throw new Error(`Dropbox list failed: ${summary || "409"}`);
    }

    for (;;) {
      if (!res.ok) throw new Error(`Dropbox list failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { entries: DropboxEntry[]; cursor: string; has_more: boolean };
      for (const entry of json.entries || []) {
        if (entry[".tag"] !== "file") continue;
        const rel = this.relPathFor(entry);
        if (!rel || rel.includes(".CONFLICT")) continue;
        etagMap.set(rel, this.fileEtag(entry));
      }
      if (!json.has_more) break;
      res = await this.rpc("files/list_folder/continue", { cursor: json.cursor });
    }

    console.log(`[Dropbox] list ${this.rootPath} -> ${etagMap.size} file(s)`);
    return { etagMap };
  }

  public async download(filePath: string): Promise<Uint8Array | null> {
    if (filePath.includes(".CONFLICT")) return null;
    const res = await this.contentCall("files/download", { path: this.dropboxPath(filePath) });
    if (res.status === 409) {
      const summary = await this.errorSummary(res);
      if (summary.includes("not_found")) return null;
      throw new Error(`Dropbox download failed: ${summary || "409"}`);
    }
    if (!res.ok) throw new Error(`Dropbox download failed: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Large upload via an upload session: start -> append_v2* -> finish (with commit). */
  private async uploadLarge(path: string, content: Uint8Array): Promise<DropboxEntry> {
    const first = content.subarray(0, this.uploadChunk);
    const startRes = await this.contentCall("files/upload_session/start", { close: false }, first);
    if (!startRes.ok) {
      throw new Error(`Dropbox upload session start failed: ${startRes.status} ${startRes.statusText}`);
    }
    const { session_id } = (await startRes.json()) as { session_id: string };

    let offset = first.length;
    while (content.length - offset > this.uploadChunk) {
      const chunk = content.subarray(offset, offset + this.uploadChunk);
      const appendRes = await this.contentCall(
        "files/upload_session/append_v2",
        { cursor: { session_id, offset }, close: false },
        chunk
      );
      if (!appendRes.ok) {
        throw new Error(`Dropbox upload append failed: ${appendRes.status} ${appendRes.statusText}`);
      }
      offset += chunk.length;
    }

    const rest = content.subarray(offset);
    const finishRes = await this.contentCall(
      "files/upload_session/finish",
      {
        cursor: { session_id, offset },
        commit: { path, mode: "overwrite", autorename: false, mute: true },
      },
      rest
    );
    if (!finishRes.ok) {
      throw new Error(`Dropbox upload finish failed: ${finishRes.status} ${finishRes.statusText}`);
    }
    return (await finishRes.json()) as DropboxEntry;
  }

  public async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.file_path.includes(".CONFLICT")) return;

    if (op.operation === "write") {
      const content = op.content || new Uint8Array();
      const path = this.dropboxPath(op.file_path);

      if (content.length > this.simpleUploadLimit) {
        const entry = await this.uploadLarge(path, content);
        return { etag: this.fileEtag(entry), remoteId: entry.id };
      }

      // files/upload creates missing parent folders implicitly.
      const res = await this.contentCall(
        "files/upload",
        { path, mode: "overwrite", autorename: false, mute: true },
        content
      );
      if (!res.ok) throw new Error(`Dropbox upload failed: ${res.status} ${res.statusText}`);
      const entry = (await res.json()) as DropboxEntry;
      return { etag: this.fileEtag(entry), remoteId: entry.id };
    }

    if (op.operation === "delete") {
      const res = await this.rpc("files/delete_v2", { path: this.dropboxPath(op.file_path) });
      if (res.status === 409) {
        const summary = await this.errorSummary(res);
        if (summary.includes("not_found")) return;
        throw new Error(`Dropbox delete failed: ${summary || "409"}`);
      }
      if (!res.ok) throw new Error(`Dropbox delete failed: ${res.status} ${res.statusText}`);
      return;
    }

    if (op.operation === "rename" && op.new_path) {
      if (op.new_path.includes(".CONFLICT")) return;
      const res = await this.rpc("files/move_v2", {
        from_path: this.dropboxPath(op.file_path),
        to_path: this.dropboxPath(op.new_path),
        autorename: false,
      });
      if (res.status === 409) {
        const summary = await this.errorSummary(res);
        if (summary.includes("not_found")) return;
        throw new Error(`Dropbox move failed: ${summary || "409"}`);
      }
      if (!res.ok) throw new Error(`Dropbox move failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { metadata?: DropboxEntry };
      const meta = json.metadata;
      if (meta && meta[".tag"] === "file") {
        return { etag: this.fileEtag(meta), remoteId: meta.id };
      }
      return;
    }
  }
}
