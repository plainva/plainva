import { useEffect, useRef, useState } from "react";
import { CameraOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { decodeQrFromVideo } from "../lib/qrScan";
import { ICON } from "../lib/iconSizes";
import { IconButton } from "./ui";

/**
 * Live QR scanner: a camera preview that recognises a code continuously (no
 * photo capture), on the shared decoder (BarcodeDetector + jsQR).
 *
 * Shared by both shells (2026-08-20). The phone shipped it first and the
 * catalog assumed it could not move because it asks @capacitor/camera for
 * permission — but that is one call, so it comes in as a hook instead: the
 * phone passes Capacitor's request, the desktop passes nothing because
 * WebView2 and WKWebView prompt on the first getUserMedia themselves.
 *
 * Class names come from the caller rather than a prefix built at runtime:
 * a computed `${prefix}-video` would be invisible to the class-existence
 * guard, which is exactly the check that keeps a renamed style from silently
 * leaving a surface unstyled.
 *
 * Calls onDecode exactly once, then closes; onClose backs out. On any camera
 * failure it shows the reason so the caller's manual paste stays the fallback.
 */
export interface QrScannerClasses {
  root: string;
  video: string;
  frame: string;
  fallback: string;
  bar: string;
}

export function QrScanner({
  onDecode,
  onClose,
  classes,
  requestPermission,
}: {
  onDecode: (value: string) => void;
  onClose: () => void;
  classes: QrScannerClasses;
  /** Platform permission prompt, where the platform needs one before the stream. */
  requestPermission?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDecodeRef = useRef(onDecode);
  const permissionRef = useRef(requestPermission);
  useEffect(() => {
    onDecodeRef.current = onDecode;
    permissionRef.current = requestPermission;
  });
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
        await permissionRef.current?.().catch(() => undefined);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
        if (done) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => undefined); }
        timer = setTimeout(() => void scanOnce(), 300);
      } catch {
        setError(t("workspaceSecurity.qrCameraFailed"));
      }
    })();

    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={classes.root}>
      {/* On failure the <video> stays UNMOUNTED: an Android WebView paints its
          play-button placeholder over a stream-less video, which read as a
          broken screen (maintainer 2026-07-25). Show the reason instead. */}
      {error ? (
        <div className={classes.fallback}>
          <CameraOff size={ICON.empty} />
          <p>{error}</p>
        </div>
      ) : (
        <>
          <video ref={videoRef} className={classes.video} playsInline muted />
          <div className={classes.frame} />
        </>
      )}
      <div className={classes.bar}>
        <span>{error ? null : t("workspaceSecurity.qrScanning")}</span>
        <IconButton label={t("common.cancel")} onClick={onClose}><X size={ICON.head} /></IconButton>
      </div>
    </div>
  );
}
