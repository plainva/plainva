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
import { KEYFILE_SYNC_PATH, SyncQueue, isSealedBlob, openBlob, readBlobKeyId, type IDatabaseAdapter, type ISyncTarget, type IVaultAdapter, type Keyfile, type ManifestBody } from "@plainva/core";
import { finishSessionRotation, loadCachedMasterKey, loadCachedMasterKeys, prepareSessionRotation, restoreSessionKeyfile } from "./encryptionSession";
import { getActiveConnectionId, getDeviceId } from "./settingsProfile";
import { getSettingsStore } from "./settingsStore";
import { GUARD_VERSION, loadConnectionState, readVerifiedManifest, readVerifiedManifestWithKeys, saveConnectionState, writeLifecycleManifest, writeMigratingManifest, writePreparingManifest, writeStrictManifest } from "./encryptionManifest";

export class EncryptionActivationError extends Error {
  constructor(public readonly code: "locked" | "no-connection" | "queue-not-clean" | "inventory-mismatch" | "sweep-incomplete" | "not-owner" | "remote-not-encrypted" | "invalid-state") {
    super(`content-E2E activation failed: ${code}`);
    this.name = "EncryptionActivationError";
  }
}

interface MigrationJournal {
  connectionId: string;
  generation: number;
  ownerDeviceId: string;
  mode: "encrypt" | "decrypt" | "rotate";
  /** The exact set of user files covered by this migration. ETags intentionally
   * are not persisted: every forced rewrite changes them. */
  paths: string[];
  startedAt: string;
}

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const journalKey = (connectionId: string) => `e2eMigration_${b64(connectionId)}`;
const normalRemoteEntries = (etagMap: Map<string, string>) =>
  [...etagMap.entries()].filter(([path]) => !path.startsWith(".plainva/sync/")).sort(([a], [b]) => a.localeCompare(b));

async function localInventory(vault: IVaultAdapter): Promise<string[]> {
  const entries = await vault.listDir("", true);
  return entries
    .filter((e) => !e.isDirectory && !e.path.startsWith(".plainva/") && !e.path.includes(".CONFLICT"))
    .map((e) => e.path)
    .sort();
}

async function remoteInventory(target: ISyncTarget) {
  return normalRemoteEntries((await target.pull()).etagMap).map(([path, etag]) => ({ path, etag }));
}

async function assertStableInventory(target: ISyncTarget, expectedPaths?: string[]) {
  const first = await remoteInventory(target);
  if (expectedPaths && JSON.stringify(first.map(({ path }) => path)) !== JSON.stringify(expectedPaths)) {
    throw new EncryptionActivationError("inventory-mismatch");
  }
  const second = await remoteInventory(target);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new EncryptionActivationError("inventory-mismatch");
  return first;
}

