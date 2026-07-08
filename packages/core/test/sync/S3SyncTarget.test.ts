import { describe, it, expect, vi } from "vitest";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.js";
import { sha256Hex } from "../../src/sync/sigv4.js";
import type { FetchFn } from "../../src/sync/WebDavSyncTarget.js";

function res(opts: { status?: number; body?: string | Uint8Array; headers?: Record<string, string> } = {}) {
  const status = opts.status ?? 200;
  const headerMap = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (k: string) => headerMap.get(k.toLowerCase()) ?? null },
    text: async () =>
      typeof opts.body === "string" ? opts.body : new TextDecoder().decode(opts.body ?? new Uint8Array()),
    arrayBuffer: async () => {
      if (opts.body instanceof Uint8Array) {
        return opts.body.buffer.slice(opts.body.byteOffset, opts.body.byteOffset + opts.body.byteLength);
      }
      return new TextEncoder().encode(String(opts.body ?? "")).buffer;
    },
  } as any;
}

function listXml(entries: { key: string; etag?: string }[], nextToken?: string): string {
  const contents = entries
    .map(
      (e) =>
        `<Contents><Key>${e.key}</Key><ETag>&quot;${e.etag ?? "etag-" + e.key}&quot;</ETag><LastModified>2026-07-04T00:00:00Z</LastModified></Contents>`
    )
    .join("");
  const truncated = nextToken
    ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${nextToken}</NextContinuationToken>`
    : `<IsTruncated>false</IsTruncated>`;
  return `<?xml version="1.0"?><ListBucketResult>${truncated}${contents}</ListBucketResult>`;
}

const CREDS = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "vault",
  accessKeyId: "minio",
  secretAccessKey: "minio-secret",
};

function makeTarget(fetchImpl: any, creds: Partial<typeof CREDS> & Record<string, unknown> = {}) {
  const fetchFn = vi.fn<FetchFn>(fetchImpl);
  const target = new S3SyncTarget({ ...CREDS, ...creds } as any, fetchFn, 30000, () => new Date(Date.UTC(2026, 6, 4)));
  return { target, fetchFn };
}

function calls(fetchFn: any): { method: string; url: string; init: any }[] {
  return fetchFn.mock.calls.map(([url, init]: [string, any]) => ({ method: init.method, url, init }));
}

describe("S3SyncTarget", () => {
  it("pulls a paginated listing into a prefix-relative etag map, skipping folder markers and .CONFLICT", async () => {
    const { target, fetchFn } = makeTarget(async (url: string) => {
      if (url.includes("continuation-token=next-1")) {
        return res({ body: listXml([{ key: "notes/sub/b.md", etag: "e2" }]) });
      }
      return res({
        body: listXml(
          [
            { key: "notes/a.md", etag: "e1" },
            { key: "notes/folder/", etag: "marker" },
            { key: "notes/x.CONFLICT-2026.md", etag: "c" },
            { key: "other/outside.md", etag: "o" },
          ],
          "next-1"
        ),
      });
    });
    const t = new S3SyncTarget({ ...CREDS, prefix: "notes" }, fetchFn as any, 30000, () => new Date());
    const result = await t.pull();

    expect(result.etagMap.get("a.md")).toBe("e1");
    expect(result.etagMap.get("sub/b.md")).toBe("e2");
    expect(result.etagMap.size).toBe(2);
    expect(result.nextCursor).toBeUndefined();

    const first = calls(fetchFn)[0];
    expect(first.method).toBe("GET");
    expect(first.url).toContain("http://127.0.0.1:9000/vault/?");
    expect(first.url).toContain("list-type=2");
    expect(first.url).toContain("prefix=notes%2F");
    expect(first.init.headers["Authorization"]).toContain("AWS4-HMAC-SHA256 Credential=minio/");
    void target;
  });

  it("downloads bytes and maps 404 to null", async () => {
    const bytes = new TextEncoder().encode("content");
    const { target } = makeTarget(async (url: string) =>
      url.endsWith("/vault/a.md") ? res({ body: bytes }) : res({ status: 404 })
    );
    expect(await target.download("a.md")).toEqual(bytes);
    expect(await target.download("missing.md")).toBeNull();
  });

  it("pushes a write as signed PUT with payload hash, unsigned content-type and returns the ETag", async () => {
    const content = new TextEncoder().encode("hello");
    const { target, fetchFn } = makeTarget(async () => res({ headers: { ETag: '"abc123"' } }));
    const result = await target.push({
      id: 1,
      file_path: "notes/hello.md",
      operation: "write",
      content,
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });

    expect(result).toEqual({ etag: "abc123" });
    const call = calls(fetchFn)[0];
    expect(call.method).toBe("PUT");
    expect(call.url).toBe("http://127.0.0.1:9000/vault/notes/hello.md");
    expect(call.init.headers["x-amz-content-sha256"]).toBe(await sha256Hex(content));
    expect(call.init.headers["Content-Type"]).toBe("text/markdown");
    // Content-Type must NOT be signed (HTTP layers may rewrite it).
    expect(call.init.headers["Authorization"]).not.toContain("content-type");
    expect(call.init.body).toBe(content);
  });

  it("deletes a plain file (empty child sweep, then exact-key DELETE)", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "GET") return res({ body: listXml([]) });
      return res({ status: 204 });
    });
    await target.push({ id: 1, file_path: "a.md", operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 });

    const seq = calls(fetchFn);
    expect(seq.map((c) => c.method)).toEqual(["GET", "DELETE"]);
    expect(seq[1].url).toBe("http://127.0.0.1:9000/vault/a.md");
  });

  it("deletes a folder by sweeping all keys under its prefix", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "GET") {
        return res({ body: listXml([{ key: "dir/a.md" }, { key: "dir/sub/b.md" }]) });
      }
      return res({ status: 204 });
    });
    await target.push({ id: 1, file_path: "dir", operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 });

    const deletes = calls(fetchFn).filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url)).toEqual([
      "http://127.0.0.1:9000/vault/dir/a.md",
      "http://127.0.0.1:9000/vault/dir/sub/b.md",
      "http://127.0.0.1:9000/vault/dir",
    ]);
    const list = calls(fetchFn)[0];
    expect(list.url).toContain("prefix=dir%2F");
  });

  it("renames a file via signed copy + delete and returns the copy ETag", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "HEAD") return res({ status: 200 });
      if (init.method === "PUT") {
        return res({ body: `<CopyObjectResult><ETag>&quot;new-etag&quot;</ETag></CopyObjectResult>` });
      }
      return res({ status: 204 });
    });
    const result = await target.push({
      id: 1,
      file_path: "old name.md",
      operation: "rename",
      new_path: "new name.md",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });

    expect(result).toEqual({ etag: "new-etag" });
    const seq = calls(fetchFn);
    expect(seq.map((c) => c.method)).toEqual(["HEAD", "PUT", "DELETE"]);
    expect(seq[1].url).toBe("http://127.0.0.1:9000/vault/new%20name.md");
    expect(seq[1].init.headers["x-amz-copy-source"]).toBe("/vault/old%20name.md");
    // x-amz-* headers must be signed.
    expect(seq[1].init.headers["Authorization"]).toContain("x-amz-copy-source");
    expect(seq[2].url).toBe("http://127.0.0.1:9000/vault/old%20name.md");
  });

  it("renames a folder by copy+delete of every key under the old prefix", async () => {
    const { target, fetchFn } = makeTarget(async (url: string, init: any) => {
      if (init.method === "HEAD") return res({ status: 404 });
      if (init.method === "GET") {
        return res({ body: listXml([{ key: "old/a.md" }, { key: "old/sub/b.md" }]) });
      }
      if (init.method === "PUT") return res({ body: "<CopyObjectResult></CopyObjectResult>" });
      return res({ status: 204 });
    });
    await target.push({
      id: 1,
      file_path: "old",
      operation: "rename",
      new_path: "new",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });

    const puts = calls(fetchFn).filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.url)).toEqual([
      "http://127.0.0.1:9000/vault/new/a.md",
      "http://127.0.0.1:9000/vault/new/sub/b.md",
    ]);
    expect(puts[0].init.headers["x-amz-copy-source"]).toBe("/vault/old/a.md");
    const deletes = calls(fetchFn).filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url)).toEqual([
      "http://127.0.0.1:9000/vault/old/a.md",
      "http://127.0.0.1:9000/vault/old/sub/b.md",
    ]);
  });

  it("uses virtual-hosted URLs when forcePathStyle is false", async () => {
    const { target, fetchFn } = makeTarget(
      async () => res({ body: listXml([{ key: "a.md", etag: "e1" }]) }),
      { endpoint: "https://s3.eu-central-1.amazonaws.com", forcePathStyle: false }
    );
    const result = await target.pull();
    expect(result.etagMap.get("a.md")).toBe("e1");
    const call = calls(fetchFn)[0];
    expect(call.url.startsWith("https://vault.s3.eu-central-1.amazonaws.com/?")).toBe(true);
  });

  it("skips .CONFLICT files on push and download", async () => {
    const { target, fetchFn } = makeTarget(async () => res({}));
    await target.push({
      id: 1,
      file_path: "x.CONFLICT-1.md",
      operation: "write",
      content: new Uint8Array(),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    expect(await target.download("x.CONFLICT-1.md")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws on a failed listing so the worker backoff kicks in", async () => {
    const { target } = makeTarget(async () => res({ status: 403 }));
    await expect(target.pull()).rejects.toThrow("S3 list failed: 403");
  });

  describe("listFolders (settings picker, 2026-07-06)", () => {
    const prefixesXml = (echoPrefix: string, prefixes: string[], nextToken?: string) => {
      const cps = prefixes.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("");
      const truncated = nextToken
        ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${nextToken}</NextContinuationToken>`
        : `<IsTruncated>false</IsTruncated>`;
      // The response echoes the request prefix in a TOP-LEVEL <Prefix> — the
      // parser must not mistake it for a child folder.
      return `<?xml version="1.0"?><ListBucketResult><Prefix>${echoPrefix}</Prefix>${truncated}${cps}</ListBucketResult>`;
    };

    it("lists bucket-root folders via delimiter listing (paginated, sorted)", async () => {
      const { target, fetchFn } = makeTarget(async (url: string) => {
        if (url.includes("continuation-token=tok-1")) {
          return res({ body: prefixesXml("", ["alpha/"]) });
        }
        return res({ body: prefixesXml("", ["vault/", "media%test/".replace("%", "&amp;")], "tok-1") });
      });
      const names = await target.listFolders("");
      expect(names).toEqual(["alpha", "media&test", "vault"]);
      const first = calls(fetchFn)[0];
      expect(first.url).toContain("delimiter=%2F");
      expect(first.url).toContain("list-type=2");
      expect(first.url).not.toContain("prefix=");
    });

    it("lists a subfolder level and strips the parent prefix (ignoring creds.prefix)", async () => {
      const fetchFn = vi.fn(async (_url: string) => res({ body: prefixesXml("vault/notes/", ["vault/notes/sub/", "vault/notes/zz/"]) }));
      const t = new S3SyncTarget({ ...CREDS, prefix: "somewhere-else" }, fetchFn as any, 30000, () => new Date());
      const names = await t.listFolders("vault/notes");
      expect(names).toEqual(["sub", "zz"]);
      const url = String(fetchFn.mock.calls[0][0]);
      expect(url).toContain("prefix=vault%2Fnotes%2F");
    });

    it("throws on a failed listing", async () => {
      const { target } = makeTarget(async () => res({ status: 403 }));
      await expect(target.listFolders("")).rejects.toThrow("S3 list failed: 403");
    });
  });
});
