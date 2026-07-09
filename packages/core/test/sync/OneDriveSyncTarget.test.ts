import { describe, it, expect, vi } from "vitest";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";
import {
  buildOneDriveAuthUrl,
  exchangeOneDriveCode,
  refreshOneDriveAccessToken,
} from "../../src/sync/OneDriveAuth.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

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

function makeTarget(fetchImpl: any, creds: Record<string, unknown> = {}) {
  const fetchFn = vi.fn<FetchFn>(fetchImpl);
  const target = new OneDriveSyncTarget(
    { clientId: "cid", refreshToken: "rtok", accessToken: "atok", ...creds } as any,
    fetchFn
  );
  return { target, fetchFn };
}

function calls(fetchFn: any): { method: string; url: string; init: any }[] {
  return fetchFn.mock.calls.map(([url, init]: [string, any]) => ({ method: init.method, url, init }));
}

describe("OneDriveAuth", () => {
  it("builds a PKCE auth URL without any client secret", () => {
    const url = buildOneDriveAuthUrl({
      clientId: "cid",
      redirectUri: "http://localhost:1234",
      codeChallenge: "chal",
      state: "st",
    });
    expect(url.startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?")).toBe(true);
    expect(url).toContain("client_id=cid");
    expect(url).toContain("code_challenge=chal");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("scope=Files.ReadWrite+offline_access");
    expect(url).toContain("state=st");
    expect(url).not.toContain("client_secret");
  });

  it("exchanges the code as a public client (no secret in the form body)", async () => {
    const fetchFn = vi.fn(async () =>
      res({ access_token: "at", refresh_token: "rt", expires_in: 3600 })
    );
    const result = await exchangeOneDriveCode(
      { clientId: "cid", code: "co", codeVerifier: "ver", redirectUri: "http://localhost:1" },
      fetchFn as any
    );
    expect(result).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe(TOKEN_URL);
    expect(init.body).toContain("grant_type=authorization_code");
    expect(init.body).toContain("code_verifier=ver");
    expect(init.body).not.toContain("client_secret");
  });

  it("surfaces a rotated refresh token from the refresh grant", async () => {
    const fetchFn = vi.fn(async () => res({ access_token: "at2", refresh_token: "rt-rotated" }));
    const result = await refreshOneDriveAccessToken({ clientId: "cid", refreshToken: "rt" }, fetchFn as any);
    expect(result.refreshToken).toBe("rt-rotated");
  });
});

describe("OneDriveSyncTarget", () => {
  it("pulls a recursive, paginated listing keyed by path with cTag etags", async () => {
    const page2 = `${GRAPH}/next-page`;
    const { target } = makeTarget(async (url: string) => {
      if (url.startsWith(`${GRAPH}/me/drive/root:/Plainva:/children`)) {
        return res({
          value: [
            { id: "f1", name: "sub", folder: {} },
            { id: "i1", name: "a.md", file: {}, cTag: "c1" },
            { id: "i9", name: "x.CONFLICT-1.md", file: {}, cTag: "c9" },
          ],
          "@odata.nextLink": page2,
        });
      }
      if (url === page2) {
        return res({ value: [{ id: "i2", name: "b.md", file: {}, cTag: "c2" }] });
      }
      if (url.startsWith(`${GRAPH}/me/drive/root:/Plainva/sub:/children`)) {
        return res({ value: [{ id: "i3", name: "c.md", file: {}, eTag: "e3" }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await target.pull();
    expect(result.etagMap.get("a.md")).toBe("c1");
    expect(result.etagMap.get("b.md")).toBe("c2");
    expect(result.etagMap.get("sub/c.md")).toBe("e3"); // eTag fallback when cTag missing
    expect(result.etagMap.size).toBe(3);
  });

  it("creates the app root on first connect (404 listing) and reports an empty map", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "GET") return res({}, { status: 404 });
      return res({ id: "root" }, { status: 201 });
    });
    const result = await target.pull();
    expect(result.etagMap.size).toBe(0);
    const creates = calls(fetchFn).filter((c) => c.method === "POST");
    expect(creates).toHaveLength(1);
    expect(creates[0].url).toBe(`${GRAPH}/me/drive/root/children`);
    expect(JSON.parse(creates[0].init.body).name).toBe("Plainva");
  });

  it("downloads content and maps 404 to null", async () => {
    const bytes = new TextEncoder().encode("body");
    const { target } = makeTarget(async (url: string) =>
      url === `${GRAPH}/me/drive/root:/Plainva/a.md:/content` ? res(bytes) : res({}, { status: 404 })
    );
    expect(await target.download("a.md")).toEqual(bytes);
    expect(await target.download("missing.md")).toBeNull();
  });

  it("getStartCursor returns the delta token deltaLink (?token=latest) (1a)", async () => {
    const { target, fetchFn } = makeTarget(async (url: string) => {
      if (url === `${GRAPH}/me/drive/root:/Plainva:/delta?token=latest`) {
        return res({ value: [], "@odata.deltaLink": `${GRAPH}/me/drive/root:/Plainva:/delta?token=DL1` });
      }
      throw new Error(`unexpected ${url}`);
    });
    expect(await target.getStartCursor()).toBe(`${GRAPH}/me/drive/root:/Plainva:/delta?token=DL1`);
    expect(calls(fetchFn).every((c) => c.method === "GET")).toBe(true);
  });

  it("pull(cursor) is an incremental delta: changed files, deletions, next deltaLink (1a)", async () => {
    const deltaLink = `${GRAPH}/me/drive/root:/Plainva:/delta?token=DL1`;
    const { target } = makeTarget(async (url: string) => {
      if (url === deltaLink) {
        return res({
          value: [
            { id: "i1", name: "a.md", file: {}, cTag: "c1b", parentReference: { path: "/drive/root:/Plainva" } },
            { id: "i2", name: "c.md", file: {}, cTag: "c9", parentReference: { path: "/drive/root:/Plainva/sub" } },
            { id: "i3", name: "gone.md", deleted: {}, parentReference: { path: "/drive/root:/Plainva" } },
            { id: "root", name: "Plainva", folder: {}, parentReference: { path: "/drive/root:" } },
          ],
          "@odata.deltaLink": `${GRAPH}/me/drive/root:/Plainva:/delta?token=DL2`,
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const result = await target.pull(deltaLink);
    expect(result.etagMap.get("a.md")).toBe("c1b");
    expect(result.etagMap.get("sub/c.md")).toBe("c9");
    expect(result.etagMap.has("Plainva")).toBe(false); // the root folder item is skipped
    expect(result.deleted).toEqual(["gone.md"]);
    expect(result.nextCursor).toBe(`${GRAPH}/me/drive/root:/Plainva:/delta?token=DL2`);
  });

  it("pushes a small write via path-based PUT and returns cTag + id", async () => {
    const { target, fetchFn } = makeTarget(async () => res({ id: "i1", name: "a.md", cTag: "c1" }, { status: 201 }));
    const result = await target.push({
      id: 1,
      file_path: "notes/a.md",
      operation: "write",
      content: new TextEncoder().encode("x"),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "c1", remoteId: "i1" });
    const call = calls(fetchFn)[0];
    expect(call.method).toBe("PUT");
    expect(call.url).toBe(`${GRAPH}/me/drive/root:/Plainva/notes/a.md:/content`);
    expect(call.init.headers["Authorization"]).toBe("Bearer atok");
    expect(call.init.headers["Content-Type"]).toBe("text/markdown");
  });

  it("creates the missing parent chain once and retries the upload on 404", async () => {
    let uploadAttempts = 0;
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "PUT") {
        uploadAttempts++;
        if (uploadAttempts === 1) return res({}, { status: 404 });
        return res({ id: "i1", name: "a.md", cTag: "c1" });
      }
      return res({}, { status: 409 }); // folders already exist
    });
    const result = await target.push({
      id: 1,
      file_path: "deep/nested/a.md",
      operation: "write",
      content: new Uint8Array([1]),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "c1", remoteId: "i1" });
    const posts = calls(fetchFn).filter((c) => c.method === "POST");
    // Root + "deep" + "deep/nested"
    expect(posts.map((c) => c.url)).toEqual([
      `${GRAPH}/me/drive/root/children`,
      `${GRAPH}/me/drive/root:/Plainva:/children`,
      `${GRAPH}/me/drive/root:/Plainva/deep:/children`,
    ]);
    expect(uploadAttempts).toBe(2);
  });

  it("uploads large files through an upload session in Content-Range chunks without auth header", async () => {
    const CHUNK = 16 * 320 * 1024; // keep in sync with the adapter
    const content = new Uint8Array(CHUNK + 10);
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (url.endsWith(":/createUploadSession")) {
        return res({ uploadUrl: "https://upload.example/session-1" });
      }
      if (url === "https://upload.example/session-1") {
        const isLast = init.headers["Content-Range"].endsWith(`/${content.length}`) &&
          init.headers["Content-Range"].includes(`${content.length - 1}-`) === false &&
          init.headers["Content-Range"].includes(`-${content.length - 1}/`);
        return isLast
          ? res({ id: "i1", name: "big.bin", cTag: "c-big" }, { status: 201 })
          : res({}, { status: 202 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await target.push({
      id: 1,
      file_path: "big.bin",
      operation: "write",
      content,
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "c-big", remoteId: "i1" });

    const chunkPuts = calls(fetchFn).filter((c) => c.url === "https://upload.example/session-1");
    expect(chunkPuts).toHaveLength(2);
    expect(chunkPuts[0].init.headers["Content-Range"]).toBe(`bytes 0-${CHUNK - 1}/${content.length}`);
    expect(chunkPuts[1].init.headers["Content-Range"]).toBe(`bytes ${CHUNK}-${content.length - 1}/${content.length}`);
    expect(chunkPuts[0].init.headers["Authorization"]).toBeUndefined();
  });

  it("deletes items (recursive on folders) and tolerates 404", async () => {
    const { target, fetchFn } = makeTarget(async () => res({}, { status: 404 }));
    await target.push({ id: 1, file_path: "gone.md", operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 });
    expect(calls(fetchFn)[0].method).toBe("DELETE");
    expect(calls(fetchFn)[0].url).toBe(`${GRAPH}/me/drive/root:/Plainva/gone.md:`);
  });

  it("renames within the same folder via PATCH name only", async () => {
    const { target, fetchFn } = makeTarget(async () => res({ id: "i1", name: "new.md", cTag: "c2" }));
    const result = await target.push({
      id: 1,
      file_path: "notes/old.md",
      operation: "rename",
      new_path: "notes/new.md",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ etag: "c2", remoteId: "i1" });
    const call = calls(fetchFn)[0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`${GRAPH}/me/drive/root:/Plainva/notes/old.md:`);
    const body = JSON.parse(call.init.body);
    expect(body).toEqual({ name: "new.md" });
  });

  it("reports renameSourceMissing instead of silent success when the source 404s (P1.2)", async () => {
    // Treating the 404 as success used to mark the op synced while the file
    // existed under NO OneDrive path at all — the engine now re-uploads.
    const { target } = makeTarget(async () => res({}, { status: 404 }));
    const result = await target.push({
      id: 1,
      file_path: "notes/old.md",
      operation: "rename",
      new_path: "notes/new.md",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(result).toEqual({ renameSourceMissing: true });
  });

  it("moves across folders with parentReference after ensuring the target chain", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "POST") return res({}, { status: 409 });
      return res({ id: "i1", name: "a.md", cTag: "c3" });
    });
    await target.push({
      id: 1,
      file_path: "from/a.md",
      operation: "rename",
      new_path: "to/sub/a.md",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    const patch = calls(fetchFn).find((c) => c.method === "PATCH")!;
    const body = JSON.parse(patch.init.body);
    expect(body.parentReference).toEqual({ path: "/drive/root:/Plainva/to/sub" });
  });

  it("refreshes on 401, retries with the new bearer and reports the rotated refresh token", async () => {
    const rotated = vi.fn();
    let listCalls = 0;
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (url === TOKEN_URL) {
        return res({ access_token: "at-new", refresh_token: "rt-rotated", expires_in: 3600 });
      }
      listCalls++;
      if (listCalls === 1) return res({}, { status: 401 });
      expect(init.headers["Authorization"]).toBe("Bearer at-new");
      return res({ value: [] });
    });
    target.onTokensRefreshed = rotated;

    await target.pull();
    expect(rotated).toHaveBeenCalledWith("at-new", "rt-rotated", 3600);
    const tokenCall = calls(fetchFn).find((c) => c.url === TOKEN_URL)!;
    expect(tokenCall.init.body).toContain("grant_type=refresh_token");
    expect(tokenCall.init.body).not.toContain("client_secret");
  });
});

describe("OneDriveSyncTarget.listFolders (settings picker, 2026-07-06)", () => {
  it("lists DRIVE-root children ('' = root), keeps only folders, follows @odata.nextLink", async () => {
    const page2 = `${GRAPH}/me/drive/root/children?$skiptoken=abc`;
    const { target, fetchFn } = makeTarget(async (url: string) => {
      const u = String(url);
      if (u === page2) return res({ value: [{ name: "Archiv", folder: {} }] });
      return res({
        value: [
          { name: "Plainva", folder: {} },
          { name: "readme.txt", file: {} },
          { name: "Dokumente", folder: {} },
        ],
        "@odata.nextLink": page2,
      });
    });

    const names = await target.listFolders("");
    expect(names).toEqual(["Archiv", "Dokumente", "Plainva"]);
    // Root browsing is independent of rootFolderName (default "Plainva").
    expect(String(fetchFn.mock.calls[0][0])).toBe(`${GRAPH}/me/drive/root/children?$select=name,folder&$top=200`);
  });

  it("addresses a nested path segment-encoded via the colon syntax", async () => {
    const { target, fetchFn } = makeTarget(async () => res({ value: [] }));
    await target.listFolders("Apps/Mein Vault");
    expect(String(fetchFn.mock.calls[0][0])).toBe(
      `${GRAPH}/me/drive/root:/Apps/Mein%20Vault:/children?$select=name,folder&$top=200`
    );
  });

  it("throws on a failed listing", async () => {
    const { target } = makeTarget(async () => res({}, { status: 403 }));
    await expect(target.listFolders("")).rejects.toThrow("OneDrive folder listing failed: 403");
  });
});