function lifecycleBody(
  previous: ManifestBody,
  state: ManifestBody["state"],
  ownerDeviceId: string,
  generation: number,
  keyId = previous.keyId,
  newKeyId?: string
): ManifestBody {
  return {
    formatVersion: 1,
    minGuardVersion: GUARD_VERSION,
    connectionId: previous.connectionId,
    keyId,
    ...(newKeyId ? { newKeyId } : {}),
    state,
    ownerDeviceId,
    ownerLeaseUntil: ownerDeviceId ? Date.now() + 24 * 60 * 60 * 1000 : 0,
    generation,
    createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

async function requireCleanQueue(dbAdapter: IDatabaseAdapter): Promise<SyncQueue> {
  const queue = new SyncQueue(dbAdapter);
  const state = await queue.getEncryptionSweepStatus();
  if (state.pending > 0 || state.failed > 0 || state.manual > 0) throw new EncryptionActivationError("queue-not-clean");
  return queue;
}

async function assertMatchingLocalRemote(rawVault: IVaultAdapter, rawTarget: ISyncTarget) {
  const inventory = await assertStableInventory(rawTarget);
  const paths = inventory.map(({ path }) => path);
  if (JSON.stringify(paths) !== JSON.stringify(await localInventory(rawVault))) {
    throw new EncryptionActivationError("inventory-mismatch");
  }
  return paths;
}

async function pushKeyfile(target: ISyncTarget, keyfile: Keyfile): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(keyfile, null, 2));
  await target.push({ id: 0, file_path: KEYFILE_SYNC_PATH, operation: "write", content: bytes, retry_count: 0, next_retry_at: 0, queued_at: 0 });
  const roundTrip = await target.download(KEYFILE_SYNC_PATH);
  if (!roundTrip || new TextDecoder().decode(roundTrip as BufferSource) !== new TextDecoder().decode(bytes)) {
    throw new Error("keyfile did not round-trip");
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
  rawVault: IVaultAdapter;
}): Promise<{ queued: number }> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  if (!mk) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const deviceId = await getDeviceId(await getSettingsStore());
  const queue = await requireCleanQueue(opts.dbAdapter);

  const existing = await readVerifiedManifest(opts.rawTarget, mk);
  if (existing && existing.connectionId !== connectionId) throw new EncryptionActivationError("inventory-mismatch");
  if (existing && existing.state !== "plain" && !(["preparing", "migrating"].includes(existing.state) && existing.ownerDeviceId === deviceId)) {
    throw new EncryptionActivationError("not-owner");
  }
  const generation = existing && ["preparing", "migrating"].includes(existing.state) ? existing.generation : Math.max(existing?.generation ?? 0, (await loadConnectionState(connectionId)).lastGeneration ?? 0) + 1;
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const inventory = await assertStableInventory(opts.rawTarget);
  const remotePaths = inventory.map((e) => e.path);
  const localPaths = await localInventory(opts.rawVault);
  if (JSON.stringify(remotePaths) !== JSON.stringify(localPaths)) throw new EncryptionActivationError("inventory-mismatch");

  if (existing?.state !== "migrating") {
    // Publish + verify preparing before the mixed state. A concurrent writer is
    // detected by the read-back, before any content is transformed.
    if (existing?.state !== "preparing") await writePreparingManifest(opts.rawTarget, mk, connectionId, deviceId, generation, createdAt);
    await writeMigratingManifest(opts.rawTarget, mk, connectionId, deviceId, generation, createdAt);
  }
  // 2. Pin this device's knowledge that the connection is encrypted, so a later
  //    missing/downgraded manifest fails closed instead of trusting plaintext.
  await saveConnectionState({
    connectionId,
    knownEncrypted: true,
    expectedKeyId: mk.keyId,
    lastGeneration: generation,
  });
  const store = await getSettingsStore();
  await store.set(journalKey(connectionId), { connectionId, generation, ownerDeviceId: deviceId, mode: "encrypt", paths: remotePaths, startedAt: new Date().toISOString() } satisfies MigrationJournal);
  await store.save();
  // 3. Force-enqueue every file for re-encryption. The reopened (wrapping) worker
  //    pushes each one as ciphertext; the local vault stays plaintext.
  const queued = await queue.enqueueAllForReencrypt();
  return { queued };
}

/** Starts a reverse sweep. Ciphertext remains readable until every file is plain. */
export async function deactivateContentEncryption(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
  rawVault: IVaultAdapter;
}): Promise<{ queued: number }> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  if (!mk) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const queue = await requireCleanQueue(opts.dbAdapter);
  const manifest = await readVerifiedManifest(opts.rawTarget, mk);
  if (!manifest || manifest.connectionId !== connectionId || manifest.state !== "strict") throw new EncryptionActivationError("invalid-state");
  const deviceId = await getDeviceId(await getSettingsStore());
  const generation = Math.max(manifest.generation, (await loadConnectionState(connectionId)).lastGeneration ?? 0) + 1;
  const paths = await assertMatchingLocalRemote(opts.rawVault, opts.rawTarget);
  await writeLifecycleManifest(opts.rawTarget, mk, lifecycleBody(manifest, "decrypting", deviceId, generation));
  const store = await getSettingsStore();
  await store.set(journalKey(connectionId), { connectionId, generation, ownerDeviceId: deviceId, mode: "decrypt", paths, startedAt: new Date().toISOString() } satisfies MigrationJournal);
  await store.save();
  await saveConnectionState({ connectionId, knownEncrypted: true, expectedKeyId: mk.keyId, lastGeneration: generation });
  return { queued: await queue.enqueueAllForReencrypt() };
}

