import { attachmentFolderFor, uniqueAttachmentPath } from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { Capacitor } from "@capacitor/core";
import { CameraErrorCode, type MediaResult } from "@capacitor/camera";


export function isCameraCancellation(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === CameraErrorCode.TakePhotoCancelled || code === CameraErrorCode.ChooseMediaCancelled;
}

export function cameraErrorMessage(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code ?? "").trim();
  const message = error instanceof Error
    ? error.message.trim()
    : String((error as { message?: unknown } | null)?.message ?? "").trim();
  return code && message ? `${code}: ${message}` : message || code || "Camera operation failed";
}

function base64ToBytes(value: string): Uint8Array {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * A picture's bytes through the WebView's own file server
 * (`Capacitor.convertFileSrc`), as an `<img>` gets them - never as one base64
 * answer over the bridge, which Android parses on its UI thread (release
 * list F54, the class of F51). A camera photo is several megabytes.
 */
export async function localFileBytes(uri: string, load: (url: string) => Promise<Response> = (url) => fetch(url)): Promise<Uint8Array> {
  const response = await load(Capacitor.convertFileSrc(uri));
  if (!response.ok) throw new Error(`the picture could not be read (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The full picture of a camera or gallery result; the web fallback carries its bytes as thumbnail. */
export async function mediaResultBytes(
  media: MediaResult,
  readLocal: (uri: string) => Promise<Uint8Array> = localFileBytes,
): Promise<Uint8Array> {
  if (media.uri) return readLocal(media.uri);
  if (media.thumbnail) return base64ToBytes(media.thumbnail);
  throw new Error("Camera returned neither a file URI nor image data");
}

export function photoExtension(media: MediaResult): string {
  const raw = (media.metadata?.format || "jpeg").toLowerCase().replace(/^image\//, "");
  return raw === "jpeg" ? "jpg" : raw.replace(/[^a-z0-9]/g, "") || "jpg";
}

export async function availablePhotoPath(
  exists: (path: string) => Promise<boolean>,
  media: MediaResult,
  now = new Date(),
  folder = getMobileSettings().attachmentFolder,
): Promise<string> {
  // The folder is a setting now (S17) and shared with the desktop, so a photo
  // taken here and a screenshot dropped there land in the same place. The name
  // stays a timestamp: a camera hands over bytes, not a file name.
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return uniqueAttachmentPath(
    attachmentFolderFor(folder, ""),
    `Photo-${stamp}.${photoExtension(media)}`,
    exists,
  );
}
