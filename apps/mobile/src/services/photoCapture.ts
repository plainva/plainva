import { CameraErrorCode, type MediaResult } from "@capacitor/camera";

type NativeReadResult = { data: string | Blob };

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

/** Reads the full native result; the Web fallback carries its bytes as thumbnail. */
export async function mediaResultBytes(
  media: MediaResult,
  readNative: (uri: string) => Promise<NativeReadResult>,
): Promise<Uint8Array> {
  if (media.uri) {
    const { data } = await readNative(media.uri);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return base64ToBytes(data);
  }
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
): Promise<string> {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const ext = photoExtension(media);
  const base = `Attachments/Photo-${stamp}`;
  let path = `${base}.${ext}`;
  for (let n = 2; await exists(path); n++) path = `${base}-${n}.${ext}`;
  return path;
}