/** Publishes the authenticated plain tombstone after the reverse sweep. */
export async function completeContentDecryption(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
}): Promise<void> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  if (!mk) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const manifest = await readVerifiedManifest(opts.rawTarget, mk);
  const store = await getSettingsStore();
  const journal = await store.get<MigrationJournal>(journalKey(connectionId));
  const deviceId = await getDeviceId(store);
  if (!manifest || manifest.state !== "decrypting" || !journal || journal.mode !== "decrypt" || journal.ownerDeviceId !== deviceId || journal.generation !== manifest.generation) {
    throw new EncryptionActivationError("not-owner");
  }
  const queue = await new SyncQueue(opts.dbAdapter).getEncryptionSweepStatus();
  if (queue.pending > 0 || queue.failed > 0 || queue.manual > 0) throw new EncryptionActivationError("sweep-incomplete");
  const inventory = await assertStableInventory(opts.rawTarget, journal.paths);
  for (const { path } of inventory) {
    const bytes = await opts.rawTarget.download(path);
    if (!bytes || isSealedBlob(bytes)) throw new EncryptionActivationError("remote-not-encrypted");
  }
  await assertStableInventory(opts.rawTarget, journal.paths);
  await writeLifecycleManifest(opts.rawTarget, mk, lifecycleBody(manifest, "plain", "", manifest.generation));
  await store.delete(journalKey(connectionId));
  await store.save();
  await saveConnectionState({ connectionId, knownEncrypted: false, lastGeneration: manifest.generation });
}

/** Creates a new key, publishes it before the rotating manifest, then starts a full rewrite. */
export async function rotateContentEncryptionKey(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
  rawVault: IVaultAdapter;
  passphrase: string;
}): Promise<{ queued: number; newKeyId: string }> {
  const current = await loadCachedMasterKey(opts.vaultPath);
  if (!current) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const queue = await requireCleanQueue(opts.dbAdapter);
  const manifest = await readVerifiedManifest(opts.rawTarget, current);
  if (!manifest || manifest.connectionId !== connectionId || manifest.state !== "strict") throw new EncryptionActivationError("invalid-state");
  const paths = await assertMatchingLocalRemote(opts.rawVault, opts.rawTarget);
  const rotation = await prepareSessionRotation(opts.vaultPath, opts.rawVault, opts.passphrase);
  const deviceId = await getDeviceId(await getSettingsStore());
  const generation = Math.max(manifest.generation, (await loadConnectionState(connectionId)).lastGeneration ?? 0) + 1;
  try {
    // Other devices must be able to obtain both keys before they can observe the
    // rotating manifest. The manifest is still authenticated by the old key.
    await pushKeyfile(opts.rawTarget, rotation.keyfile);
    await writeLifecycleManifest(opts.rawTarget, rotation.oldBundle, lifecycleBody(manifest, "rotating", deviceId, generation, rotation.oldBundle.keyId, rotation.newBundle.keyId));
  } catch (error) {
    await restoreSessionKeyfile(opts.vaultPath, opts.rawVault, rotation.previousKeyfile, rotation.oldBundle);
    await pushKeyfile(opts.rawTarget, rotation.previousKeyfile).catch(() => undefined);
    throw error;
  }
  const store = await getSettingsStore();
  await store.set(journalKey(connectionId), { connectionId, generation, ownerDeviceId: deviceId, mode: "rotate", paths, startedAt: new Date().toISOString() } satisfies MigrationJournal);
  await store.save();
  await saveConnectionState({ connectionId, knownEncrypted: true, expectedKeyId: rotation.oldBundle.keyId, lastGeneration: generation });
  return { queued: await queue.enqueueAllForReencrypt(), newKeyId: rotation.newBundle.keyId };
}

