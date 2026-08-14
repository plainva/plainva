import { describe, expect, it, vi, beforeEach } from "vitest";

const stat = vi.fn();
const digest = vi.fn();
const request = vi.fn();
let native = true;

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { stat: (...a: any[]) => stat(...a) },
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../platform/atomicFile", () => ({ nativeFileDigest: (...a: any[]) => digest(...a) }));
vi.mock("./webdavHttp", () => ({ webdavRequest: (...a: any[]) => request(...a) }));

const { createContentRefResolver, mobileSyncUploader } = await import("./syncUpload");

describe("mobile streamed uploads (issue #48)", () => {
  beforeEach(() => {
    native = true;
    stat.mockReset();
    digest.mockReset();
    request.mockReset();
  });

  it("describes a large file by handle, hashed natively", async () => {
    stat.mockResolvedValue({ type: "file", size: 90 * 1024 * 1024 });
    digest.mockResolvedValue({ sha256: "d".repeat(64), size: 90 * 1024 * 1024 });

    const ref = await createContentRefResolver("vaults/v1")("Attachments/video.mp4", 8 * 1024 * 1024);

    // The path the native side resolves inside Directory.Data.
    expect(stat).toHaveBeenCalledWith({ path: "vaults/v1/Attachments/video.mp4", directory: "DATA" });
    expect(digest).toHaveBeenCalledWith("vaults/v1/Attachments/video.mp4");
    expect(ref).toEqual({
      rootId: "vaults/v1",
      relPath: "Attachments/video.mp4",
      size: 90 * 1024 * 1024,
      sha256: "d".repeat(64),
    });
  });

  it("leaves a small file alone and never hashes it", async () => {
    stat.mockResolvedValue({ type: "file", size: 1024 });
    expect(await createContentRefResolver("vault")("note.md", 8 * 1024 * 1024)).toBeNull();
    expect(digest).not.toHaveBeenCalled();
  });

  it("falls back to the buffer instead of failing the sync", async () => {
    stat.mockRejectedValue(new Error("gone"));
    expect(await createContentRefResolver("vault")("note.md", 1)).toBeNull();
  });

  it("does not stream on the web dev server", async () => {
    native = false;
    expect(await createContentRefResolver("vault")("big.bin", 1)).toBeNull();
    expect(stat).not.toHaveBeenCalled();
  });

  it("sends a byte range without putting the content in the message", async () => {
    request.mockResolvedValue({ status: 202, headers: { etag: '"x"' }, body: "" });

    const res = await mobileSyncUploader({
      ref: { rootId: "vaults/v1", relPath: "Attachments/video.mp4", size: 100, sha256: "e".repeat(64) },
      url: "https://dav.example.com/video.mp4",
      method: "PUT",
      headers: { Authorization: "Basic x" },
      offset: 40,
      length: 20,
    });

    const args = request.mock.calls[0][0];
    expect(args.bodyFilePath).toBe("vaults/v1/Attachments/video.mp4");
    expect(args.bodyOffset).toBe(40);
    expect(args.bodyLength).toBe(20);
    expect("body" in args).toBe(false);
    expect(res).toEqual({ status: 202, headers: { etag: '"x"' }, body: "" });
  });
});
