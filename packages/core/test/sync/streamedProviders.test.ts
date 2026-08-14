import { describe, expect, it, vi } from "vitest";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.ts";
import { OneDriveSyncTarget } from "../../src/sync/OneDriveSyncTarget.ts";
import { DropboxSyncTarget } from "../../src/sync/DropboxSyncTarget.ts";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.ts";
import type { SyncContentRef } from "../../src/sync/ISyncTarget.ts";

/**
 * Every provider must be able to send a large file without its bytes passing
 * through the webview (issue #48). What differs is only HOW: a plain PUT, a
 * chunk session, or a metadata-then-content pair.
 */

const ref: SyncContentRef = {
  rootId: "root-1",
  relPath: "Attachments/video.mp4",
  size: 90 * 1024 * 1024,
  sha256: "c".repeat(64),
};

function op(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    file_path: "Attachments/video.mp4",
    operation: "write" as const,
    contentRef: ref,
    retry_count: 0,
    next_retry_at: 0,
    queued_at: 0,
    ...overrides,
  };
}

function uploaderAnswering(answers: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  const queue = [...answers];
  return vi.fn(async (args: any) => {
    void args;
    const next = queue.shift() ?? answers[answers.length - 1];
    return { status: next.status, headers: next.headers ?? {}, body: next.body ?? "" };
  });
}

describe("S3", () => {
  it("streams a single PUT and signs it with the hash it already has", async () => {
    // SigV4 signs the payload HASH, and the ref carries it from the native
    // pass — so no multipart upload and no UNSIGNED-PAYLOAD are needed.
    const fetchFn = vi.fn();
    const uploader = uploaderAnswering([{ status: 200, headers: { etag: '"s3-etag"' } }]);
    const target = new S3SyncTarget(
      {
        endpoint: "http://127.0.0.1:9000",
        region: "us-east-1",
        bucket: "vault",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
      },
      fetchFn as any,
      30000,
      () => new Date("2026-08-14T00:00:00Z"),
      uploader as any,
    );

    const res = await target.push(op() as any);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(uploader).toHaveBeenCalledTimes(1);
    const args = uploader.mock.calls[0][0] as any;
    expect(args.method).toBe("PUT");
    expect(args.headers["x-amz-content-sha256"]).toBe(ref.sha256);
    expect(args.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(res).toEqual({ etag: "s3-etag" });
  });

  it("announces streaming only with an uploader", () => {
    const creds = {
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "vault",
      accessKeyId: "A",
      secretAccessKey: "s",
    };
    expect(new S3SyncTarget(creds, vi.fn() as any).acceptsContentRef).toBe(false);
    expect(
      new S3SyncTarget(creds, vi.fn() as any, 30000, undefined, vi.fn() as any).acceptsContentRef,
    ).toBe(true);
  });
});

describe("OneDrive", () => {
  it("streams every session chunk by byte range", async () => {
    const CHUNK = 16 * 320 * 1024;
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ uploadUrl: "https://upload.example/session" }),
    });
    const chunks = Math.ceil(ref.size / CHUNK);
    const answers = Array.from({ length: chunks }, (_, i) =>
      i === chunks - 1
        ? { status: 201, body: JSON.stringify({ id: "item-1", eTag: '"od"', size: ref.size }) }
        : { status: 202 },
    );
    const uploader = uploaderAnswering(answers);
    const target = new OneDriveSyncTarget(
      { clientId: "c", refreshToken: "r", accessToken: "a" },
      fetchFn as any,
      30000,
      uploader as any,
    );

    const res = await target.push(op() as any);

    // Only the session creation goes through fetch; no chunk does.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(uploader).toHaveBeenCalledTimes(chunks);
    const first = uploader.mock.calls[0][0] as any;
    expect(first.offset).toBe(0);
    expect(first.length).toBe(CHUNK);
    expect(first.headers["Content-Range"]).toBe(`bytes 0-${CHUNK - 1}/${ref.size}`);
    const last = uploader.mock.calls[chunks - 1][0] as any;
    expect(last.offset + last.length).toBe(ref.size);
    expect(res).toEqual({ etag: '"od"', remoteId: "item-1" });
  });
});

describe("Dropbox", () => {
  it("streams start, append and finish of the upload session", async () => {
    // Tiny limits so the session runs in three steps without a 90 MB fixture.
    const smallRef: SyncContentRef = { ...ref, size: 25 };
    const uploader = uploaderAnswering([
      { status: 200, body: JSON.stringify({ session_id: "s-1" }) },
      { status: 200 },
      { status: 200, body: JSON.stringify({ id: "id:1", rev: "r1", size: 25, path_lower: "/x" }) },
    ]);
    const fetchFn = vi.fn();
    const target = new DropboxSyncTarget(
      { appKey: "k", refreshToken: "r", accessToken: "a" },
      fetchFn as any,
      30000,
      { simpleUpload: 10, chunk: 10 },
      uploader as any,
    );

    await target.push(op({ contentRef: smallRef }) as any);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(uploader).toHaveBeenCalledTimes(3);
    const calls = uploader.mock.calls.map((c) => c[0] as any);
    expect(calls.map((c) => [c.offset, c.length])).toEqual([
      [0, 10],
      [10, 10],
      [20, 5],
    ]);
    // The whole file is covered exactly once, with no gap and no overlap.
    expect(calls[2].offset + calls[2].length).toBe(smallRef.size);
  });
});

describe("Google Drive", () => {
  it("creates the file from metadata and then streams the content", async () => {
    // Multipart puts the bytes in the middle of a composed body, which cannot
    // be streamed — so the create becomes metadata + media PATCH.
    const fetchFn = vi.fn(async (url: string) => {
      const decoded = decodeURIComponent(url);
      // The root folder lookup finds it; the file itself does not exist yet.
      if (decoded.includes("mimeType='application/vnd.google-apps.folder'")) {
        return { ok: true, status: 200, json: async () => ({ files: [{ id: "folder-1", name: "Plainva" }] }) };
      }
      if (url.includes("/files?fields=id")) {
        return { ok: true, status: 200, json: async () => ({ id: "new-1" }) };
      }
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    });
    const uploader = uploaderAnswering([
      { status: 200, body: JSON.stringify({ id: "new-1", md5Checksum: "md5-1" }) },
    ]);
    const target = new DriveSyncTarget(
      { clientId: "c", clientSecret: "s", refreshToken: "r", accessToken: "a" },
      fetchFn as any,
      30000,
      uploader as any,
    );

    const res = await target.push(op({ file_path: "video.mp4" }) as any);

    expect(uploader).toHaveBeenCalledTimes(1);
    const args = uploader.mock.calls[0][0] as any;
    expect(args.method).toBe("PATCH");
    expect(args.url).toContain("uploadType=media");
    expect(args.url).toContain("/files/new-1");
    // No multipart body was ever composed.
    const bodies = fetchFn.mock.calls.map((c: any) => c[1]?.body).filter(Boolean);
    expect(bodies.every((b: any) => typeof b === "string")).toBe(true);
    expect(res).toEqual({ etag: "md5-1", remoteId: "new-1" });
  });
});
