import { isPlainvaManagedIndex } from "../okf-index.js";
import { isSystemJunkName } from "./systemJunk.js";

/**
 * What the start of a vault shows (plan Oberfläche, O8):
 *
 * - `"empty"` — nothing the person wrote yet: the "write your first note" prompt;
 * - `"fetching"` — nothing here YET, and the first pull of its cloud folder is
 *   still running: the vault is being loaded, not empty;
 * - `"content"` — everything else, and every case that could not be decided.
 */
export type VaultEmptiness = "content" | "empty" | "fetching";

/** The two reads the rule needs — any vault adapter has them. */
export interface VaultRootReader {
  listDir(path: string): Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>;
  readTextFile(path: string): Promise<string>;
}

/**
 * ONE rule for both shells: the desktop's empty editor pane and the phone's
 * Home ask the same question and must give the same answer.
 *
 * Decided from the root: a new vault without a template holds only the
 * `index.md` Plainva generated for it, so the Files pane showed that overview
 * as if it were content and the prompt never came. What counts as nothing:
 *
 * - an `index.md` that carries Plainva's marker (`isPlainvaManagedIndex`) —
 *   read to be sure: an `index.md` without the marker is the person's own
 *   (an Obsidian home note) and a note like any other. So is a `log.md`:
 *   Plainva never writes one into a new vault (review of O8, 2026-11-17 —
 *   the prompt replaced the phone's whole Home over such a vault, and its one
 *   note could no longer be reached);
 * - dot entries (`.plainva/`, `.obsidian/`, `.trash/`) — hidden everywhere;
 * - operating-system bookkeeping (`.DS_Store`, `Thumbs.db`, …).
 *
 * Anything else is content — a note, a database, an attachment, a folder
 * (even an empty one: the person made it on purpose). A root or an `index.md`
 * that cannot be read is content too: a prompt over a vault full of notes
 * would be the one wrong thing this can show.
 */
export async function readVaultEmptiness(
  vault: VaultRootReader,
  options: { firstPullPending?: boolean } = {},
): Promise<VaultEmptiness> {
  let entries: ReadonlyArray<{ name: string; isDirectory: boolean }>;
  try {
    entries = await vault.listDir("");
  } catch {
    return "content";
  }
  const left = entries.filter((e) => !e.name.startsWith(".") && !isSystemJunkName(e.name));
  // The listing decides first; a file is read only when it alone is in doubt.
  if (left.some((e) => e.isDirectory || e.name.toLowerCase() !== "index.md")) return "content";
  for (const e of left) {
    try {
      if (!isPlainvaManagedIndex(await vault.readTextFile(e.name))) return "content";
    } catch {
      return "content";
    }
  }
  return options.firstPullPending ? "fetching" : "empty";
}

/**
 * What a shell keeps about the first pull of the vault it shows: the worker's
 * `firstPullDone` (`false` from the moment a sync worker exists until its first
 * cycle has finished, `true` after it, absent while no worker runs) and whether
 * that first pull has failed at least once in this session.
 */
export interface FirstPullState {
  firstPullDone?: boolean | null;
  firstPullFailed?: boolean | null;
  status: string;
  /** The worker's reason beside the status — `stalled` is a notice, not a failure. */
  reason?: string | null;
}

/**
 * Reasons beside an `error` or `retrying` that say nothing failed (fourth
 * review of O8): the watchdog's notice that a cycle has been quiet for a while
 * (it goes on), and a folder held back as an encrypted workspace this device
 * has not joined (joining opens the vault again, and its first pull starts
 * afresh).
 */
const NOT_A_FAILED_PULL = new Set(["stalled", "encrypted-workspace"]);

/**
 * Whether the start of an empty vault says "being loaded" — the one rule both
 * shells ask (second and third review of O8, 2026-11-17).
 *
 * Only while a worker's first pull is running or about to begin, and only until
 * it failed once. A status that names a provider proves nothing about a pull (a
 * folder held back for a decision says "retrying" with no worker behind it).
 * After the first failure the vault shows as it is — its empty start with the
 * offers — and the sync status says what is wrong: the encrypted workspace's
 * worker retries a network failure for ever, the plain one holds its first
 * cycle back while a single file keeps failing, and either way "being loaded"
 * would have stood without an end. It does not come back in that session; a
 * pull that gets through later brings the content as at any other time.
 */
export function isFirstPullPending(s: FirstPullState): boolean {
  if (s.firstPullDone !== false || s.firstPullFailed === true) return false;
  // A quiet cycle is still a cycle: the watchdog's notice keeps "being loaded".
  if (s.status === "retrying" && s.reason === "stalled") return true;
  return s.status !== "error" && s.status !== "retrying" && s.status !== "off";
}

/**
 * The `firstPullFailed` a shell keeps after its worker reported `status`: a
 * failure during the first pull — `error`, or `retrying` (a failed cycle, a
 * file that could not be pulled, a cycle given up as stuck) — is remembered,
 * but not a notice or a hold (`NOT_A_FAILED_PULL`);
 * nothing ever clears it but the end of the session. Without a worker there is
 * no first pull to fail.
 */
export function firstPullFailedAfter(s: Omit<FirstPullState, "status" | "reason">, status: string, reason?: string | null): boolean {
  if (s.firstPullFailed === true) return true;
  if (reason && NOT_A_FAILED_PULL.has(reason)) return false;
  return s.firstPullDone === false && (status === "error" || status === "retrying");
}
