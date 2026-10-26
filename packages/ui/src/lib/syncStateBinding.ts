import {
  driveFolderIdentity,
  dropboxFolderIdentity,
  oneDriveFolderIdentity,
  s3LocationIdentity,
  sameStoredValue,
  webDavFolderIdentity,
} from "@plainva/core";
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
 *
 * A wrong "another target" costs data - queued deletions are lost, newer local
 * edits become conflict copies - so (fourth review, finding 1):
 * - the folder is named in the form the TARGET resolves it to, through the
 *   identity function next to each target in core; nothing here restates a
 *   default, a slash rule or which providers ignore case;
 * - a reset needs both sides to name different targets positively; what is
 *   missing or cannot be read keeps.
 */
export interface SyncStateBinding {
  /** Form of the binding; one stored in another form is taken again, never compared. */
  v: 2;
  provider: string;
  /** The folder in its canonical form; absent when it could not be read. */
  root?: string;
  /** The provider's own id of the folder, where one is known (Google Drive). */
  rootId?: string;
  /** The account on the provider, where the device knows it. */
  account?: string;
}

/** The binding of a file target, from what each shell knows about it. */
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
  const withAccount = (binding: SyncStateBinding): SyncStateBinding => (identity && !binding.account ? { ...binding, account: identity } : binding);
  switch (input.provider) {
    case "webdav": {
      const found = input.webdav ? webDavFolderIdentity(input.webdav.url, input.webdav.user) : undefined;
      return { v: 2, provider: "webdav", ...(found ? { root: found.root } : {}), ...(found?.account ? { account: found.account } : {}) };
    }
    case "s3": {
      const root = input.s3 ? s3LocationIdentity(input.s3) : undefined;
      return { v: 2, provider: "s3", ...(root ? { root } : {}) };
    }
    case "drive": {
      const found = driveFolderIdentity(input.folder?.path, input.folder?.id);
      return withAccount({ v: 2, provider: "drive", root: found.root, ...(found.rootId ? { rootId: found.rootId } : {}) });
    }
    case "onedrive":
      return withAccount({ v: 2, provider: "onedrive", root: oneDriveFolderIdentity(input.folder?.path) });
    case "dropbox":
      return withAccount({ v: 2, provider: "dropbox", root: dropboxFolderIdentity(input.folder?.path) });
    default:
      // A provider this rule does not know: nothing to compare, so nothing is ever reset for it.
      return { v: 2, provider: input.provider };
  }
}

/**
 * Whether the queue and records made against `a` hold for `b`. "No" only where
 * both name different targets: another provider, two known accounts that
 * differ, two known folder ids that differ, or - without both ids - two known
 * folders that differ.
 */
export function sameSyncTarget(a: SyncStateBinding, b: SyncStateBinding): boolean {
  if (a.provider !== b.provider) return false;
  // Two accounts may each have a folder of the same name: another account is another target.
  if (a.account && b.account && a.account !== b.account) return false;
  // A folder id is the folder; a name only stands in while the id is unknown on one side.
  if (a.rootId && b.rootId) return a.rootId === b.rootId;
  if (a.root === undefined || b.root === undefined) return true;
  return a.root === b.root;
}

/**
 * - `adopt`: nothing comparable was recorded (the first start since this rule,
 *   or a binding of another form): the state that is there is taken as this
 *   target's, as every build before did;
 * - `keep`: the same target - queue and records stay;
 * - `reset`: another target - queue and records go before the sync starts.
 */
export type SyncStateBindingDecision = "adopt" | "keep" | "reset";

function comparable(stored: unknown): stored is SyncStateBinding {
  if (!stored || typeof stored !== "object") return false;
  const binding = stored as Partial<SyncStateBinding>;
  return binding.v === 2 && typeof binding.provider === "string" && binding.provider.length > 0;
}

export function syncStateBindingDecision(stored: unknown, current: SyncStateBinding): SyncStateBindingDecision {
  if (!comparable(stored)) return "adopt";
  return sameSyncTarget(stored, current) ? "keep" : "reset";
}

export interface SyncStateBindingPorts {
  load(): Promise<unknown>;
  save(binding: SyncStateBinding): Promise<void>;
  /** Empties the vault's sync queue and its per-file sync records. */
  clear(): Promise<void>;
}

/**
 * Binds the vault's sync state to the target about to start, as the one step
 * both shells take right before a file sync worker is built. The binding is
 * saved after the reset, never before: an interrupted reset is repeated on the
 * next start rather than forgotten. A kept binding takes what is known now and
 * keeps what was known before (a Drive folder id, an account), so the next
 * comparison uses the most that either side knew.
 *
 * A reset changes nothing about the target itself: whether a missing folder may
 * be created stays the explicit decision it is (a new vault, a folder chosen
 * in the wizard), never a consequence of this one.
 */
export async function bindSyncState(ports: SyncStateBindingPorts, current: SyncStateBinding): Promise<SyncStateBindingDecision> {
  const stored = await ports.load().catch(() => null);
  const decision = syncStateBindingDecision(stored, current);
  if (decision === "reset") await ports.clear();
  let merged: SyncStateBinding = current;
  if (decision === "keep" && comparable(stored)) {
    const root = current.root ?? stored.root;
    const rootId = current.rootId ?? stored.rootId;
    const account = current.account ?? stored.account;
    merged = { v: 2, provider: current.provider, ...(root !== undefined ? { root } : {}), ...(rootId ? { rootId } : {}), ...(account ? { account } : {}) };
  }
  if (!sameStoredValue(stored, merged)) await ports.save(merged);
  return decision;
}

/**
 * Whether the vault has ever synced with a remote - a fact of the vault, kept
 * apart from the sync records (fifth review of plan "Verbinden", finding 2).
 *
 * Whether a missing cloud folder may be created hung on the records: "has
 * this vault confirmed remote files". A reset of the sync state empties them,
 * and a first cycle after it that confirms nothing (the folder briefly gone, a
 * listing that failed) left the next start free to create a new, empty folder
 * for a vault that had synced for months - the 2026-09-20 class, in two steps.
 * So the fact is recorded once and never taken back by a reset, a clear or a
 * new binding: as soon as records show the vault synced (which also carries it
 * over for every vault that synced before this rule), and when a first cycle
 * completes.
 */
export interface SyncedBeforePorts {
  /** The recorded fact (registry or settings). */
  recorded(): Promise<boolean>;
  record(): Promise<void>;
  /** The sync records confirm remote files - the evidence before anything was recorded. */
  confirmedRemoteFiles(): Promise<boolean>;
}

export async function vaultSyncedBefore(ports: SyncedBeforePorts): Promise<boolean> {
  if (await ports.recorded().catch(() => false)) return true;
  if (!(await ports.confirmedRemoteFiles().catch(() => false))) return false;
  await ports.record();
  return true;
}

/**
 * Whether a target may create its missing cloud folder: only for a vault that
 * has never synced. Everything else - a vault that synced before, whatever its
 * records say now - gets the error with the folder picker instead. A folder the
 * person chooses to create is created by the picker itself, not by the sync.
 */
export function rootCreationAllowed(syncedBefore: boolean): boolean {
  return !syncedBefore;
}
