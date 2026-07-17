import { describe, it, expect, vi } from "vitest";
import { DropboxSyncTarget, httpHeaderSafeJson } from "../../src/sync/DropboxSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";
import {
  buildDropboxAuthUrl,
  exchangeDropboxCode,
  refreshDropboxAccessToken,
  DROPBOX_REDIRECT_URI,
} from "../../src/sync/DropboxAuth.js";

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

function res(body: any, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => {
      if (body instanceof Uint8Array) {
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      }
      return new TextEncoder().encode(String(body)).buffer;
    },
  } as any;
}

function makeTarget(fetchImpl: any, creds: Record<string, unknown> = {}, limits?: { simpleUpload?: number; chunk?: number }) {
  const fetchFn = vi.fn<FetchFn>(fetchImpl);
  const target = new DropboxSyncTarget(
    { appKey: "akey", refreshToken: "rtok", accessToken: "atok", ...creds } as any,
    fetchFn,
    30000,
    limits
  );
  return { target, fetchFn };
}

function calls(fetchFn: any): { url: string; init: any }[] {
  return fetchFn.mock.calls.map(([url, init]: [string, any]) => ({ url, init }));
}

describe("DropboxAuth", () => {
  it("builds a PKCE auth URL with offline token access and the fixed loopback redirect", () => {
    const url = buildDropboxAuthUrl({ appKey: "akey", codeChallenge: "chal", state: "st" });
    expect(url.startsWith("https://www.dropbox.com/oauth2/authorize?")).toBe(true);
    expect(url).toContain("client_id=akey");
    expect(url).toContain("token_access_type=offline");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain(`redirect_uri=${encodeURIComponent(DROPBOX_REDIRECT_URI)}`);
    expect(url).not.toContain("client_secret");
  });

  it("exchanges the code and refreshes without any secret", async () => {
    const fetchFn = vi.fn(async () => res({ access_token: "at", refresh_token: "rt", expires_in: 14400 }));
    const result = await exchangeDropboxCode({ appKey: "akey", code: "co", codeVerifier: "ver" }, fetchFn as any);
    expect(result).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 14400 });
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe(TOKEN_URL);
    expect(init.body).toContain("grant_type=authorization_code");
    expect(init.body).not.toContain("client_secret");

    const refreshed = await refreshDropboxAccessToken({ appKey: "akey", refreshToken: "rt" }, fetchFn as any);
    expect(refreshed.accessToken).toBe("at");
  });
});

describe("httpHeaderSafeJson", () => {
  it("escapes non-ASCII characters for HTTP header transport", () => {
    expect(httpHeaderSafeJson({ path: "/Plainva/über.md" })).toBe('{"path":"/Plainva/\\u00fcber.md"}');
    expect(httpHeaderSafeJson({ path: "/plain/ascii.md" })).toBe('{"path":"/plain/ascii.md"}');
  });
});

