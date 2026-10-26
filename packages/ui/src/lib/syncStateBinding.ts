import { sameStoredValue } from "@plainva/core";
import type { VerifiedProviderIdentity } from "./accountProfile";

/**
 * Which remote folder a vault's sync queue and per-file sync records belong to
 * (third review of plan "Verbinden", finding 1). One rule for both shells.
 *
 * The queue (what still has to go up) and the records (what each file looked
 * like on the remote at the last sync) only mean something against the folder
 * they were made with. Clearing them when an account was removed threw away
 * exactly what a reconnect to the SAME folder needs: with no records, every
 * file that differed on either side became a conflict copy. Keeping them for
 * a DIFFERENT folder pushed the old queue there and compared its files with
 * another folder's state. So they are not tied to the account but to the
 * target, and checked when a file sync is about to start: the same target
 * keeps both, another target drops both - before any worker runs.
 */
export interface SyncStateBinding {
  provider: string;
  /** The folder as a path or address: server URL, bucket and prefix, folder path. */
  root: string;
  /** The provider's own id of the folder, where one is known (Google Drive). */
  rootId?: string;
  /** The account on the provider, where the device knows it. */
  account?: string;
}

/** Providers whose paths do not distinguish upper and lower case. */
const CASE_INSENSITIVE = new Set(["onedrive", "dropbox"]);

/** Without slashes at the ends; a loop, not a pattern, so no input can make it slow. */
function trimSlashes(value: string, ends: "both" | "end" = "both"): string {
  const text = value.trim();
  let start = 0;
  let end = text.length;
  if (ends === "both") while (start < end && text[start] === "/") start += 1;
  while (end > start && text[end - 1] === "/") end -= 1;
  return text.slice(start, end);
}

/**
 * The binding of a file target, from what each shell knows about it. The
 * defaults are the ones the targets use, so a vault whose folder setting is
 * empty and one that names the default folder are the same target.
 */
export function syncStateBindingFor(input: {
  provider: string;
  /** WebDAV: the server address and user. */
  webdav?: { url: string; user?: string };
  /** S3: endpoint, bucket and prefix. */
  s3?: { endpoint: string; bucket: string; prefix?: string };
  /** Drive, OneDrive, Dropbox: the folder setting (and Drive's folder id). */
  folder?: { path?: string; id?: string };
  /** The account the files card proved (OAuth providers). */
  identity?: VerifiedProviderIdentity;
}): SyncStateBinding {
  const identity = input.identity ? `${input.identity.issuer}:${input.identity.subject}` : undefined;
  switch (input.provider) {
    case "webdav": {
      const url = trimSlashes(input.webdav?.url ?? "", "end");
      const user = input.webdav?.user?.trim();
      return { provider: "webdav", root: url, ...(user ? { account: user } : {}) };
    }
    case "s3": {
      const endpoint = trimSlashes(input.s3?.endpoint ?? "", "end");
      return { provider: "s3", root: `${endpoint}/${(input.s3?.bucket ?? "").trim()}/${trimSlashes(input.s3?.prefix ?? "")}` };
    }
    default: {
      const fallback = input.provider === "dropbox" ? "" : "Plainva";
      let root = trimSlashes(input.folder?.path ?? "") || fallback;
      if (CASE_INSENSITIVE.has(input.provider)) root = root.toLowerCase();
      return {
        provider: input.provider,
        root: root.normalize("NFC"),
        ...(input.folder?.id ? { rootId: input.folder.id } : {}),
        ...(identity ? { account: identity } : {}),
      };
    }
  }
}

/** Whether the queue and records made against `a` hold for `b`. */
export function sameSyncTarget(a: SyncStateBinding, b: SyncStateBinding): boolean {
  if (a.provider !== b.provider) return false;
  // Two accounts may each have a folder of the same name: another account is another target.
  if (a.account && b.account && a.account !== b.account) return false;
  // A folder id is the folder; a name only stands in while the id is unknown on one side.
  if (a.rootId && b.rootId) return a.rootId === b.rootId;
  return a.root === b.root;
}

/**
 * - `adopt`: nothing was recorded yet (the first start since this rule): the
 *   state that is there is taken as this target's, as every build before did;
 * - `keep`: the same target - queue and records stay;
 * - `reset`: another target - queue and records go before the sync starts.
 */
export type SyncStateBindingDecision = "adopt" | "keep" | "reset";

export function syncStateBindingDecision(stored: SyncStateBinding | null | undefined, current: SyncStateBinding): SyncStateBindingDecision {
  if (!stored || typeof stored !== "object" || typeof stored.provider !== "string" || typeof stored.root !== "string") return "adopt";
  return sameSyncTarget(stored, current) ? "keep" : "reset";
}

export interface SyncStateBindingPorts {
  load(): Promise<SyncStateBinding | null>;
  save(binding: SyncStateBinding): Promise<void>;
  /** Empties the vault's sync queue and its per-file sync records. */
  clear(): Promise<void>;
}

/**
 * Binds the vault's sync state to the target about to start, as the one step
 * both shells take right before a file sync worker is built. The binding is
 * saved after the reset, never before: an interrupted reset is repeated on the
 * next start rather than forgotten. A kept binding takes what is known now (a
 * Drive folder id learned since), so the next comparison uses it.
 */
export async function bindSyncState(ports: SyncStateBindingPorts, current: SyncStateBinding): Promise<SyncStateBindingDecision> {
  const stored = await ports.load().catch(() => null);
  const decision = syncStateBindingDecision(stored, current);
  if (decision === "reset") await ports.clear();
  const merged: SyncStateBinding = decision === "keep" && stored
    ? { ...current, ...(current.rootId ?? stored.rootId ? { rootId: current.rootId ?? stored.rootId } : {}), ...(current.account ?? stored.account ? { account: current.account ?? stored.account } : {}) }
    : current;
  if (!stored || !sameStoredValue(stored, merged)) await ports.save(merged);
  return decision;
}
