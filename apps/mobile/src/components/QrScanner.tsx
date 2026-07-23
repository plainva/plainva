import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Camera } from "@capacitor/camera";
import { useTranslation } from "react-i18next";
import { decodeQrFromVideo } from "../services/qrScan";

/**
 * Full-screen live QR scanner: a camera preview that recognizes a QR code
 * continuously (no photo capture). Uses getUserMedia (the app already declares
 * the camera permission via @capacitor/camera, which we request first so the
 * WebView grants the stream) and the shared decoder (BarcodeDetector + jsQR).
 * Calls onDecode exactly once with the decoded text, then closes; onClose backs
 * out. On any camera failure it shows a hint so the caller's manual paste stays
 * the fallback.
 */
export function QrScanner({ onDecode, onClose }: { onDecode: (value: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDecodeRef = useRef(onDecode);
  useEffect(() => { onDecodeRef.current = onDecode; });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const canvas = document.createElement("canvas");

    const cleanup = () => {
      done = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };

    const scanOnce = async () => {
      if (done) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const value = await decodeQrFromVideo(video, canvas);
        if (value && !done) { cleanup(); onDecodeRef.current(value.trim()); return; }
      }
      if (!done) timer = setTimeout(() => void scanOnce(), 250);
    };

    void (async () => {
      try {
        await Camera.requestPermissions({ permissions: ["camera"] }).catch(() => undefined);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
        if (done) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => undefined); }
        timer = setTimeout(() => void scanOnce(), 300);
      } catch {
        setError(t("workspaceSecurity.qrCameraFailed", { defaultValue: "Camera unavailable — paste the code instead." }));
      }
    })();

    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="m-qr-scanner">
      <video ref={videoRef} className="m-qr-video" playsInline muted />
      <div className="m-qr-frame" />
      <div className="m-qr-bar">
        <span>{error ?? t("workspaceSecurity.qrScanning", { defaultValue: "Point the camera at the QR code" })}</span>
        <button className="m-iconbtn" aria-label={t("common.cancel", { defaultValue: "Cancel" })} onClick={onClose}><X size={20} /></button>
      </div>
    </div>
  );
}
