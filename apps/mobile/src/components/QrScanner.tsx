import { Camera } from "@capacitor/camera";
import { QrScanner as SharedQrScanner } from "@plainva/ui";

/**
 * The phone's QR scanner: the shared component plus Capacitor's permission
 * prompt. The WebView will not hand out a stream on Android until the app has
 * asked, which is the one platform-specific step (the desktop's WebView asks
 * for itself).
 */
export function QrScanner({ onDecode, onClose }: { onDecode: (value: string) => void; onClose: () => void }) {
  return (
    <SharedQrScanner
      classes={{ root: "m-qr-scanner", video: "m-qr-video", frame: "m-qr-frame", fallback: "m-qr-fallback", bar: "m-qr-bar" }}
      onClose={onClose}
      onDecode={onDecode}
      requestPermission={async () => {
        await Camera.requestPermissions({ permissions: ["camera"] });
      }}
    />
  );
}
