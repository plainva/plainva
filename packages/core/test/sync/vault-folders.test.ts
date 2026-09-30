import { describe, it, expect, vi } from "vitest";
import { MockDatabaseAdapter } from "../mocks/MockDatabaseAdapter.ts";
import { SyncQueue } from "../../src/sync/SyncQueue.ts";
import { SyncEngine } from "../../src/sync/SyncEngine.ts";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.ts";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.ts";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.ts";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.ts";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.ts";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.ts";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.ts";
import { EncryptingSyncTarget } from "../../src/settingsSync/EncryptingSyncTarget.ts";

/**
 * Issue #112: a folder created in Plainva must land INSIDE the vault folder and
 * nowhere else. The engine used to hand the vault-relative path of a queued
 * mkdir to `createFolder`, the pickers' call, which counts from the ACCOUNT
 * root — so on Drive, OneDrive, Dropbox and S3 every such folder appeared a
 * second time, empty, at the top of the cloud. Each provider is driven through
 * the real engine and asked where its requests went.
 */

const fetchMock = (impl: any) => vi.fn<FetchFn>(impl);

function res(body: any, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  } as any;
}

const FOLDER = "Projekte/Neutralität";

/** Pushes one queued mkdir through the engine and checks the op completed. */
async function pushMkdir(target: ISyncTarget, path = FOLDER): Promise<void> {
  const db = new MockDatabaseAdapter();
  const op: SyncOperation = { id: 1, file_path: path, operation: "mkdir", retry_count: 0, next_retry_at: 0, queued_at: 0 };
  db.mockedResults.push([op]);
  const engine = new SyncEngine(new SyncQueue(db), target, { readBinaryFile: async () => new Uint8Array() } as any);
  await engine.processQueue();
  // Completed, not retried: a failure would have written retry_count.
  expect(db.queries.some((q) => q.query.includes("retry_count"))).toBe(false);
}

