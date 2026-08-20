import jsQR from "jsqr";

type QrDetector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (options: { formats: string[] }) => QrDetector;

let cachedDetector: QrDetector | null | undefined;
function getDetector(): QrDetector | null {
  if (cachedDetector !== undefined) return cachedDetector;
  const Ctor = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  cachedDetector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
  return cachedDetector;
}

/**
 * Decode a QR code from a LIVE <video> frame, on-device and offline. The caller
 * drives this in a short loop against the camera preview, so recognition is
 * continuous and needs no photo capture. Prefers the WebView's native
 * BarcodeDetector (fast, present in the Android Chromium WebView) and falls back
 * to jsQR — a pure-JS decoder — where it is unavailable (iOS WKWebView). Returns
 * the decoded text, or null when no QR is in the current frame. Never throws.
 */
export async function decodeQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<string | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const det = getDetector();
  if (det) {
    try {
      const found = await det.detect(video);
      return found[0]?.rawValue ?? null;
    } catch {
      // Native detector unavailable or failed — drop it and use jsQR from here on.
      cachedDetector = null;
    }
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return jsQR(image.data, image.width, image.height)?.data ?? null;
}
