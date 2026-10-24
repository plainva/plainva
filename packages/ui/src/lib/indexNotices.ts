import type { FullScanFailure, IndexScanReport, VaultWalkSkip } from "@plainva/core";
import i18n from "../i18n";
import { errorText } from "./errorText";

/** How many entries the notice spells out before it stops with "…". */
export const LEFT_OUT_NAMES_SHOWN = 3;

/**
 * What both shells say when a full scan left files or folders of the vault out
 * of the search index (issue 125): a link to a place that is not on this
 * device, a folder link that leads back into itself, a file that cannot be
 * read. The scan goes on without them — one such link used to stop it, and
 * nothing on screen said so. The notice names them, so the one entry behind a
 * search that misses half the vault can be found. Null when there is nothing
 * to say.
 */
export function indexLeftOutText(skipped: ReadonlyArray<VaultWalkSkip>): string | null {
  if (skipped.length === 0) return null;
  const names = skipped.slice(0, LEFT_OUT_NAMES_SHOWN).map((s) => s.path || "/");
  const more = skipped.length > LEFT_OUT_NAMES_SHOWN ? ", …" : "";
  return i18n.t("refresh.leftOut", { count: skipped.length, names: names.join(", ") + more });
}

/** What both shells say when a full scan did not get through (issue 125). */
export function indexScanFailedText(error: unknown): string {
  return i18n.t("refresh.indexFailed", { reason: errorText(error) });
}

/**
 * What the phone says when the index database itself did not open: the vault
 * then runs without search, tags, databases, the sync and the calendar, and
 * that used to happen without a word (issue 125).
 */
export function indexUnavailableText(error: unknown): string {
  return i18n.t("refresh.indexUnavailable", { reason: errorText(error) });
}

export interface IndexNoticeSink {
  warning(message: string): void;
  error(message: string): void;
}

export interface IndexNotices {
  /** After every full scan that went through (`VaultIndexerOptions.onFullScan`). */
  scanned(report: Pick<IndexScanReport, "skipped">): void;
  /** After a full scan that failed (`VaultIndexerOptions.onFullScanFailed`). */
  failed(info: FullScanFailure): void;
}

/**
 * The notices of one open vault, each said once: the same files left out by
 * the next scan, or the same failure again, is not news — a vault is scanned
 * at every return to the app, every refresh, every folder the watcher saw
 * created. A scan that leaves out something else is said again, and so is a
 * failure after a scan that went through.
 */
export function createIndexNotices(say: IndexNoticeSink): IndexNotices {
  let leftOut = "";
  let failure = "";
  return {
    scanned(report) {
      failure = "";
      // A link that leads back into a folder the walk is already in (`cycle`)
      // leaves nothing out: what lies there is indexed under its first path.
      // The walks report a tree deeper than 32 levels the same way, and that
      // cut goes unannounced (Sammelplan 3.94, Restpunkte).
      const unread = report.skipped.filter((s) => s.reason === "unreadable");
      const key = JSON.stringify(unread.map((s) => s.path).sort());
      if (key === leftOut) return;
      leftOut = key;
      const text = indexLeftOutText(unread);
      if (text) say.warning(text);
    },
    failed(info) {
      const text = indexScanFailedText(info.error);
      if (text === failure) return;
      failure = text;
      say.error(text);
    },
  };
}
