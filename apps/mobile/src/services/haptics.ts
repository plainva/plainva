import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

/**
 * Tactile feedback at gesture thresholds (plan Mobile M3E, package A9).
 * Fire-and-forget by design: haptics must never block or break a gesture, so
 * every call swallows failures (web dev server, emulators without a vibrator,
 * users with system haptics off). Wired at: pull-to-refresh arming, long-press
 * sheets, block-handle drag pickup, board card drag (packages B/C/E).
 */
const native = Capacitor.isNativePlatform();

export const haptics = {
  /** Light tick — selection changes, pull-to-refresh arming. */
  light(): void {
    if (!native) return;
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  },
  /** Medium thud — a drag "picks up" (block handle, board card). */
  medium(): void {
    if (!native) return;
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  },
  /** Selection tick for continuous scrubs (date strip, reorder slots). */
  selection(): void {
    if (!native) return;
    void Haptics.selectionChanged().catch(() => {});
  },
};
