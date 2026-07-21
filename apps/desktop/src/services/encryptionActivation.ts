/**
 * Content-E2E activation (settings-sync plan §3.5, P4/P5). Turns end-to-end
 * encryption on/off for a sync connection. The local vault ALWAYS stays plaintext
 * Markdown — only the remote copy becomes ciphertext — so even a failed sweep can
 * never lose local data (the remote is recoverable from the untouched local vault).
 *
 * Activation is deliberately two-step:
 *   1. `activateContentEncryption` writes the `migrating` (mixed) manifest and
 *      force-enqueues every file. Mixed mode accepts both plaintext and ciphertext,
 *      so a half-swept connection never trips the fatal guard while the reopened
 *      (wrapping) worker uploads ciphertext file by file.
 *   2. `completeContentEncryption` flips the manifest to `strict` once the sweep is
 *      done — after which a plaintext download is a fatal protocol violation.
 *
 * The caller (VaultContext) reopens the vault after each step so the sync target is
 * (re-)wrapped in the EncryptingSyncTarget with the correct mode.
 */
import { SyncQueue, type IDatabaseAdapter, type ISyncTarget } from "@plainva/core";
import { loadCachedMasterKey } from "./encryptionSession";
import { getActiveConnectionId, getDeviceId } from "./settingsProfile";
import { getSettingsStore } from "./settingsStore";
import { saveConnectionState, writeMigratingManifest, writeStrictManifest } from "./encryptionManifest";

export class EncryptionActivationError extends Error {
  constructor(public readonly code: "locked" | "no-connection") {
    super(`content-E2E activation failed: ${code}`);
    this.name = "EncryptionActivationError";
  }
}

/**
 * Activates content-E2E for the active connection: publishes the migrating manifest,
 * pins the local connection state as encrypted, and force-enqueues a full re-encrypt
 * sweep. Returns how many files were queued. Requires an unlocked master key.
 */
export async function activateContentEncryption(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
}): Promise<{ queued: number }> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  if (!mk) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const deviceId = await getDeviceId(await getSettingsStore());

  // 1. Publish the migrating (mixed) manifest so every device treats this
  //    connection as encrypted and the fail-closed guard engages.
  await writeMigratingManifest(opts.rawTarget, mk, connectionId, deviceId);
  // 2. Pin this device's knowledge that the connection is encrypted, so a later
  //    missing/downgraded manifest fails closed instead of trusting plaintext.
  await saveConnectionState({
    connectionId,
    knownEncrypted: true,
    expectedKeyId: mk.keyId,
    lastGeneration: 1,
  });
  // 3. Force-enqueue every file for re-encryption. The reopened (wrapping) worker
  //    pushes each one as ciphertext; the local vault stays plaintext.
  const queued = await new SyncQueue(opts.dbAdapter).enqueueAllForReencrypt();
  return { queued };
}

/** Completes the migration: rewrites the connection's manifest as `strict`. */
export async function completeContentEncryption(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
}): Promise<void> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  if (!mk) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  await writeStrictManifest(opts.rawTarget, mk, connectionId);
}
