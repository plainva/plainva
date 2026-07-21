/**
 * Sideband keyfile-sync step (settings-sync plan §3.1/§3.2, P3). Transports the
 * PUBLIC, passphrase-wrapped `.plainva/sync/keyfile.json` so every device can
 * unlock the master key with the passphrase. It is not secret (the MK is wrapped
 * under a passphrase-derived KEK), so it travels as plain JSON like the profile,
 * but under `.plainva/sync/` it is excluded from the normal file sync and needs
 * the sideband.
 *
 * Reconciliation is `updatedAt` last-writer-wins on the whole file: a device that
 * creates the keyfile, changes the passphrase (re-wrap) or rotates the key bumps
 * `updatedAt`; other devices adopt the newer file. There is no field merge — the
 * keyfile is a single authoritative document per vault. (A concurrent passphrase
 * change on two offline devices is the documented rare edge; the loser re-enters
 * the winning passphrase, and the local plaintext vault is never at risk.)
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import { KEYFILE_SYNC_PATH } from "./paths.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Minimal shape check + updatedAt extraction (never trusts the bytes further). */
function keyfileUpdatedAt(text: string | null): { text: string; updatedAt: string } | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const k = parsed as { format?: unknown; updatedAt?: unknown };
  if (!k || k.format !== "plainva-keyfile" || typeof k.updatedAt !== "string") return null;
  return { text, updatedAt: k.updatedAt };
}

export interface KeyfileSyncStepOptions {
  /** Called when the local keyfile was replaced by a newer remote one (re-unlock hint). */
  onRemoteKeyfileAdopted?: () => void;
}

/** Runs the keyfile-sync sideband against a target + raw vault adapter. */
export class KeyfileSyncStep {
  constructor(private readonly options: KeyfileSyncStepOptions = {}) {}

  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    const localText = (await vault.exists(KEYFILE_SYNC_PATH)) ? await vault.readTextFile(KEYFILE_SYNC_PATH) : null;
    const local = keyfileUpdatedAt(localText);

    const remoteBytes = await target.download(KEYFILE_SYNC_PATH);
    const remote = keyfileUpdatedAt(remoteBytes ? decoder.decode(remoteBytes as BufferSource) : null);

    // Adopt remote when local is missing or strictly older.
    if (remote && (!local || remote.updatedAt > local.updatedAt)) {
      await vault.writeTextFile(KEYFILE_SYNC_PATH, remote.text);
      this.options.onRemoteKeyfileAdopted?.();
      return;
    }
    // Publish local when remote is missing or strictly older.
    if (local && (!remote || local.updatedAt > remote.updatedAt)) {
      await target.push({
        id: 0,
        file_path: KEYFILE_SYNC_PATH,
        operation: "write",
        content: encoder.encode(local.text),
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    }
  }
}