/** Verifies the new key on every blob, commits strict, then removes the old key. */
export async function completeContentKeyRotation(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
  rawVault: IVaultAdapter;
}): Promise<void> {
  const keys = await loadCachedMasterKeys(opts.vaultPath);
  const active = await loadCachedMasterKey(opts.vaultPath);
  if (!active || keys.size < 2) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const manifest = await readVerifiedManifestWithKeys(opts.rawTarget, keys);
  const store = await getSettingsStore();
  const journal = await store.get<MigrationJournal>(journalKey(connectionId));
  const deviceId = await getDeviceId(store);
  if (!manifest || manifest.state !== "rotating" || manifest.newKeyId !== active.keyId || !journal || journal.mode !== "rotate" || journal.ownerDeviceId !== deviceId || journal.generation !== manifest.generation) {
    throw new EncryptionActivationError("not-owner");
  }
  const queue = await new SyncQueue(opts.dbAdapter).getEncryptionSweepStatus();
  if (queue.pending > 0 || queue.failed > 0 || queue.manual > 0) throw new EncryptionActivationError("sweep-incomplete");
  const inventory = await assertStableInventory(opts.rawTarget, journal.paths);
  for (const { path } of inventory) {
    const bytes = await opts.rawTarget.download(path);
    if (!bytes || !isSealedBlob(bytes) || readBlobKeyId(bytes) !== active.keyId) throw new EncryptionActivationError("remote-not-encrypted");
    openBlob(active, bytes, "content");
  }
  await assertStableInventory(opts.rawTarget, journal.paths);
  await writeLifecycleManifest(opts.rawTarget, active, lifecycleBody(manifest, "strict", "", manifest.generation, active.keyId));
  const keyfile = await finishSessionRotation(opts.vaultPath, opts.rawVault, active.keyId);
  await pushKeyfile(opts.rawTarget, keyfile);
  await store.delete(journalKey(connectionId));
  await store.save();
  await saveConnectionState({ connectionId, knownEncrypted: true, expectedKeyId: active.keyId, lastGeneration: manifest.generation });
}

/** Completes the migration: rewrites the connection's manifest as `strict`. */
export async function completeContentEncryption(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
}): Promise<void> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  if (!mk) throw new EncryptionActivationError("locked");
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!connectionId) throw new EncryptionActivationError("no-connection");
  const deviceId = await getDeviceId(await getSettingsStore());
  const manifest = await readVerifiedManifest(opts.rawTarget, mk);
  if (!manifest || manifest.state !== "migrating") throw new EncryptionActivationError("remote-not-encrypted");
  if (manifest.ownerDeviceId !== deviceId) throw new EncryptionActivationError("not-owner");
  const store = await getSettingsStore();
  const journal = await store.get<MigrationJournal>(journalKey(connectionId));
  if (!journal || journal.generation !== manifest.generation || journal.ownerDeviceId !== deviceId) throw new EncryptionActivationError("not-owner");
  const queue = await new SyncQueue(opts.dbAdapter).getEncryptionSweepStatus();
  if (queue.pending > 0 || queue.forcedPending > 0 || queue.failed > 0 || queue.manual > 0) throw new EncryptionActivationError("sweep-incomplete");
  const inventory = await assertStableInventory(opts.rawTarget, journal.paths);
  for (const { path } of inventory) {
    const bytes = await opts.rawTarget.download(path);
    if (!bytes || !isSealedBlob(bytes) || readBlobKeyId(bytes) !== mk.keyId) throw new EncryptionActivationError("remote-not-encrypted");
    openBlob(mk, bytes, "content"); // authenticates purpose + ciphertext
  }
  await assertStableInventory(opts.rawTarget, journal.paths);
  await writeStrictManifest(opts.rawTarget, mk, connectionId);
  await store.delete(journalKey(connectionId));
  await store.save();
  await saveConnectionState({ connectionId, knownEncrypted: true, expectedKeyId: mk.keyId, lastGeneration: manifest.generation });
}

