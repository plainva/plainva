import { describe, expect, it, vi } from "vitest";
import { CameraErrorCode, MediaType, type MediaResult } from "@capacitor/camera";
import { availablePhotoPath, cameraErrorMessage, isCameraCancellation, mediaResultBytes, photoExtension } from "./photoCapture";

const media = (extra: Partial<MediaResult> = {}): MediaResult => ({ type: MediaType.Photo, saved: false, ...extra });

describe("photoCapture", () => {
  it("recognizes only explicit native cancellations", () => {
    expect(isCameraCancellation({ code: CameraErrorCode.TakePhotoCancelled })).toBe(true);
    expect(isCameraCancellation({ code: CameraErrorCode.ChooseMediaCancelled })).toBe(true);
    expect(isCameraCancellation({ code: CameraErrorCode.CameraPermissionDenied })).toBe(false);
  });

  it("reads native URI data and the web thumbnail fallback", async () => {
    const read = vi.fn(async () => ({ data: btoa("native") }));
    expect(new TextDecoder().decode(await mediaResultBytes(media({ uri: "file://photo" }), read))).toBe("native");
    expect(read).toHaveBeenCalledWith("file://photo");
    expect(new TextDecoder().decode(await mediaResultBytes(media({ thumbnail: btoa("web") }), read))).toBe("web");
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
