import { describe, expect, it, vi } from "vitest";
import { CameraErrorCode, MediaType, type MediaResult } from "@capacitor/camera";
import { availablePhotoPath, cameraErrorMessage, isCameraCancellation, localFileBytes, mediaResultBytes, photoExtension } from "./photoCapture";

const media = (extra: Partial<MediaResult> = {}): MediaResult => ({ type: MediaType.Photo, saved: false, ...extra });

describe("photoCapture", () => {
  it("recognizes only explicit native cancellations", () => {
    expect(isCameraCancellation({ code: CameraErrorCode.TakePhotoCancelled })).toBe(true);
    expect(isCameraCancellation({ code: CameraErrorCode.ChooseMediaCancelled })).toBe(true);
    expect(isCameraCancellation({ code: CameraErrorCode.CameraPermissionDenied })).toBe(false);
  });

  it("reads native URI data and the web thumbnail fallback", async () => {
    const read = vi.fn(async () => new TextEncoder().encode("native"));
    expect(new TextDecoder().decode(await mediaResultBytes(media({ uri: "file://photo" }), read))).toBe("native");
    expect(read).toHaveBeenCalledWith("file://photo");
    expect(new TextDecoder().decode(await mediaResultBytes(media({ thumbnail: btoa("web") }), read))).toBe("web");
  });

  it("reads a photo through the WebView's file server, never as one answer over the bridge (F54)", async () => {
    const { Capacitor } = await import("@capacitor/core");
    const served = vi.spyOn(Capacitor, "convertFileSrc").mockImplementation((uri) => uri.replace("file://", "https://localhost/_capacitor_file_"));
    const load = vi.fn(async (_url: string) => new Response(new Uint8Array([1, 2, 3])));
    expect([...(await localFileBytes("file:///data/photo.jpg", load))]).toEqual([1, 2, 3]);
    expect(load).toHaveBeenCalledWith("https://localhost/_capacitor_file_/data/photo.jpg");
    served.mockRestore();
    await expect(localFileBytes("file:///gone.jpg", async () => new Response(null, { status: 404 }))).rejects.toThrow("404");
    // Neither caller asks the Filesystem plugin for the picture any more.
    const { readFileSync } = await import("node:fs");
    for (const file of ["../EditorHost.tsx", "../components/JournalCaptureSheet.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/mediaResultBytes\([^)]*Filesystem\.readFile/);
    }
  });

  it("builds a unique normalized attachment name", async () => {
    expect(photoExtension(media({ metadata: { format: "jpeg" } }))).toBe("jpg");
    const exists = vi.fn(async (path: string) => !path.endsWith("-2.jpg"));
    await expect(availablePhotoPath(exists, media({ metadata: { format: "jpeg" } }), new Date("2026-07-22T10:11:12Z")))
      .resolves.toBe("Attachments/Photo-2026-07-22-10-11-12-2.jpg");
  });

  it("keeps structured error details", () => {
    expect(cameraErrorMessage({ code: "OS-PLUG-CAMR-0003", message: "permission denied" }))
      .toBe("OS-PLUG-CAMR-0003: permission denied");
  });
});