describe("a folder created in Plainva lands inside the vault folder (issue #112)", () => {
  it("Google Drive: every folder is created below the vault's root folder, none under My Drive", async () => {
    const fetchFn = fetchMock(async (url: string, init: any) => {
      const u = decodeURIComponent(String(url));
      // The vault folder "Plainva" exists at the top of My Drive; nothing below it does.
      if (init.method === "GET" && u.includes("name='Plainva'") && u.includes("'root' in parents")) {
        return res({ files: [{ id: "f-vault", name: "Plainva" }] });
      }
      if (init.method === "GET") return res({ files: [] });
      if (init.method === "POST") return res({ id: `f-${JSON.parse(init.body).name}` });
      throw new Error(`unexpected ${init.method} ${u}`);
    });
    const target = new DriveSyncTarget(
      { clientId: "cid", clientSecret: "sec", refreshToken: "rtok", accessToken: "atok", rootFolderName: "Plainva" },
      fetchFn
    );
    const picker = vi.spyOn(target, "createFolder");

    await pushMkdir(target);

    const posts = fetchFn.mock.calls.filter((c: any) => c[1].method === "POST").map((c: any) => JSON.parse(c[1].body));
    expect(posts).toEqual([
      { name: "Projekte", mimeType: "application/vnd.google-apps.folder", parents: ["f-vault"] },
      { name: "Neutralität", mimeType: "application/vnd.google-apps.folder", parents: ["f-Projekte"] },
    ]);
    expect(posts.some((p: any) => p.parents.includes("root"))).toBe(false);
    expect(picker).not.toHaveBeenCalled();
  });

  it("OneDrive: only the vault folder itself is addressed at the drive root", async () => {
    const fetchFn = fetchMock(async (url: string, init: any) => {
      if (init.method !== "POST") throw new Error(`unexpected ${init.method} ${url}`);
      // The vault folder exists (409); the rest is new.
      return String(url).endsWith("/me/drive/root/children") ? res({}, { status: 409 }) : res({ id: "x" }, { status: 201 });
    });
    const target = new OneDriveSyncTarget(
      { clientId: "cid", refreshToken: "rtok", accessToken: "atok", rootFolderName: "Plainva" } as any,
      fetchFn
    );

    await pushMkdir(target);

    const calls = fetchFn.mock.calls.map((c: any) => ({ url: decodeURIComponent(String(c[0])), name: JSON.parse(c[1].body).name }));
    // The one request at the drive root is the vault folder's own "ensure" (409 = there).
    expect(calls.filter((c) => c.url.endsWith("/me/drive/root/children")).map((c) => c.name)).toEqual(["Plainva"]);
    expect(calls.slice(1)).toEqual([
      { url: expect.stringMatching(/\/me\/drive\/root:\/Plainva:\/children$/), name: "Projekte" },
      { url: expect.stringMatching(/\/me\/drive\/root:\/Plainva\/Projekte:\/children$/), name: "Neutralität" },
    ]);
  });

  it("Dropbox: the folder is created under the vault's root path", async () => {
    const fetchFn = fetchMock(async () => res({}));
    const target = new DropboxSyncTarget(
      { appKey: "akey", refreshToken: "rtok", accessToken: "atok", rootPath: "/Apps/Plainva" } as any,
      fetchFn
    );

    await pushMkdir(target);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain("files/create_folder_v2");
    expect(JSON.parse((fetchFn.mock.calls[0][1] as any).body)).toEqual({
      path: "/Apps/Plainva/Projekte/Neutralität",
      autorename: false,
    });
  });

  it("Dropbox: an existing folder (409) is success", async () => {
    const fetchFn = fetchMock(async () => res({ error_summary: "path/conflict/folder/" }, { status: 409 }));
    const target = new DropboxSyncTarget({ appKey: "akey", refreshToken: "rtok", accessToken: "atok" } as any, fetchFn);
    await pushMkdir(target);
  });

  it("S3: the folder marker is written under the configured prefix", async () => {
    const fetchFn = fetchMock(async () => res(""));
    const target = new S3SyncTarget(
      {
        endpoint: "https://s3.example.com",
        region: "us-east-1",
        bucket: "vaults",
        accessKeyId: "AK",
        secretAccessKey: "SK",
        forcePathStyle: true,
        prefix: "mine/plainva",
      } as any,
      fetchFn,
      30000,
      () => new Date(Date.UTC(2026, 8, 30))
    );

    await pushMkdir(target);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(init.method).toBe("PUT");
    expect(new URL(String(url)).pathname).toBe("/vaults/mine/plainva/Projekte/Neutralit%C3%A4t/");
  });

  it("WebDAV: every MKCOL stays below the vault URL", async () => {
    const fetchFn = fetchMock(async () => res("", { status: 201 }));
    const target = new WebDavSyncTarget(
      { url: "https://cloud.example.com/remote.php/webdav/Vault", user: "u", pass: "p" },
      fetchFn
    );

    await pushMkdir(target);

    expect(fetchFn.mock.calls.map((c: any) => [c[1].method, String(c[0])])).toEqual([
      ["MKCOL", "https://cloud.example.com/remote.php/webdav/Vault/Projekte/"],
      ["MKCOL", "https://cloud.example.com/remote.php/webdav/Vault/Projekte/Neutralit%C3%A4t/"],
    ]);
  });

  it("the content-encryption wrapper passes the vault-relative call through", async () => {
    const created: string[] = [];
    const picker: string[] = [];
    const inner: ISyncTarget = {
      push: async () => undefined,
      pull: async () => ({ etagMap: new Map() }),
      download: async () => null,
      createFolder: async (p) => { picker.push(p); },
      createVaultFolder: async (p) => { created.push(p); },
    };

    await pushMkdir(new EncryptingSyncTarget(inner, { isStrict: () => false }));

    expect(created).toEqual([FOLDER]);
    expect(picker).toEqual([]);
  });

  it("the pickers keep browsing and creating from the account root", async () => {
    // The other half of the split: the settings' folder picker must still be
    // able to create a folder NEXT TO the vault — that is its whole job.
    const fetchFn = fetchMock(async () => res({}));
    const target = new DropboxSyncTarget(
      { appKey: "akey", refreshToken: "rtok", accessToken: "atok", rootPath: "/Apps/Plainva" } as any,
      fetchFn
    );
    await target.createFolder("Elsewhere");
    expect(JSON.parse((fetchFn.mock.calls[0][1] as any).body).path).toBe("/Elsewhere");
  });
});
