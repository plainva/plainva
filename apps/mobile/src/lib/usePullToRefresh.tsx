import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptics } from "../services/haptics";
import { getSyncStatus, subscribeSyncStatus, syncNow } from "../services/syncService";

/**
 * Pull-to-refresh on the list screens (R3.8, decision E6): an overscroll at
 * the top of the page pulls a Material-style indicator; past the threshold
 * the release triggers a sync (full listing) + re-query. The editor stays
 * intentionally free of it (gesture conflicts with text selection).
 */

/** Dampened pull distance (px) from a raw downward finger travel. */
export function pullDistance(dy: number): number {
  return Math.max(0, Math.min(dy * 0.5, 96));
}

export const PULL_THRESHOLD = 64;

/** Resolves once the running sync cycle settles (or the timeout passes). */
function waitForSyncSettled(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const check = () => {
      if (getSyncStatus().status !== "syncing") done();
    };
    const unsubscribe = subscribeSyncStatus(check);
    const timer = setTimeout(done, timeoutMs);
    // Give triggerImmediate a beat to flip the status to "syncing" first.
    setTimeout(check, 600);
  });
}

/** Shared refresh action: sync (when configured) + notify every list. */
export async function refreshVaultAction(): Promise<void> {
  if (getSyncStatus().status !== "off") {
    try {
      syncNow();
    } catch {
      /* a failed trigger must not wedge the indicator */
    }
    await waitForSyncSettled(8000);
  } else {
    await new Promise((r) => setTimeout(r, 400));
  }
  window.dispatchEvent(new CustomEvent("m-vault-changed"));
}

/**
 * Wires the gesture onto the caller-owned scroll container ref and returns
 * the indicator node to render as the page's first child. (The caller owns
 * the ref so `ref={...}` stays a plain local — the react-compiler lint
 * rejects refs reached through a hook-returned object.)
 */
export function usePullToRefresh(
  ref: React.RefObject<HTMLDivElement | null>,
  onRefresh: () => Promise<void> = refreshVaultAction,
): ReactNode {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY = 0;
    let tracking = false;
    let dist = 0;

    const run = async () => {
      busyRef.current = true;
      setBusy(true);
      try {
        await onRefreshRef.current();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || el.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      tracking = true;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || busyRef.current) return;
      const dy = e.touches[0].clientY - startY;
      if (el.scrollTop > 0 || dy <= 0) {
        dist = 0;
        setPull(0);
        return;
      }
      const prev = dist;
      dist = pullDistance(dy);
      // Own the gesture: without this the browser rubber-bands instead.
      if (dist > 0 && e.cancelable) e.preventDefault();
      // One tactile tick exactly when the pull arms (crosses the threshold).
      if (prev < PULL_THRESHOLD && dist >= PULL_THRESHOLD) haptics.light();
      setPull(dist);
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (dist >= PULL_THRESHOLD && !busyRef.current) void run();
      dist = 0;
      setPull(0);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref]);

  const visible = busy || pull > 8;
  return visible ? (
    <div aria-hidden className="m-ptr" style={{ height: busy ? 48 : pull }}>
      <span className={`m-ptr-circle${busy || pull >= PULL_THRESHOLD ? " is-spin" : ""}`} />
    </div>
  ) : null;
}
