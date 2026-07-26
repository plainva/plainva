import type { IndexScanReport } from "@plainva/core";

/**
 * "Read the vault again" (plan P1). One mechanism behind four manual entry
 * points (F5, the file-tree button, the folder context menu, the command
 * palette) and two automatic ones (window focus, interval safety net).
 *
 * Two halves, because a vault can live in two places:
 *  - LOCAL: reconcile the index against the disk (`indexVaultFull`) and report
 *    what that pass actually saw. Before this, the pass was silent — a scan
 *    that never reached a folder was indistinguishable from "nothing changed",
 *    which is exactly the state the maintainer was stuck in.
 *  - CLOUD: ask the sync worker for a FULL listing. Brand-new remote files only
 *    ever arrive through a listing; a delta cycle finds changes to files it
 *    already knows. Mobile has done this since 2026-07-16 (`fullResync`); the
 *    desktop had no way to request it at all — `triggerFullListing()` existed in
 *    the core with no caller.
 */

/** The worker surface the refresh needs; every implementation has `triggerImmediate`. */
export interface RefreshSyncWorker {
  triggerImmediate(): void;
  /** Drop the delta cursor, revive parked pushes, sync now (plain sync worker). */
  fullResync?: () => Promise<void>;
  /** Drop the delta cursor and sync now (no queue revival). */
  triggerFullListing?: () => void;
}

export interface RefreshIndexer {
  indexVaultFull(): Promise<IndexScanReport>;
}

/** What the cloud half of a refresh did. */
export type CloudRefreshOutcome =
  /** No sync target on this vault — a purely local refresh. */
  | "none"
  /** A full listing was requested; results arrive with the running cycle. */
  | "requested"
  /** The worker refused/threw — the local half still happened. */
  | "failed";

export interface VaultRefreshResult {
  local: IndexScanReport;
  cloud: CloudRefreshOutcome;
}

export interface VaultRefreshOptions {
  indexer: RefreshIndexer;
  syncWorker: RefreshSyncWorker | null;
  /** Skip the cloud half (focus trigger inside the throttle window). */
  skipCloud?: boolean;
}

/**
 * Runs one refresh. The local half always runs; the cloud half is best-effort
 * and never fails the whole refresh — a listing that cannot be requested must
 * not swallow the local report the user asked for.
 */
export async function runVaultRefresh(opts: VaultRefreshOptions): Promise<VaultRefreshResult> {
  const local = await opts.indexer.indexVaultFull();

  let cloud: CloudRefreshOutcome = "none";
  const worker = opts.syncWorker;
  if (worker && !opts.skipCloud) {
    try {
      if (worker.fullResync) {
        await worker.fullResync();
      } else if (worker.triggerFullListing) {
        worker.triggerFullListing();
      } else {
        worker.triggerImmediate();
      }
      cloud = "requested";
    } catch (e) {
      console.error("[vaultRefresh] requesting a full listing failed", e);
      cloud = "failed";
    }
  }

  return { local, cloud };
}

/** Timestamps of the last automatic refresh, per half. */
export interface AutoRefreshMarks {
  local: number;
  cloud: number;
}

export interface AutoRefreshLimits {
  /** Minimum spacing between two automatic LOCAL reconciles. */
  localMs: number;
  /** Minimum spacing between two automatic CLOUD full listings (E11). */
  cloudMs: number;
}

export const AUTO_REFRESH_LIMITS: AutoRefreshLimits = {
  localMs: 30_000,
  cloudMs: 300_000,
};

/**
 * Decides what an automatic trigger (window focus, interval net) may do right
 * now. Pure so the throttling is testable without timers: coming back from
 * another program reconciles the disk at most every 30 s, and only asks the
 * cloud for a full listing every 5 minutes (E4/E11) — otherwise every alt-tab
 * would cost a full remote listing.
 */
export function planAutoRefresh(
  now: number,
  marks: AutoRefreshMarks,
  limits: AutoRefreshLimits = AUTO_REFRESH_LIMITS
): { local: boolean; cloud: boolean } {
  const local = now - marks.local >= limits.localMs;
  const cloud = local && now - marks.cloud >= limits.cloudMs;
  return { local, cloud };
}

/** Translation function shape (i18next `t` with interpolation). */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Builds the report the user sees. Two lines, because the two halves answer
 * two different questions: "did the scan see my file?" and "did we ask the
 * cloud?". Skipped entries are named explicitly — a folder the walk could not
 * enter is the one case where the numbers alone would lie.
 */
export function buildRefreshToast(result: VaultRefreshResult, t: Translate): string {
  const { added, changed, removed, skipped } = result.local;
  const lines: string[] = [
    // Headline first (mockup): the counts alone read like a status dump — the
    // line above them says what just happened.
    t("refresh.done", { defaultValue: "Vault neu eingelesen" }),
    t("refresh.localLine", {
      defaultValue: "Lokal: {{added}} neu · {{changed}} geändert · {{removed}} entfernt",
      added,
      changed,
      removed,
    }),
  ];
  if (skipped.length > 0) {
    // Deliberately no counter: the PATHS are the useful part ("that folder is
    // the one you are missing"), and a bare number reads like a plural bug.
    const shown = skipped.slice(0, 3).map((s) => s.path || "/");
    if (skipped.length > shown.length) shown.push("…");
    lines.push(t("refresh.skippedLine", { defaultValue: "Übersprungen: {{paths}}", paths: shown.join(", ") }));
  }
  if (result.cloud === "requested") {
    lines.push(t("refresh.cloudRequested", { defaultValue: "Cloud: Voll-Abgleich angefordert" }));
  } else if (result.cloud === "failed") {
    lines.push(t("refresh.cloudFailed", { defaultValue: "Cloud: Abgleich konnte nicht angefordert werden" }));
  }
  return lines.join("\n");
}
