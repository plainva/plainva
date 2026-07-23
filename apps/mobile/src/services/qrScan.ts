import jsQR from "jsqr";

type DetectorCtor = new (options: { formats: string[] }) => {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};

/**
 * Decode a QR code from a captured photo (data URL), entirely on-device. Prefers
 * the WebView's native BarcodeDetector (present in the Android Chromium WebView)
 * and falls back to jsQR — a pure-JS decoder — where it is unavailable (iOS
 * WKWebView). No native barcode plugin, so this needs no Gradle/pod wiring; the
 * @capacitor/camera permission the app already declares covers the capture.
 * Returns the decoded text, or null when no QR is recognized.
 */
export async function decodeQrFromDataUrl(dataUrl: string): Promise<string | null> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const Detector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (Detector) {
      const found = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      if (found[0]?.rawValue) return found[0].rawValue;
    }
  } catch {
    // Native detector unavailable or failed — fall through to jsQR.
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const decoded = jsQR(image.data, image.width, image.height);
  return decoded?.data ?? null;
}
