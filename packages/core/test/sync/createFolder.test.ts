import { describe, it, expect, vi } from "vitest";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.js";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.js";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.js";

/**
 * The pickers' "new folder" contract (2026-07-13): every provider creates the
 * folder chain in the SAME coordinate system listFolders browses (account /
 * bucket root), idempotently — an existing folder is success, because the
 * picker races other devices. WebDAV additionally gains listFolders here
 * (Depth-1 PROPFIND), which the unified online-vault setup and the mobile
 * picker rely on.
 */

/** Like the sibling suites: hand-written handlers stay loosely typed. */
const fetchMock = (impl: any) => vi.fn<FetchFn>(impl);

function res(body: any, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  } as any;
}

const multistatus = (hrefs: { href: string; collection?: boolean; etag?: string }[]) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs
    .map(
      (h) =>
        `<d:response><d:href>${h.href}</d:href><d:propstat><d:prop>` +
        (h.collection ? `<d:resourcetype><d:collection/></d:resourcetype>` : `<d:resourcetype/>`) +
        (h.etag ? `<d:getetag>"${h.etag}"</d:getetag>` : "") +
        `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    )
    .join("")}</d:multistatus>`;

describe("WebDavSyncTarget listFolders (picker, 2026-07-13)", () => {
  const makeTarget = (fetchImpl: any) => {
    const fetchFn = fetchMock(fetchImpl);
    const target = new WebDavSyncTarget(
      { url: "https://cloud.example.com/remote.php/webdav", user: "u", pass: "p" },
      fetchFn
    );
    return { target, fetchFn };
  };

  it("lists child collections one level deep, skipping files, itself and device-local folders", async () => {
    const { target, fetchFn } = makeTarget(async () =>
      res(
        multistatus([
          { href: "/remote.php/webdav/", collection: true },
          { href: "/remote.php/webdav/Projekte/", collection: true },
          { href: "/remote.php/webdav/Dokumente/", collection: true },
          { href: "/remote.php/webdav/.plainva/", collection: true },
          { href: "/remote.php/webdav/note.md", etag: "e1" },
        ])
      )
    );

    expect(await target.listFolders("")).toEqual(["Dokumente", "Projekte"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://cloud.example.com/remote.php/webdav/");
    const init = fetchFn.mock.calls[0][1] as any;
    expect(init.method).toBe("PROPFIND");
    expect(init.headers["Depth"]).toBe("1");
  });

  it("browses a sublevel and treats a 404 (folder not there yet) as an empty level", async () => {
    const { target, fetchFn } = makeTarget(async (url: string) => {
      if (String(url).endsWith("/Dokumente/")) {
        return res(
          multistatus([
            { href: "/remote.php/webdav/Dokumente/", collection: true },
            { href: "/remote.php/webdav/Dokumente/Sub/", collection: true },
          ])
        );
      }
      return res("", { status: 404 });
    });

    expect(await target.listFolders("Dokumente")).toEqual(["Sub"]);
    expect(await target.listFolders("Nirgends")).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("WebDavSyncTarget createFolder (picker, 2026-07-13)", () => {
  it("MKCOLs every level including the last segment and tolerates 405 (exists)", async () => {
    const fetchFn = fetchMock(async (url: string) =>
      String(url).endsWith("/Dokumente/") ? res("", { status: 405 }) : res("", { status: 201 })
    );
    const target = new WebDavSyncTarget(
      { url: "https://cloud.example.com/remote.php/webdav", user: "u", pass: "p" },
      fetchFn
    );

    await target.createFolder("Dokumente/Mein Wissen");

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://cloud.example.com/remote.php/webdav/Dokumente/");
    expect(String(fetchFn.mock.calls[1][0])).toBe(
      "https://cloud.example.com/remote.php/webdav/Dokumente/Mein%20Wissen/"
    );
    expect(fetchFn.mock.calls.every((c: any) => c[1].method === "MKCOL")).toBe(true);
  });

  it("surfaces a real MKCOL failure", async () => {
    const fetchFn = fetchMock(async () => res("", { status: 403 }));
    const target = new WebDavSyncTarget(
      { url: "https://cloud.example.com/remote.php/webdav", user: "u", pass: "p" },
      fetchFn
    );
    await expect(target.createFolder("Nope")).rejects.toThrow(/MKCOL failed: 403/);
  });
});

describe("DriveSyncTarget createFolder (picker, 2026-07-13)", () => {
  it("creates the chain segment-wise under MY DRIVE, chaining parent ids", async () => {
    const fetchFn = fetchMock(async (url: string, init: any) => {
      const u = decodeURIComponent(String(url));
      if (init.method === "GET") return res({ files: [] }); // every lookup misses
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        return res({ id: `id-${body.name}` });
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    });
    const target = new DriveSyncTarget(
      { clientId: "cid", clientSecret: "sec", refreshToken: "rtok", accessToken: "atok" } as any,
      fetchFn
    );

    await target.createFolder("Apps/Mein Wissen");

    const posts = fetchFn.mock.calls.filter((c: any) => c[1].method === "POST").map((c: any) => JSON.parse(c[1].body));
    expect(posts).toEqual([
      { name: "Apps", mimeType: "application/vnd.google-apps.folder", parents: ["root"] },
      { name: "Mein Wissen", mimeType: "application/vnd.google-apps.folder", parents: ["id-Apps"] },
    ]);
  });

  it("reuses an existing segment instead of duplicating it", async () => {
    const fetchFn = fetchMock(async (url: string, init: any) => {
      const u = decodeURIComponent(String(url));
      if (init.method === "GET" && u.includes("name='Apps'")) return res({ files: [{ id: "f-apps" }] });
      if (init.method === "GET") return res({ files: [] });
      if (init.method === "POST") return res({ id: "f-new" });
      throw new Error(`unexpected ${init.method} ${u}`);
    });
    const target = new DriveSyncTarget(
      { clientId: "cid", clientSecret: "sec", refreshToken: "rtok", accessToken: "atok" } as any,
      fetchFn
    );

    await target.createFolder("Apps/Neu");

    const posts = fetchFn.mock.calls.filter((c: any) => c[1].method === "POST").map((c: any) => JSON.parse(c[1].body));
    expect(posts).toEqual([
      { name: "Neu", mimeType: "application/vnd.google-apps.folder", parents: ["f-apps"] },
    ]);
  });
});

describe("OneDriveSyncTarget createFolder (picker, 2026-07-13)", () => {
  it("creates the chain relative to the DRIVE root and tolerates 409 (exists)", async () => {
    const fetchFn = fetchMock(async (url: string, init: any) => {
      if (init.method !== "POST") throw new Error(`unexpected ${init.method} ${url}`);
      // The first level already exists (409); the child is created fresh.
      return String(url).endsWith("/me/drive/root/children") ? res({}, { status: 409 }) : res({ id: "i2" }, { status: 201 });
    });
    const target = new OneDriveSyncTarget(
      { clientId: "cid", refreshToken: "rtok", accessToken: "atok" } as any,
      fetchFn
    );

    await target.createFolder("Apps/Mein Wissen");

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[0][0])).toMatch(/\/me\/drive\/root\/children$/);
    expect(String(fetchFn.mock.calls[1][0])).toMatch(/\/me\/drive\/root:\/Apps:\/children$/);
    const second = JSON.parse((fetchFn.mock.calls[1][1] as any).body);
    expect(second).toMatchObject({ name: "Mein Wissen", folder: {} });
  });
});

describe("DropboxSyncTarget createFolder (picker, 2026-07-13)", () => {
  const makeTarget = (fetchImpl: any) => {
    const fetchFn = fetchMock(fetchImpl);
    const target = new DropboxSyncTarget(
      { appKey: "akey", refreshToken: "rtok", accessToken: "atok" } as any,
      fetchFn
    );
    return { target, fetchFn };
  };

  it("creates the folder with a root-absolute path", async () => {
    const { target, fetchFn } = makeTarget(async () => res({}));
    await target.createFolder("Apps/Mein Wissen");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain("files/create_folder_v2");
    expect(JSON.parse((fetchFn.mock.calls[0][1] as any).body)).toEqual({
      path: "/Apps/Mein Wissen",
      autorename: false,
    });
  });

  it("treats 409 (path/conflict = already exists) as success", async () => {
    const { target } = makeTarget(async () => res({ error_summary: "path/conflict/folder/" }, { status: 409 }));
    await expect(target.createFolder("Apps")).resolves.toBeUndefined();
  });
});

describe("S3SyncTarget createFolder (picker, 2026-07-13)", () => {
  it("PUTs a zero-byte folder-marker object independent of the configured prefix", async () => {
    const fetchFn = fetchMock(async () => res(""));
    const target = new S3SyncTarget(
      {
        endpoint: "https://s3.example.com",
        region: "us-east-1",
        bucket: "vaults",
        accessKeyId: "AK",
        secretAccessKey: "SK",
        forcePathStyle: true,
        prefix: "elsewhere",
      } as any,
      fetchFn,
      30000,
      () => new Date(Date.UTC(2026, 6, 13))
    );

    await target.createFolder("Apps/Mein Wissen");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(init.method).toBe("PUT");
    expect(String(url)).toContain("/vaults/");
    expect(String(url).endsWith("/Apps/Mein%20Wissen/")).toBe(true);
    expect(String(url)).not.toContain("elsewhere");
  });
});