/** Crash-resume hook called at vault open before the worker starts. */
export async function resumeContentEncryptionIfOwned(opts: {
  vaultPath: string;
  rawTarget: ISyncTarget;
  dbAdapter: IDatabaseAdapter;
  rawVault?: IVaultAdapter;
}): Promise<number> {
  const mk = await loadCachedMasterKey(opts.vaultPath);
  const connectionId = await getActiveConnectionId(opts.vaultPath);
  if (!mk || !connectionId) return 0;
  const keys = await loadCachedMasterKeys(opts.vaultPath);
  let manifest = await readVerifiedManifestWithKeys(opts.rawTarget, keys).catch(() => null);
  if (!manifest) return 0;
  const store = await getSettingsStore();
  const deviceId = await getDeviceId(store);
  let journal = await store.get<MigrationJournal>(journalKey(connectionId));
  // Rotation committed strict but pruning the old keyfile failed: finish that
  // harmless cleanup on the next open.
  if (manifest.state === "strict" && journal?.mode === "rotate" && opts.rawVault && manifest.keyId === mk.keyId) {
    const keyfile = await finishSessionRotation(opts.vaultPath, opts.rawVault, mk.keyId);
    await pushKeyfile(opts.rawTarget, keyfile);
    await store.delete(journalKey(connectionId));
    await store.save();
    return 0;
  }
  if (!["preparing", "migrating", "decrypting", "rotating"].includes(manifest.state)) return 0;
  if (manifest.ownerDeviceId !== deviceId) {
    // A crashed/offline owner must not strand the connection forever. Once its
    // signed lease has expired, a device with the full key ring and an exact
    // local/remote inventory may adopt the SAME generation and repeat the
    // idempotent sweep. Active leases are never stolen automatically.
    if (!opts.rawVault || manifest.ownerLeaseUntil > Date.now()) return 0;
    const queueState = await new SyncQueue(opts.dbAdapter).getEncryptionSweepStatus();
    if (queueState.pending > 0 || queueState.failed > 0 || queueState.manual > 0) return 0;
    const signingKey = keys.get(manifest.keyId);
    if (!signingKey) return 0;
    const paths = await assertMatchingLocalRemote(opts.rawVault, opts.rawTarget);
    const adopted: ManifestBody = {
      ...manifest,
      ownerDeviceId: deviceId,
      ownerLeaseUntil: Date.now() + 24 * 60 * 60 * 1000,
      updatedAt: new Date().toISOString(),
    };
    await writeLifecycleManifest(opts.rawTarget, signingKey, adopted);
    manifest = adopted;
    const mode: MigrationJournal["mode"] = manifest.state === "decrypting" ? "decrypt" : manifest.state === "rotating" ? "rotate" : "encrypt";
    journal = { connectionId, generation: manifest.generation, ownerDeviceId: deviceId, mode, paths, startedAt: new Date().toISOString() };
    await store.set(journalKey(connectionId), journal);
    await store.save();
  }
  if (manifest.state === "preparing") {
    await writeMigratingManifest(opts.rawTarget, mk, connectionId, deviceId, manifest.generation, manifest.createdAt);
    manifest.state = "migrating";
  }
  if (!journal || journal.ownerDeviceId !== deviceId || journal.generation !== manifest.generation) {
    const paths = (await assertStableInventory(opts.rawTarget)).map(({ path }) => path);
    const mode: MigrationJournal["mode"] = manifest.state === "decrypting" ? "decrypt" : manifest.state === "rotating" ? "rotate" : "encrypt";
    journal = { connectionId, generation: manifest.generation, ownerDeviceId: deviceId, mode, paths, startedAt: new Date().toISOString() };
    await store.set(journalKey(connectionId), journal);
    await store.save();
  }
  return new SyncQueue(opts.dbAdapter).enqueueAllForReencrypt();
}
