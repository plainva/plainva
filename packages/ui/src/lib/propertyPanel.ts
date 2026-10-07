import { parseOkfTrustSignals, PLAINVA_NAMESPACE_KEY, type OkfTrustSignals } from "@plainva/core";

/**
 * What the properties panel shows for a note — decided once, for both shells
 * and for the count at the section's head (plan Befunde 2026-10-06, R4).
 *
 * The head used to count every top-level frontmatter key, while the panel hid
 * some of them (the `plainva` namespace, the provenance families that render
 * as the trust group) and added rows of its own (the two lifecycle rows). So
 * "Properties 6" stood above a list that was not six of anything. The count is
 * now derived from the same model the rows are drawn from, and cannot disagree
 * with them.
 */

/** OKF 0.2 provenance families: shown as the trust group, never as editable rows. */
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(["generated", "verified", "sources"]);

/**
 * The `plainva` namespace (document icon, header colour) has its own UI in the
 * note's head; it is presentation, not a user property.
 */
export function isHiddenPropertyKey(key: string): boolean {
  return key === PLAINVA_NAMESPACE_KEY || key.startsWith(`${PLAINVA_NAMESPACE_KEY}.`) || key.startsWith(`${PLAINVA_NAMESPACE_KEY}:`);
}

export interface PropertyPanelModel {
  /** OKF 0.2 trust signals, form-checked. */
  trust: OkfTrustSignals;
  /** Every user-facing key, in file order. */
  userKeys: string[];
  /** The keys that render as ordinary rows, in file order. */
  genericKeys: string[];
  /**
   * The pinned lifecycle rows. A foreign-shaped `status` (a task database's
   * `Offen`) and a malformed `stale_after` stay ordinary rows instead — the
   * pinned editor would otherwise show the same key twice.
   */
  showStatusRow: boolean;
  showStaleRow: boolean;
  /** Rows the panel draws: the ordinary ones plus the pinned lifecycle rows. */
  shownCount: number;
}

export function propertyPanelModel(frontmatter: Record<string, unknown> | null | undefined): PropertyPanelModel {
  const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  const trust = parseOkfTrustSignals(fm);
  const claimed = new Set(trust.claimedKeys);
  const showStatusRow = !trust.statusForeign;
  const showStaleRow = fm.stale_after === undefined || trust.staleAfter !== null;
  const userKeys = Object.keys(fm).filter((key) => !isHiddenPropertyKey(key));
  const genericKeys = userKeys.filter((key) => {
    if (PROVENANCE_KEYS.has(key) && claimed.has(key)) return false;
    if (key === "status" && showStatusRow) return false;
    if (key === "stale_after" && showStaleRow) return false;
    return true;
  });
  return {
    trust,
    userKeys,
    genericKeys,
    showStatusRow,
    showStaleRow,
    shownCount: genericKeys.length + (showStatusRow ? 1 : 0) + (showStaleRow ? 1 : 0),
  };
}
