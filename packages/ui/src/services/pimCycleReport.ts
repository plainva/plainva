import type { PimCycleInfo } from "@plainva/core";

/**
 * One diagnostics line per calendar/task cycle (finding 2026-09-20: two pulls
 * 14 s apart, and nothing on record said what had asked for the second one).
 * Carries no data — why the cycle ran, how long it took, and how many manual
 * requests it answered without a second run.
 */
export function formatPimCycle(info: PimCycleInfo): string {
  const parts = [`cycle ${info.cause}`, `${Math.round(info.ms)} ms`, info.wroteData ? "wrote data" : "no change"];
  if (info.hadError) parts.push("with errors");
  if (info.coalesced > 0) parts.push(`answered ${info.coalesced} more request${info.coalesced === 1 ? "" : "s"}`);
  return parts.join(", ");
}
