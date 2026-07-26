import { describe, it, expect, vi } from "vitest";
import type { IndexScanReport } from "@plainva/core";
import {
  AUTO_REFRESH_LIMITS,
  buildRefreshToast,
  planAutoRefresh,
  runVaultRefresh,
  type RefreshSyncWorker,
} from "./vaultRefresh";

const report = (over: Partial<IndexScanReport> = {}): IndexScanReport => ({
  added: 0,
  changed: 0,
  removed: 0,
  skipped: [],
  durationMs: 1,
  ...over,
});

const indexerOf = (r: IndexScanReport = report()) => ({ indexVaultFull: vi.fn(async () => r) });

/** Passthrough `t`: returns the defaultValue with the placeholders filled in. */
const t = (_key: string, opts?: Record<string, unknown>) => {
  let out = String(opts?.defaultValue ?? _key);
  for (const [k, v] of Object.entries(opts ?? {})) {
    if (k === "defaultValue") continue;
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
};

describe("runVaultRefresh", () => {
  it("reconciles locally and reports no cloud half without a sync worker", async () => {
    const indexer = indexerOf(report({ added: 2, changed: 1 }));
    const result = await runVaultRefresh({ indexer, syncWorker: null });
    expect(indexer.indexVaultFull).toHaveBeenCalledOnce();
    expect(result.local.added).toBe(2);
    expect(result.cloud).toBe("none");
  });

  it("asks the cloud for a FULL listing, not just an immediate cycle", async () => {
    // The regression this guards: the desktop only ever called triggerImmediate,
    // which keeps the delta cursor — brand-new remote files never arrived.
    const worker = {
      triggerImmediate: vi.fn(),
      fullResync: vi.fn(async () => {}),
    } satisfies RefreshSyncWorker;
    const result = await runVaultRefresh({ indexer: indexerOf(), syncWorker: worker });
    expect(worker.fullResync).toHaveBeenCalledOnce();
    expect(worker.triggerImmediate).not.toHaveBeenCalled();
    expect(result.cloud).toBe("requested");
  });

  it("falls back to triggerFullListing, then to triggerImmediate", async () => {
    const listing = { triggerImmediate: vi.fn(), triggerFullListing: vi.fn() };
    await runVaultRefresh({ indexer: indexerOf(), syncWorker: listing });
    expect(listing.triggerFullListing).toHaveBeenCalledOnce();
    expect(listing.triggerImmediate).not.toHaveBeenCalled();

    const bare = { triggerImmediate: vi.fn() };
    await runVaultRefresh({ indexer: indexerOf(), syncWorker: bare });
    expect(bare.triggerImmediate).toHaveBeenCalledOnce();
  });

  it("skips the cloud half on request (throttled focus trigger)", async () => {
    const worker = { triggerImmediate: vi.fn(), fullResync: vi.fn(async () => {}) };
    const result = await runVaultRefresh({ indexer: indexerOf(), syncWorker: worker, skipCloud: true });
    expect(worker.fullResync).not.toHaveBeenCalled();
    expect(result.cloud).toBe("none");
  });

  it("still returns the local report when the cloud half throws", async () => {
    const worker = {
      triggerImmediate: vi.fn(),
      fullResync: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const result = await runVaultRefresh({ indexer: indexerOf(report({ added: 5 })), syncWorker: worker });
    expect(result.local.added).toBe(5);
    expect(result.cloud).toBe("failed");
  });
});

describe("planAutoRefresh", () => {
  it("throttles the local half to the configured spacing", () => {
    const marks = { local: 1_000, cloud: 0 };
    expect(planAutoRefresh(1_000 + AUTO_REFRESH_LIMITS.localMs - 1, marks).local).toBe(false);
    expect(planAutoRefresh(1_000 + AUTO_REFRESH_LIMITS.localMs, marks).local).toBe(true);
  });

  it("asks the cloud far less often than the disk (E11)", () => {
    const marks = { local: 0, cloud: 0 };
    const soon = planAutoRefresh(AUTO_REFRESH_LIMITS.localMs, marks);
    expect(soon.local).toBe(true);
    expect(soon.cloud).toBe(false);
    const later = planAutoRefresh(AUTO_REFRESH_LIMITS.cloudMs, marks);
    expect(later.cloud).toBe(true);
  });

  it("never runs the cloud half without the local half", () => {
    const marks = { local: 10_000, cloud: 0 };
    expect(planAutoRefresh(10_001, marks)).toEqual({ local: false, cloud: false });
  });
});

describe("buildRefreshToast", () => {
  it("reports both halves", () => {
    const msg = buildRefreshToast(
      { local: report({ added: 2, changed: 1, removed: 0 }), cloud: "requested" },
      t
    );
    expect(msg).toContain("2 neu");
    expect(msg).toContain("1 geändert");
    expect(msg).toContain("Cloud");
  });

  it("names skipped entries — the one case where the numbers would lie", () => {
    const msg = buildRefreshToast(
      {
        local: report({ skipped: [{ path: "Linked", reason: "cycle" }, { path: "Netz", reason: "unreadable" }] }),
        cloud: "none",
      },
      t
    );
    expect(msg).toContain("Linked");
    expect(msg).toContain("Netz");
  });

  it("truncates a long skip list", () => {
    const skipped = ["Ord1", "Ord2", "Ord3", "Ord4", "Ord5"].map((path) => ({ path, reason: "cycle" as const }));
    const msg = buildRefreshToast({ local: report({ skipped }), cloud: "none" }, t);
    expect(msg).toContain("…");
    expect(msg).toContain("Ord3");
    expect(msg).not.toContain("Ord4");
  });

  it("says so when the cloud half failed", () => {
    const msg = buildRefreshToast({ local: report(), cloud: "failed" }, t);
    expect(msg).toContain("nicht angefordert");
  });
});