describe("DropboxSyncTarget", () => {
  it("pulls a recursive listing with continue-pagination, content_hash etags and case-robust root strip", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (url === `${API}/files/list_folder`) {
        return res({
          entries: [
            { ".tag": "folder", name: "sub", path_display: "/Plainva/sub", path_lower: "/plainva/sub" },
            { ".tag": "file", name: "a.md", path_display: "/Plainva/a.md", path_lower: "/plainva/a.md", content_hash: "h1" },
            { ".tag": "file", name: "x.CONFLICT-1.md", path_display: "/Plainva/x.CONFLICT-1.md", path_lower: "/plainva/x.conflict-1.md", content_hash: "hc" },
          ],
          cursor: "cur-1",
          has_more: true,
        });
      }
      if (url === `${API}/files/list_folder/continue`) {
        expect(JSON.parse(init.body).cursor).toBe("cur-1");
        return res({
          entries: [
            { ".tag": "file", name: "b.md", path_display: "/Plainva/sub/b.md", path_lower: "/plainva/sub/b.md", content_hash: "h2" },
            { ".tag": "deleted", name: "gone.md", path_display: "/Plainva/gone.md", path_lower: "/plainva/gone.md" },
          ],
          cursor: "cur-2",
          has_more: false,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await target.pull();
    expect(result.etagMap.get("a.md")).toBe("h1");
    expect(result.etagMap.get("sub/b.md")).toBe("h2");
    expect(result.etagMap.size).toBe(2);
    // Empty-folder sync (2026-07-17): the folder entry is reported.
    expect(result.folders).toEqual(["sub"]);

    const listCall = calls(fetchFn)[0];
    const body = JSON.parse(listCall.init.body);
    expect(body).toEqual({
      path: "/Plainva",
      recursive: true,
      include_deleted: false,
      include_non_downloadable_files: false,
    });
    expect(listCall.init.headers["Authorization"]).toBe("Bearer atok");
  });

  it("creates the root folder on first connect (409 not_found) and reports empty", async () => {
    const { target, fetchFn } = makeTarget(async (url: string) => {
      if (url === `${API}/files/list_folder`) {
        return res({ error_summary: "path/not_found/..", error: {} }, { status: 409 });
      }
      if (url === `${API}/files/create_folder_v2`) {
        return res({ metadata: { name: "Plainva" } });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const result = await target.pull();
    expect(result.etagMap.size).toBe(0);
    expect(calls(fetchFn).map((c) => c.url)).toEqual([`${API}/files/list_folder`, `${API}/files/create_folder_v2`]);
  });

  it("getStartCursor returns a cursor via get_latest_cursor (1a)", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      if (url === `${API}/files/list_folder/get_latest_cursor`) {
        expect(JSON.parse(init.body)).toEqual({
          path: "/Plainva",
          recursive: true,
          include_deleted: false,
          include_non_downloadable_files: false,
        });
        return res({ cursor: "cur-now" });
      }
      throw new Error(`unexpected url ${url}`);
    });
    expect(await target.getStartCursor()).toBe("cur-now");
  });

  it("pull(cursor) is an incremental continue delta: changed files, deletions, next cursor (1a)", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (url === `${API}/files/list_folder/continue`) {
        expect(JSON.parse(init.body).cursor).toBe("cur-now");
        return res({
          entries: [
            { ".tag": "file", name: "a.md", path_display: "/Plainva/a.md", path_lower: "/plainva/a.md", content_hash: "h1b" },
            { ".tag": "deleted", name: "gone.md", path_display: "/Plainva/gone.md", path_lower: "/plainva/gone.md" },
            { ".tag": "folder", name: "sub", path_display: "/Plainva/sub", path_lower: "/plainva/sub" },
          ],
          cursor: "cur-next",
          has_more: false,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await target.pull("cur-now");
    expect(result.etagMap.get("a.md")).toBe("h1b");
    expect(result.etagMap.size).toBe(1); // folder entry ignored
    expect(result.deleted).toEqual(["gone.md"]);
    expect(result.nextCursor).toBe("cur-next");
    // The very first call was list_folder/continue, not a full list_folder.
    expect(calls(fetchFn)[0].url).toBe(`${API}/files/list_folder/continue`);
  });

  it("pull(cursor) surfaces a reset cursor (409) as an error so the worker re-syncs (1a self-heal)", async () => {
    const { target } = makeTarget(async (url: string) => {
      if (url === `${API}/files/list_folder/continue`) {
        return res({ error_summary: "reset/..", error: {} }, { status: 409 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    await expect(target.pull("stale-cursor")).rejects.toThrow(/continue failed/);
  });

  it("downloads via content endpoint with header-safe args and maps not_found to null", async () => {
    const bytes = new TextEncoder().encode("body");
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
      return arg.path === "/Plainva/a.md" ? res(bytes) : res({ error_summary: "path/not_found/." }, { status: 409 });
    });
    expect(await target.download("a.md")).toEqual(bytes);
    expect(await target.download("missing.md")).toBeNull();
    expect(calls(fetchFn)[0].url).toBe(`${CONTENT}/files/download`);
  });

  it("pushes a small write via files/upload (overwrite) and returns content_hash + id", async () => {
    const { target, fetchFn } = makeTarget(async () =>
      res({ ".tag": "file", name: "a.md", id: "id:1", content_hash: "h-new", rev: "r1" })
    );
    const result = await target.push({
      id: 1,
      file_path: "notes/ä.md",
      operation: "write",
      content: new TextEncoder().encode("x"),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "h-new", remoteId: "id:1" });
    const call = calls(fetchFn)[0];
    expect(call.url).toBe(`${CONTENT}/files/upload`);
    expect(call.init.headers["Dropbox-API-Arg"]).toContain("\\u00e4"); // header-safe umlaut
    const arg = JSON.parse(call.init.headers["Dropbox-API-Arg"]);
    expect(arg).toEqual({ path: "/Plainva/notes/ä.md", mode: "overwrite", autorename: false, mute: true });
  });

  it("uploads large files via an upload session (start/append/finish with commit)", async () => {
    const content = new Uint8Array(25); // limits: simpleUpload 10, chunk 10 -> 10/10/5
    const seen: string[] = [];
    const { target } = makeTarget(
      async (url: string, init: any) => {
        seen.push(url);
        if (url.endsWith("upload_session/start")) {
          expect(init.body.length).toBe(10);
          return res({ session_id: "sess-1" });
        }
        if (url.endsWith("upload_session/append_v2")) {
          const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
          expect(arg.cursor).toEqual({ session_id: "sess-1", offset: 10 });
          expect(init.body.length).toBe(10);
          return res({});
        }
        if (url.endsWith("upload_session/finish")) {
          const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
          expect(arg.cursor).toEqual({ session_id: "sess-1", offset: 20 });
          expect(arg.commit).toEqual({ path: "/Plainva/big.bin", mode: "overwrite", autorename: false, mute: true });
          expect(init.body.length).toBe(5);
          return res({ ".tag": "file", name: "big.bin", id: "id:big", content_hash: "h-big" });
        }
        throw new Error(`unexpected url ${url}`);
      },
      {},
      { simpleUpload: 10, chunk: 10 }
    );

    const result = await target.push({
      id: 1,
      file_path: "big.bin",
      operation: "write",
      content,
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "h-big", remoteId: "id:big" });
    expect(seen).toEqual([
      `${CONTENT}/files/upload_session/start`,
      `${CONTENT}/files/upload_session/append_v2`,
      `${CONTENT}/files/upload_session/finish`,
    ]);
  });

  it("deletes recursively via delete_v2 and tolerates not_found", async () => {
    const { target, fetchFn } = makeTarget(async () => res({ error_summary: "path_lookup/not_found/." }, { status: 409 }));
    await target.push({ id: 1, file_path: "dir", operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 });
    const call = calls(fetchFn)[0];
    expect(call.url).toBe(`${API}/files/delete_v2`);
    expect(JSON.parse(call.init.body)).toEqual({ path: "/Plainva/dir" });
  });

  it("renames via move_v2 and returns the new file metadata etag", async () => {
    const { target, fetchFn } = makeTarget(async () =>
      res({ metadata: { ".tag": "file", name: "new.md", id: "id:2", content_hash: "h-moved" } })
    );
    const result = await target.push({
      id: 1,
      file_path: "old.md",
      operation: "rename",
      new_path: "sub/new.md",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "h-moved", remoteId: "id:2" });
    expect(JSON.parse(calls(fetchFn)[0].init.body)).toEqual({
      from_path: "/Plainva/old.md",
      to_path: "/Plainva/sub/new.md",
      autorename: false,
    });
  });

  it("returns void for folder moves (metadata tag folder) so no etag is recorded", async () => {
    const { target } = makeTarget(async () => res({ metadata: { ".tag": "folder", name: "new" } }));
    const result = await target.push({
      id: 1,
      file_path: "old",
      operation: "rename",
      new_path: "new",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toBeUndefined();
  });

  it("refreshes on 401 and retries with the new bearer", async () => {
    const refreshed = vi.fn();
    let listCalls = 0;
    const { target } = makeTarget(async (url: string, init: any) => {
      if (url === TOKEN_URL) return res({ access_token: "at-new", expires_in: 14400 });
      listCalls++;
      if (listCalls === 1) return res({}, { status: 401 });
      expect(init.headers["Authorization"]).toBe("Bearer at-new");
      return res({ entries: [], cursor: "c", has_more: false });
    });
    target.onTokensRefreshed = refreshed;
    await target.pull();
    expect(refreshed).toHaveBeenCalledWith("at-new", undefined, 14400);
  });

  it("uses a custom root path and normalizes it", async () => {
    const { target, fetchFn } = makeTarget(
      async () => res({ entries: [], cursor: "c", has_more: false }),
      { rootPath: "Vaults/Notes/" }
    );
    await target.pull();
    expect(JSON.parse(calls(fetchFn)[0].init.body).path).toBe("/Vaults/Notes");
  });
});

describe("DropboxSyncTarget.listFolders (settings picker, 2026-07-06)", () => {
  it("lists root folders non-recursively ('' path) and pages via continue", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (String(url).endsWith("/files/list_folder/continue")) {
        return res({ entries: [{ ".tag": "folder", name: "Archiv" }], cursor: "c2", has_more: false });
      }
      expect(JSON.parse(init.body)).toEqual({
        path: "",
        recursive: false,
        include_deleted: false,
        include_non_downloadable_files: false,
      });
      return res({
        entries: [
          { ".tag": "folder", name: "Plainva" },
          { ".tag": "file", name: "readme.txt" },
          { ".tag": "folder", name: "Fotos" },
        ],
        cursor: "c1",
        has_more: true,
      });
    });

    const names = await target.listFolders("");
    expect(names).toEqual(["Archiv", "Fotos", "Plainva"]);
    expect(calls(fetchFn)[1].url).toBe(`${API}/files/list_folder/continue`);
  });

  it("normalises a sub path to an absolute Dropbox path (independent of rootPath)", async () => {
    const { target, fetchFn } = makeTarget(
      async () => res({ entries: [], cursor: "c", has_more: false }),
      { rootPath: "/Somewhere-Else" }
    );
    await target.listFolders("Apps/Vaults/");
    expect(JSON.parse(calls(fetchFn)[0].init.body).path).toBe("/Apps/Vaults");
  });

  it("throws on a failed listing", async () => {
    // A 500 is a retryable read: fetchWithRetry backs off with real setTimeout
    // between the (up to 4) attempts. Drive those waits with fake timers so the
    // test cannot race vitest's 5s timeout under load — this was the flaky-CI
    // source on main (DropboxSyncTarget.test.ts timeout).
    vi.useFakeTimers();
    try {
      const { target } = makeTarget(async () => res({}, { status: 500 }));
      const assertion = expect(target.listFolders("")).rejects.toThrow(
        "Dropbox folder listing failed: 500"
      );
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
