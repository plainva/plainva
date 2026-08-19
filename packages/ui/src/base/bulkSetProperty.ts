import { createLimiter } from "../lib/concurrencyLimiter";
import { writeNoteProperty, type PropertyWriteAdapter } from "./writeProperty";

/**
 * Setting ONE column to ONE value across many notes (plan Mehrfachauswahl, P5).
 *
 * The interesting part is not the loop — it is that `writeNoteProperty` is read
 * + parse + write PER FILE, through the full adapter chain (backup snapshot,
 * sync queue, conflict detection). Two hundred rows are two hundred roundtrips,
 * and on a network drive that is exactly the trap the OKF conversion hit before
 * it got a worker pool (app commit 5e82dc6). So this runs bounded-concurrent,
 * reports determinate progress, can be cancelled, and does NOT stop at the
 * first failure: one unreadable note must not decide the fate of the other 199.
 *
 * Shared because both shells need every one of those properties and neither
 * should own a second copy of them.
 */

/**
 * Which column types a bulk set may touch (plan Mehrfachauswahl, E3).
 *
 * Single-value types only. On a tag, list or multiselect column "set them all
 * to X" means every existing value disappears — that needs its own add/remove,
 * and a relation needs the cardinality rule on top ("exactly one" steals). It
 * is written down as a leftover rather than smuggled in here.
 */
export const BULK_SETTABLE_INPUTS: ReadonlySet<string> = new Set([
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "select",
  "status",
  "email",
  "phone",
]);

export interface BulkSetOptions {
  /** Called after each file, successful or not. */
  onProgress?: (done: number, total: number) => void;
  /** Polled between files. Returning true stops — what is written stays. */
  isCancelled?: () => boolean;
  /** How many writes may be in flight. Modest by default: the chain is heavy. */
  concurrency?: number;
}

export interface BulkSetResult {
  /** Paths that were written. */
  written: string[];
  /** Paths that failed, with the reason, in the order they failed. */
  failed: { path: string; message: string }[];
  /** True when the run stopped early because the caller asked it to. */
  cancelled: boolean;
}

export async function bulkSetProperty(
  adapter: PropertyWriteAdapter,
  paths: readonly string[],
  column: string,
  value: unknown,
  options: BulkSetOptions = {}
): Promise<BulkSetResult> {
  const { onProgress, isCancelled, concurrency = 6 } = options;
  const total = paths.length;
  const written: string[] = [];
  const failed: { path: string; message: string }[] = [];
  let done = 0;
  let cancelled = false;

  const limit = createLimiter(Math.max(1, concurrency));
  await Promise.all(
    paths.map((path) =>
      limit.run(async () => {
        // Checked inside the limited task, not before scheduling: a cancel has
        // to take effect on the files still queued, not only on the next batch.
        if (cancelled || isCancelled?.()) {
          cancelled = true;
          return;
        }
        try {
          await writeNoteProperty(adapter, path, column, value);
          written.push(path);
        } catch (e) {
          failed.push({ path, message: e instanceof Error ? e.message : String(e) });
        }
        done += 1;
        onProgress?.(done, total);
      })
    )
  );

  return { written, failed, cancelled };
}
