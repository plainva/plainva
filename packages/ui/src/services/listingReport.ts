import type { ListingReport } from "@plainva/core";

/**
 * One full remote listing as ONE line for the diagnostics export (finding
 * 2026-09-20, plan A0). A Drive listing came back with HTTP 200 and a fraction
 * of the tree, and nothing on the device could say afterwards how many folders
 * it had walked or where the missing files sat. Numbers only — the worker hands
 * over counters and hashed folder keys, never a name, and this line adds none.
 *
 * English on purpose: like every other line of the export it is read by whoever
 * debugs the report, not by the person who sent it.
 */
export function formatListingReport(report: ListingReport, provider: string | null): string {
  const parts = [
    `listing ${provider ?? "remote"}: ${report.files} files`,
    `${report.folders} folders`,
    `${report.pages} pages`,
    `${report.ms} ms`,
    `known ${report.known}`,
    `missing ${report.missing}`,
  ];
  if (report.firstOfSession) parts.push("first listing of this session");
  if (report.rootId) parts.push(`root ${report.rootId}`);
  if (report.worstFolders.length > 0) {
    parts.push(`worst folders ${report.worstFolders.map((f) => `${f.key}×${f.missing}`).join(" ")}`);
  }
  return parts.join(", ");
}
