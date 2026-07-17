import { describe, it, expect, vi, beforeEach } from "vitest";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function res(body: any, init: { ok?: boolean; status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => {
      if (body instanceof Uint8Array) return body.buffer;
      return new TextEncoder().encode(String(body)).buffer;
    },
  } as any;
}

function makeTarget(fetchImpl: any) {
  const fetchFn = vi.fn<FetchFn>(fetchImpl);
  const target = new DriveSyncTarget(
    { clientId: "cid", clientSecret: "secret", refreshToken: "rtok", accessToken: "atok" },
    fetchFn
  );
  return { target, fetchFn };
}

describe("DriveSyncTarget", () => {
  let isFolderLookup: (u: string) => boolean;
  beforeEach(() => {
    // A folder-existence lookup is the only request carrying the folder mime *in the
    // query* (q=...mimeType='application/vnd.google-apps.folder'...). Listing requests
    // merely mention "mimeType" in their fields= param, so match the mime literal.
    isFolderLookup = (u: string) => u.includes("/drive/v3/files?") && u.includes("vnd.google-apps.folder");
  });

  it("creates a new top-level file and returns its remote id + etag", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder", name: "Plainva" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [] }); // file lookup: not found
      if (init.method === "POST" && u.includes("/upload/drive/v3/files")) return res({ id: "file-1", md5Checksum: "abc123" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const result = await target.push({
      id: 1, file_path: "note.md", operation: "write",
      content: new TextEncoder().encode("hello"), retry_count: 0, next_retry_at: 0, queued_at: 0,
    });

    expect(result).toEqual({ etag: "abc123", remoteId: "file-1" });
    const upload = fetchFn.mock.calls.find((c: any) => String(c[0]).includes("/upload/") && c[1].method === "POST");
    expect(upload).toBeDefined();
    expect((upload as any)[1].headers["Content-Type"]).toContain("multipart/related");
  });

  it("updates an existing file via media PATCH", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "file-9", md5Checksum: "old" }] });
      if (init.method === "PATCH" && u.includes("/upload/drive/v3/files/file-9")) return res({ id: "file-9", md5Checksum: "new" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const result = await target.push({
      id: 2, file_path: "note.md", operation: "write",
      content: new TextEncoder().encode("changed"), retry_count: 0, next_retry_at: 0, queued_at: 0,
    });

    expect(result).toEqual({ etag: "new", remoteId: "file-9" });
    expect(fetchFn.mock.calls.some((c: any) => c[1].method === "PATCH" && String(c[0]).includes("uploadType=media"))).toBe(true);
  });

  it("reports renameSourceMissing when the rename source id cannot be resolved (P1.2)", async () => {
    // `if (!id) return;` used to mark the op synced while the file existed
    // under NO Drive path at all — the engine now re-uploads at the new path.
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [] }); // source not found
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const result = await target.push({
      id: 3, file_path: "old.md", operation: "rename", new_path: "new.md",
      retry_count: 0, next_retry_at: 0, queued_at: 0,
    });

    expect(result).toEqual({ renameSourceMissing: true });
  });

  it("downloads file content by resolving its id", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "file-7" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files/file-7?alt=media")) return res(new TextEncoder().encode("body!"));
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const bytes = await target.download("note.md");
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe("body!");
  });

  it("pulls a full nested listing into a path-keyed etag map", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("root-folder") && u.includes("in")) {
        return res({ files: [
          { id: "f1", name: "a.md", md5Checksum: "h1" },
          { id: "sub-id", name: "sub", mimeType: FOLDER_MIME },
        ] });
      }
      if (init.method === "GET" && u.includes("sub-id")) {
        return res({ files: [{ id: "f2", name: "b.md", md5Checksum: "h2" }] });
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const { etagMap, deleted, nextCursor, folders } = await target.pull();
    expect(etagMap.get("a.md")).toBe("h1");
    expect(etagMap.get("sub/b.md")).toBe("h2");
    expect(deleted).toBeUndefined();
    expect(nextCursor).toBeUndefined();
    // Empty-folder sync (2026-07-17): the walked folder is reported.
    expect(folders).toEqual(["sub"]);
  });

  it("pulls incremental changes with deletions and a follow-up cursor", async () => {
    let phase: "list" | "changes" = "list";
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (phase === "list") {
        if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
        if (init.method === "GET" && u.includes("root-folder")) {
          return res({ files: [
            { id: "f1", name: "a.md", md5Checksum: "h1" },
            { id: "f3", name: "c.md", md5Checksum: "h3" },
          ] });
        }
      }
      if (u.includes("/drive/v3/changes?")) {
        return res({
          changes: [
            { fileId: "f1", file: { id: "f1", name: "a.md", md5Checksum: "h1b" } },
            { fileId: "f3", removed: true },
          ],
          newStartPageToken: "cursor-2",
        });
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    await target.pull(); // seed the id<->path caches
    phase = "changes";
    const { etagMap, deleted, nextCursor } = await target.pull("cursor-1");

    expect(etagMap.get("a.md")).toBe("h1b");
    expect(deleted).toEqual(["c.md"]);
    expect(nextCursor).toBe("cursor-2");
  });

  describe("cursor pull resolves NEW remote files via parents (2026-07-16)", () => {
    /**
     * Shared fixture: a seeded tree (root: a.md + folder "Notes"/b.md + an
     * internal ".plainva" folder), then one changes.list page per test. Before
     * the fix every brand-new remote file was dropped by the cursor pull and
     * stayed invisible until the next full listing — which on mobile
     * effectively only runs on app resume.
     */
    const seedAndPull = async (changes: any[]) => {
      let phase: "list" | "changes" = "list";
      const { target } = makeTarget(async (url: string, init: any) => {
        const u = String(url);
        if (phase === "list") {
          if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
          if (init.method === "GET" && u.includes("root-folder")) {
            return res({ files: [
              { id: "f-a", name: "a.md", md5Checksum: "h-a" },
              { id: "fld-notes", name: "Notes", mimeType: FOLDER_MIME },
              { id: "fld-plainva", name: ".plainva", mimeType: FOLDER_MIME },
            ] });
          }
          if (init.method === "GET" && u.includes("fld-notes")) {
            return res({ files: [{ id: "f-b", name: "b.md", md5Checksum: "h-b" }] });
          }
        }
        if (u.includes("/drive/v3/changes?")) {
          expect(decodeURIComponent(u)).toContain("parents"); // the fix needs parents in fields=
          return res({ changes, newStartPageToken: "cursor-2" });
        }
        throw new Error(`unexpected ${init.method} ${u}`);
      });
      await target.pull();
      phase = "changes";
      return target.pull("cursor-1");
    };

    it("a brand-new file in a KNOWN folder resolves to its path (no full listing needed)", async () => {
      const { etagMap, needsFullListing } = await seedAndPull([
        { fileId: "f-new", file: { id: "f-new", name: "new.md", md5Checksum: "h-new", parents: ["fld-notes"] } },
      ]);
      expect(etagMap.get("Notes/new.md")).toBe("h-new");
      expect(needsFullListing).toBeUndefined();
    });

    it("a new folder + a file inside it resolve within ONE cursor pull", async () => {
      const { etagMap, needsFullListing } = await seedAndPull([
        { fileId: "fld-sub", file: { id: "fld-sub", name: "Sub", mimeType: FOLDER_MIME, parents: ["fld-notes"] } },
        { fileId: "f-c", file: { id: "f-c", name: "c.md", md5Checksum: "h-c", parents: ["fld-sub"] } },
      ]);
      expect(etagMap.get("Notes/Sub/c.md")).toBe("h-c");
      expect(needsFullListing).toBeUndefined();
    });

    it("a new file under an UNKNOWN parent requests a full listing instead of being dropped silently", async () => {
      const { etagMap, needsFullListing } = await seedAndPull([
        { fileId: "f-x", file: { id: "f-x", name: "x.md", md5Checksum: "h-x", parents: ["fld-elsewhere"] } },
      ]);
      expect(etagMap.size).toBe(0);
      expect(needsFullListing).toBe(true);
    });

    it("changes under internal folders (.plainva) are ignored WITHOUT forcing a full listing", async () => {
      const { etagMap, needsFullListing } = await seedAndPull([
        { fileId: "fld-bak", file: { id: "fld-bak", name: "backups", mimeType: FOLDER_MIME, parents: ["fld-plainva"] } },
        { fileId: "f-db", file: { id: "f-db", name: "vault.db", md5Checksum: "h-db", parents: ["fld-bak"] } },
      ]);
      expect(etagMap.size).toBe(0);
      expect(needsFullListing).toBeUndefined();
    });

    it("a KNOWN folder rename/move requests a full listing (children paths went stale)", async () => {
      const { needsFullListing } = await seedAndPull([
        { fileId: "fld-notes", file: { id: "fld-notes", name: "Renamed", mimeType: FOLDER_MIME, parents: ["root-folder"] } },
      ]);
      expect(needsFullListing).toBe(true);
    });

    it("a KNOWN folder trashed requests a full listing (children get no change entries)", async () => {
      const { needsFullListing } = await seedAndPull([
        { fileId: "fld-notes", file: { id: "fld-notes", name: "Notes", mimeType: FOLDER_MIME, trashed: true, parents: ["root-folder"] } },
      ]);
      expect(needsFullListing).toBe(true);
    });

    it("a KNOWN file rename keeps reconciling under the established path but requests a full listing", async () => {
      const { etagMap, needsFullListing } = await seedAndPull([
        { fileId: "f-a", file: { id: "f-a", name: "renamed.md", md5Checksum: "h-a2", parents: ["root-folder"] } },
      ]);
      expect(etagMap.get("a.md")).toBe("h-a2"); // established path, as before
      expect(needsFullListing).toBe(true);
    });
  });

  it("refreshes the access token on a 401 and retries", async () => {
    let folderLookups = 0;
    let refreshed = false;
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "POST" && u.includes("oauth2.googleapis.com/token")) {
        refreshed = true;
        return res({ access_token: "fresh-token", expires_in: 3600 });
      }
      if (init.method === "GET" && isFolderLookup(u)) {
        folderLookups++;
        if (folderLookups === 1) return res({}, { status: 401 });
        return res({ files: [{ id: "root-folder" }] });
      }
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "file-7" }] });
      if (init.method === "GET" && u.includes("alt=media")) return res(new TextEncoder().encode("ok"));
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const onRefresh = vi.fn();
    target.onTokenRefreshed = onRefresh;

    const bytes = await target.download("note.md");
    expect(refreshed).toBe(true);
    expect(onRefresh).toHaveBeenCalledWith("fresh-token", 3600);
    expect(new TextDecoder().decode(bytes!)).toBe("ok");
  });

  it("single-flights concurrent token refreshes (P3.1) and AWAITS the rotation callback (P3.1b)", async () => {
    let tokenPosts = 0;
    let expired401s = 2; // BOTH parallel requests hit an expired token first
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "POST" && u.includes("oauth2.googleapis.com/token")) {
        tokenPosts++;
        await new Promise((r) => setTimeout(r, 20)); // both callers wait on ONE refresh
        return res({ access_token: "fresh-token", expires_in: 3600 });
      }
      if (init.method === "GET" && expired401s > 0 && init.headers?.Authorization !== "Bearer fresh-token") {
        expired401s--;
        return res({}, { status: 401 });
      }
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "file-7" }] });
      if (init.method === "GET" && u.includes("alt=media")) return res(new TextEncoder().encode("ok"));
      throw new Error(`unexpected ${init.method} ${u}`);
    });
    let persisted = 0;
    target.onTokenRefreshed = async () => {
      await new Promise((r) => setTimeout(r, 10));
      persisted++;
    };
    const [a, b] = await Promise.all([target.download("a.md"), target.download("b.md")]);
    expect(new TextDecoder().decode(a!)).toBe("ok");
    expect(new TextDecoder().decode(b!)).toBe("ok");
    expect(tokenPosts).toBe(1); // no refresh stampede
    expect(persisted).toBe(1); // and the persistence callback completed before use
  });

  it("never pushes or downloads .CONFLICT files", async () => {
    const { target, fetchFn } = makeTarget(async () => { throw new Error("should not fetch"); });
    const pushed = await target.push({
      id: 3, file_path: "note.CONFLICT-1.md", operation: "write",
      content: new Uint8Array(), retry_count: 0, next_retry_at: 0, queued_at: 0,
    });
    expect(pushed).toBeUndefined();
    expect(await target.download("note.CONFLICT-1.md")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips Google-native files (Docs/Sheets) in the listing", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("root-folder")) {
        return res({ files: [
          { id: "f1", name: "note.md", md5Checksum: "h1" },
          { id: "gd", name: "Doc", mimeType: "application/vnd.google-apps.document" },
        ] });
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const { etagMap } = await target.pull();
    expect(etagMap.get("note.md")).toBe("h1");
    expect(etagMap.has("Doc")).toBe(false);
    expect(etagMap.size).toBe(1);
  });

  it("does not walk device-local/VCS folders (.plainva, .git) during a full listing (1b)", async () => {
    // A Google Drive DESKTOP client mirroring the same folder uploads .plainva/** (the
    // index DB + hundreds of .bak snapshots). Walking it was slow and inflated the sync
    // count; those trees must be skipped entirely, not just skipped after the fact.
    let walkedInternal = false;
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("root-folder")) {
        return res({ files: [
          { id: "f1", name: "note.md", md5Checksum: "h1" },
          { id: "pv-id", name: ".plainva", mimeType: FOLDER_MIME },
          { id: "git-id", name: ".git", mimeType: FOLDER_MIME },
        ] });
      }
      if (init.method === "GET" && (u.includes("pv-id") || u.includes("git-id"))) {
        walkedInternal = true;
        return res({ files: [{ id: "db", name: "vault.db", md5Checksum: "hx" }] });
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const { etagMap } = await target.pull();
    expect(etagMap.get("note.md")).toBe("h1");
    expect(walkedInternal).toBe(false);                 // neither internal tree was listed
    expect(etagMap.has(".plainva/vault.db")).toBe(false);
    expect(etagMap.size).toBe(1);
  });

  it("remoteEtag returns the current md5 for a path and null for conflict copies (3b probe)", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "file-5", md5Checksum: "cur" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files/file-5?") && u.includes("md5Checksum")) return res({ md5Checksum: "cur" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    expect(await target.remoteEtag("note.md")).toBe("cur");
    expect(await target.remoteEtag("note.CONFLICT-1.md")).toBeNull();
  });

  it("getStartCursor returns the Drive startPageToken (1a)", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && u.includes("/drive/v3/changes/startPageToken")) return res({ startPageToken: "tok-42" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });
    expect(await target.getStartCursor()).toBe("tok-42");
  });

  it("uploads an image with its real MIME type, not text/markdown", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "img-1", md5Checksum: "old" }] });
      if (init.method === "PATCH" && u.includes("/upload/drive/v3/files/img-1")) return res({ id: "img-1", md5Checksum: "new" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    await target.push({
      id: 1, file_path: "assets/pic.png", operation: "write",
      content: new Uint8Array([1, 2, 3]), retry_count: 0, next_retry_at: 0, queued_at: 0,
    });

    const patch = fetchFn.mock.calls.find((c: any) => c[1].method === "PATCH");
    expect(patch).toBeDefined();
    expect((patch as any)[1].headers["Content-Type"]).toBe("image/png");
  });

  it("recreates a file when update hits a stale 404", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "stale-id" }] });
      if (init.method === "PATCH" && u.includes("/upload/drive/v3/files/stale-id")) return res({ error: { message: "not found" } }, { status: 404 });
      if (init.method === "POST" && u.includes("/upload/drive/v3/files")) return res({ id: "new-id", md5Checksum: "h" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    const result = await target.push({
      id: 1, file_path: "note.md", operation: "write",
      content: new TextEncoder().encode("x"), retry_count: 0, next_retry_at: 0, queued_at: 0,
    });
    expect(result).toEqual({ etag: "h", remoteId: "new-id" });
  });

  it("skips a file that returns 403 on download instead of aborting", async () => {
    const { target } = makeTarget(async (url: string, init: any) => {
      const u = String(url);
      if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
      if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "f7" }] });
      if (init.method === "GET" && u.includes("alt=media")) {
        return res({ error: { errors: [{ reason: "cannotDownloadAbusiveFile" }] } }, { status: 403 });
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    });

    expect(await target.download("note.md")).toBeNull();
  });

  describe("listFolders (settings picker, 2026-07-06)", () => {
    it("lists MY-DRIVE-root folders (paginated, sorted) without creating anything", async () => {
      const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
        const u = String(url);
        if (init.method !== "GET" || !u.includes("/drive/v3/files?")) throw new Error(`unexpected ${init.method} ${u}`);
        if (u.includes("pageToken=tok-1")) return res({ files: [{ name: "Archiv" }] });
        return res({ files: [{ name: "Plainva" }, { name: "Fotos" }], nextPageToken: "tok-1" });
      });

      const names = await target.listFolders("");
      expect(names).toEqual(["Archiv", "Fotos", "Plainva"]);

      const first = String(fetchFn.mock.calls[0][0]);
      const q = decodeURIComponent(first.split("q=")[1].split("&")[0]);
      expect(q).toBe(`'root' in parents and mimeType='${FOLDER_MIME}' and trashed=false`);
      // Browse-only: no POST (findOrCreateFolder must NOT run).
      expect(fetchFn.mock.calls.every((c: any) => c[1].method === "GET")).toBe(true);
    });

    it("resolves a nested path segment-wise (find-only) and lists its children", async () => {
      const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
        const u = decodeURIComponent(String(url));
        if (init.method !== "GET") throw new Error(`unexpected ${init.method} ${u}`);
        if (u.includes("name='Apps'") && u.includes("'root' in parents")) return res({ files: [{ id: "f-apps", name: "Apps" }] });
        if (u.includes("name='Vaults'") && u.includes("'f-apps' in parents")) return res({ files: [{ id: "f-vaults", name: "Vaults" }] });
        if (u.includes("'f-vaults' in parents")) return res({ files: [{ name: "Privat" }, { name: "Arbeit" }] });
        throw new Error(`unexpected lookup ${u}`);
      });

      const names = await target.listFolders("Apps/Vaults");
      expect(names).toEqual(["Arbeit", "Privat"]);
      expect(fetchFn.mock.calls.every((c: any) => c[1].method === "GET")).toBe(true);
    });

    it("throws a clear error when a path segment does not exist (no create)", async () => {
      const { target, fetchFn } = makeTarget(async () => res({ files: [] }));
      await expect(target.listFolders("Weg")).rejects.toThrow("Drive folder not found: Weg");
      expect(fetchFn.mock.calls.every((c: any) => c[1].method === "GET")).toBe(true);
    });

    it("throws on a failed listing", async () => {
      const { target } = makeTarget(async () => res({ error: { message: "nope" } }, { status: 403 }));
      await expect(target.listFolders("")).rejects.toThrow("Drive folder listing failed: 403");
    });
  });

  describe("nested rootFolderName (2026-07-06)", () => {
    it("resolves 'Apps/Plainva' segment by segment before the first push", async () => {
      const lookups: string[] = [];
      const fetchFn = vi.fn(async (url: string, init: any) => {
        const u = decodeURIComponent(String(url));
        if (init.method === "GET" && u.includes("vnd.google-apps.folder")) {
          lookups.push(u);
          if (u.includes("name='Apps'") && u.includes("'root' in parents")) return res({ files: [{ id: "f-apps", name: "Apps" }] });
          if (u.includes("name='Plainva'") && u.includes("'f-apps' in parents")) return res({ files: [] }); // -> create
          throw new Error(`unexpected folder lookup ${u}`);
        }
        if (init.method === "POST" && u.includes("/drive/v3/files?fields=id")) {
          const body = JSON.parse(init.body);
          expect(body).toMatchObject({ name: "Plainva", parents: ["f-apps"] });
          return res({ id: "f-plainva" });
        }
        if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [] }); // file lookup: not found
        if (init.method === "POST" && u.includes("/upload/drive/v3/files")) return res({ id: "file-1", md5Checksum: "abc" });
        throw new Error(`unexpected ${init.method} ${u}`);
      });
      const target = new DriveSyncTarget(
        { clientId: "cid", clientSecret: "secret", refreshToken: "rtok", accessToken: "atok", rootFolderName: "Apps/Plainva" },
        fetchFn as any
      );

      const result = await target.push({
        id: 1, file_path: "note.md", operation: "write",
        content: new TextEncoder().encode("x"), retry_count: 0, next_retry_at: 0, queued_at: 0,
      });
      expect(result).toMatchObject({ remoteId: "file-1" });
      expect(lookups).toHaveLength(2);
      expect(lookups[0]).toContain("'root' in parents");
      expect(lookups[1]).toContain("'f-apps' in parents");
    });
  });

  describe("delete ops", () => {
    const deleteOp = (filePath: string) => ({
      id: 9, file_path: filePath, operation: "delete" as const,
      retry_count: 0, next_retry_at: 0, queued_at: 0,
    });

    it("deletes a file by its resolved id (404 on DELETE is success)", async () => {
      const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
        const u = String(url);
        if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
        if (init.method === "GET" && u.includes("/drive/v3/files?")) return res({ files: [{ id: "f-1" }] });
        if (init.method === "DELETE" && u.includes("/files/f-1")) return res({}, { status: 404, ok: false });
        throw new Error(`unexpected ${init.method} ${u}`);
      });

      await expect(target.push(deleteOp("note.md"))).resolves.toBeUndefined();
      expect(fetchFn.mock.calls.some((c: any) => c[1].method === "DELETE" && String(c[0]).includes("/files/f-1"))).toBe(true);
    });

    it("deletes a FOLDER: the mime-unfiltered lookup finds the folder object (Drive deletes recursively)", async () => {
      const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
        const u = String(url);
        if (init.method === "GET" && isFolderLookup(u)) return res({ files: [{ id: "root-folder" }] });
        // The delete lookup carries NO mimeType filter, so the folder itself matches.
        if (init.method === "GET" && u.includes("/drive/v3/files?")) {
          expect(u).toContain(encodeURIComponent("name='proj'"));
          expect(u).not.toContain(encodeURIComponent(FOLDER_MIME));
          return res({ files: [{ id: "folder-7" }] });
        }
        if (init.method === "DELETE" && u.includes("/files/folder-7")) return res({});
        throw new Error(`unexpected ${init.method} ${u}`);
      });

      await expect(target.push(deleteOp("proj"))).resolves.toBeUndefined();
      expect(fetchFn.mock.calls.some((c: any) => c[1].method === "DELETE" && String(c[0]).includes("/files/folder-7"))).toBe(true);
    });

    it("a delete for a child of an already-deleted folder never re-creates folders (read-only lookup)", async () => {
      // The old lookup resolved the parent through findOrCreateFolder and
      // RESURRECTED the just-deleted folder structure (empty) on Drive.
      const posts: string[] = [];
      const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
        const u = String(url);
        if (init.method === "POST") { posts.push(u); return res({ id: "should-not-exist" }); }
        if (init.method === "GET" && isFolderLookup(u)) {
          // The root exists; the deleted folder "gone" does not.
          return u.includes(encodeURIComponent("name='gone'")) ? res({ files: [] }) : res({ files: [{ id: "root-folder" }] });
        }
        throw new Error(`unexpected ${init.method} ${u}`);
      });

      await expect(target.push(deleteOp("gone/child.md"))).resolves.toBeUndefined();
      expect(posts).toEqual([]); // no folder was created
      expect(fetchFn.mock.calls.some((c: any) => c[1].method === "DELETE")).toBe(false); // nothing to delete
    });
  });
});
