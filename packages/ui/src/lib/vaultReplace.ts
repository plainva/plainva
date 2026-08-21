import { replaceAllInText, type FindReplaceOptions, type VaultFindResult } from "@plainva/core";

/**
 * The write side of vault-wide find & replace, shared by both shells.
 *
 * The rule this encodes is the one that matters: **every note is re-read from
 * disk immediately before it is written**. Between the preview and the tap on
 * "replace" a sync can have changed a note, and a stale preview must never
 * clobber newer content. If the fresh content no longer contains the query,
 * the note is SKIPPED — and, unlike the original desktop modal, it is now
 * named in the result instead of quietly vanishing from the count. A note that
 * silently did not change is the one case where the user needs to know.
 *
 * Lifted here (2026-08-21) rather than ported: the desktop had the loop inline
 * and the phone needed the same one. Two copies of a data-safety rule is how
 * the two drift apart — the desktop keeps its behaviour and gains the skip
 * report, the phone gains progress and a real cancel.
 */

export interface VaultReplaceDeps {
  /** Reads the note's current content from disk (never from a cache). */
  read: (path: string) => Promise<string>;
  /** Writes through the app's atomic + backup chain. */
  write: (path: string, content: string) => Promise<void>;
}

export interface VaultReplaceRequest {
  /** The preview, as produced by `VaultQueryService.findInVault`. */
  results: readonly VaultFindResult[];
  /** Paths the user left selected; anything else is untouched. */
  selected: ReadonlySet<string>;
  query: string;
  replacement: string;
  options?: FindReplaceOptions;
  /**
   * Reports the note about to be written, 1-based, before the read. The phone
   * draws a determinate bar from this; the desktop ignores it.
   */
  onProgress?: (done: number, total: number, path: string) => void;
  /**
   * Asked before EACH note. Returning true stops the run at a note boundary:
   * notes already written stay written and are reported. On the phone this is
   * both the cancel button and the move to the background — the safe exit of
   * an interrupted replace is "stop", never "finish unattended".
   */
  shouldStop?: () => boolean;
}

export interface VaultReplaceResult {
  /** Notes actually written. */
  notes: number;
  /** Matches replaced across those notes. */
  hits: number;
  /**
   * Notes that were selected but not written, because the fresh content no
   * longer matched (changed since the preview) or could not be read/written.
   */
  skipped: string[];
  /** True when `shouldStop` ended the run before the last selected note. */
  cancelled: boolean;
}

export async function runVaultReplace(
  deps: VaultReplaceDeps,
  req: VaultReplaceRequest
): Promise<VaultReplaceResult> {
  const targets = req.results.filter((r) => req.selected.has(r.path));
  const out: VaultReplaceResult = { notes: 0, hits: 0, skipped: [], cancelled: false };
  if (!req.query || targets.length === 0) return out;

  for (let i = 0; i < targets.length; i++) {
    if (req.shouldStop?.()) {
      out.cancelled = true;
      break;
    }
    const r = targets[i];
    req.onProgress?.(i + 1, targets.length, r.path);
    try {
      // Fresh read, every time. This is the whole point of the loop.
      const fresh = await deps.read(r.path);
      const { content, count } = replaceAllInText(fresh, req.query, req.replacement, req.options);
      if (count > 0 && content !== fresh) {
        await deps.write(r.path, content);
        out.notes += 1;
        out.hits += count;
      } else {
        // Matched in the preview, no longer matches on disk.
        out.skipped.push(r.path);
      }
    } catch {
      // Unreadable or unwritable: the rest of the run still applies.
      out.skipped.push(r.path);
    }
  }
  return out;
}
