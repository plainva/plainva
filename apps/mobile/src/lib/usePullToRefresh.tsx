import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptics } from "../services/haptics";
import { getSyncStatus, subscribeSyncStatus, syncNow } from "../services/syncService";

/**
 * Pull-to-refresh on the list screens (R3.8, decision E6): an overscroll at
 * the top of the page pulls a Material-style indicator; past the threshold
 * the release re-reads the vault on this device, triggers a sync (full
 * listing) and re-queries. The editor stays intentionally free of it
 * (gesture conflicts with text selection).
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

/**
 * Shared refresh action: re-read the local vault, sync (when configured),
 * notify every list. The local half is new (issue 110, E8): the pull used to
 * only sync, so a note moved in the iOS Files app stayed at its old place
 * however often the list was pulled. `rereadLocal: false` when the caller
 * has just re-read the part it shows (the folder browser).
 */
export async function refreshVaultAction(opts: { rereadLocal?: boolean } = {}): Promise<void> {
  if (opts.rereadLocal !== false) {
    try {
      // Loaded on use, like the lifecycle hooks do: the gesture module stays
      // free of the vault runtime's native plugins.
      const { rereadVault } = await import("../services/vaultService");
      await rereadVault();
    } catch {
      /* a failed read must not wedge the indicator; the sync still runs */
    }
  }
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
  enabled = true,
): ReactNode {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Where a pull stands. Kept here rather than in the listeners: they are put
  // on again after every commit (below), and a pull in progress must not start
  // over because the indicator it grows re-rendered the page.
  const gesture = useRef({ el: null as HTMLDivElement | null, startY: 0, tracking: false, dist: 0 });

  // On the element the caller's ref points at NOW, looked at after every
  // commit rather than once: a screen whose first render is something else —
  // the mail list shows an empty state until its accounts are read — has its
  // page a render later, and a once-only effect found no element, never
  // looked again, and the pull did nothing there. Without dependencies on
  // purpose; the one state it sets itself is the reset below, only when the
  // element changed — the next run finds the same element and sets nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = enabled ? ref.current : null;
    const g = gesture.current;
    // A pull belongs to the page it began on. Listeners that come back to
    // another page, or to none, start without it — and without its drawn
    // indicator: its end was never heard there, and the next lift of a finger
    // would have run the refresh.
    if (g.el !== el) {
      g.el = el;
      g.tracking = false;
      g.dist = 0;
      setPull(0);
    }
    if (!el) return;

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
      g.startY = e.touches[0].clientY;
      g.tracking = true;
      g.dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!g.tracking || busyRef.current) return;
      const dy = e.touches[0].clientY - g.startY;
      if (el.scrollTop > 0 || dy <= 0) {
        g.dist = 0;
        setPull(0);
        return;
      }
      const prev = g.dist;
      g.dist = pullDistance(dy);
      // Own the gesture: without this the browser rubber-bands instead.
      if (g.dist > 0 && e.cancelable) e.preventDefault();
      // One tactile tick exactly when the pull arms (crosses the threshold).
      if (prev < PULL_THRESHOLD && g.dist >= PULL_THRESHOLD) haptics.light();
      setPull(g.dist);
    };
    const onEnd = () => {
      if (!g.tracking) return;
      g.tracking = false;
      if (g.dist >= PULL_THRESHOLD && !busyRef.current) void run();
      g.dist = 0;
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
  });

  const visible = busy || pull > 8;
  return visible ? (
    <div aria-hidden className="m-ptr" style={{ height: busy ? 48 : pull }}>
      <span className={`m-ptr-circle${busy || pull >= PULL_THRESHOLD ? " is-spin" : ""}`} />
    </div>
  ) : null;
}
