import {
  DEFAULT_KDF_PARAMS,
  aeadDecrypt,
  aeadEncrypt,
  aeadNonce,
  canonicalJson,
  deserializePersonalWorkspaceRuntime,
  fromBase64,
  serializePersonalWorkspaceRuntime,
  toBase64,
  utf8Decode,
  utf8Encode,
  wipeBytes,
  wipeWorkspaceRuntimeSecrets,
  type KdfParams,
  type PersonalWorkspaceRuntime,
  type SerializedPersonalWorkspaceRuntime,
} from "@plainva/core";
import { credentialManager } from "../CredentialManager";
import { getSettingsStore } from "../settingsStore";
import { deriveKekOffThread } from "./deriveKekOffThread";

export type WorkspaceKeyStorage = "native" | "passphrase";

export interface WorkspaceSecurityPublicStatus {
  version: 1;
  workspaceId: string;
  fingerprint: string;
  /**
   * `setup-incomplete` is its own answer, not a flavour of `error` (finding 2026-08-25, B7).
   * The key bundle is on this device and the conversion did not finish — that is resumable.
   * `error` means the remote workspace itself is unreadable, which needs the opposite offer,
   * so the two must not share a name.
   */
  phase: "preparing" | "migrating" | "active" | "locked" | "setup-incomplete" | "error";
  recoveryConfirmedAt: string;
  keyStorage: WorkspaceKeyStorage;
  deviceName: string;
  lastError: string | null;
}

interface NativeEnvelope {
  storage: "native";
  runtime: SerializedPersonalWorkspaceRuntime;
}

interface PassphraseEnvelope {
  storage: "passphrase";
  params: KdfParams;
  salt: string;
  nonce: string;
  ciphertext: string;
}

type StoredWorkspaceRuntime = NativeEnvelope | PassphraseEnvelope;

/**
 * What a caller learns when it asks for the runtime.
 *
 * "Locked" and "never set up" used to be the same `null` (finding 2026-08-25, B6). A
 * passphrase-protected workspace therefore looked unconfigured after every app start, while
 * the saved status still said `active` — so no surface offered the one action that helps.
 * `storage` decides the offer: a native bundle unlocks without a passphrase, a sealed one
 * needs it.
 */
export type WorkspaceRuntimeAccess =
  | { state: "unlocked"; runtime: PersonalWorkspaceRuntime }
  | { state: "locked"; storage: WorkspaceKeyStorage }
  | { state: "absent" };

const cache = new Map<string, PersonalWorkspaceRuntime>();
const sessionKeks = new Map<string, Uint8Array>();
const sessionLocked = new Set<string>();
const b64Path = (path: string) => btoa(unescape(encodeURIComponent(path)));
const secretKey = (vaultPath: string) => `workspace_v1_${b64Path(vaultPath)}`;
export const workspaceSecurityStatusKey = (vaultPath: string) => `workspaceSecurity_${b64Path(vaultPath)}`;
// Keep this as a string at module scope. Calling an imported helper during
// module initialization creates a production-only chunk-cycle hazard.
const FALLBACK_AAD_LABEL = "plainva/workspace/device-key-bundle/v1";
const fallbackAad = () => utf8Encode(FALLBACK_AAD_LABEL);
/** Stated once, so the setup wizard and the change dialog cannot drift apart. */
export const WORKSPACE_FALLBACK_PASSPHRASE_MIN_LENGTH = 10;

/**
 * The client version a workspace declares as its floor.
 *
 * Every bootstrap this app writes states it - the vault's own and each
 * publication's. Two literals would drift the first time one was raised, and a
 * publication promising a lower floor than the vault it came from would hand
 * its recipients a document their client cannot read.
 */
export const WORKSPACE_MINIMUM_CLIENT_VERSION = "0.4.1";

export async function getWorkspaceSecurityStatus(vaultPath: string): Promise<WorkspaceSecurityPublicStatus | null> {
  return (await getSettingsStore()).get<WorkspaceSecurityPublicStatus>(workspaceSecurityStatusKey(vaultPath)).then((status) => status ?? null);
}

export async function saveWorkspaceSecurityStatus(vaultPath: string, status: WorkspaceSecurityPublicStatus): Promise<void> {
  const store = await getSettingsStore();
  await store.set(workspaceSecurityStatusKey(vaultPath), status);
  await store.save();
  window.dispatchEvent(new CustomEvent("plainva-workspace-security-changed"));
}

async function storedEnvelope(vaultPath: string): Promise<StoredWorkspaceRuntime | null> {
  return (await credentialManager.readSecret<StoredWorkspaceRuntime>(secretKey(vaultPath))) ?? null;
}

async function availableKeyStorage(): Promise<WorkspaceKeyStorage> {
  return (await credentialManager.checkKeychainStatus()) === "native" ? "native" : "passphrase";
}

/**
 * Where the key bundle lies today, and where it would go if written now.
 *
 * The two drift apart on their own — a keychain that stops answering, a Linux session that
 * gains one. Persisting used to switch the bundle between them in silence (finding
 * 2026-08-25, B6), and that is a change to how the vault is protected: it gets shown and
 * confirmed instead.
 */
export async function describeWorkspaceKeyStorage(
  vaultPath: string
): Promise<{ stored: WorkspaceKeyStorage | null; available: WorkspaceKeyStorage }> {
  return { stored: (await storedEnvelope(vaultPath))?.storage ?? null, available: await availableKeyStorage() };
}

export async function persistWorkspaceRuntime(input: {
  vaultPath: string;
  runtime: PersonalWorkspaceRuntime;
  fingerprint: string;
  recoveryConfirmedAt: string;
  fallbackPassphrase?: string;
  /** Set once the user has confirmed a move between keychain and passphrase. */
  acceptStorageChange?: boolean;
  phase?: WorkspaceSecurityPublicStatus["phase"];
}): Promise<WorkspaceSecurityPublicStatus> {
  const serialized = serializePersonalWorkspaceRuntime(input.runtime);
  const keyStorage = await availableKeyStorage();
  const stored = (await storedEnvelope(input.vaultPath))?.storage ?? null;
  if (stored && stored !== keyStorage && !input.acceptStorageChange) throw new Error("workspace-key-storage-changed");
  let envelope: StoredWorkspaceRuntime;
  if (keyStorage === "native") {
    envelope = { storage: "native", runtime: serialized };
  } else {
    if (!input.fallbackPassphrase || input.fallbackPassphrase.length < WORKSPACE_FALLBACK_PASSPHRASE_MIN_LENGTH) {
      throw new Error("workspace-fallback-passphrase-required");
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const nonce = aeadNonce();
    const kek = await deriveKekOffThread(input.fallbackPassphrase, salt, DEFAULT_KDF_PARAMS);
    sessionKeks.set(input.vaultPath, new Uint8Array(kek));
    envelope = {
      storage: "passphrase",
      params: DEFAULT_KDF_PARAMS,
      salt: toBase64(salt),
      nonce: toBase64(nonce),
      ciphertext: toBase64(aeadEncrypt(kek, nonce, utf8Encode(canonicalJson(serialized)), fallbackAad())),
    };
  }
  await credentialManager.writeSecret(secretKey(input.vaultPath), envelope);
  cache.set(input.vaultPath, input.runtime);
  sessionLocked.delete(input.vaultPath);
  const status: WorkspaceSecurityPublicStatus = {
    version: 1,
    workspaceId: input.runtime.workspaceId,
    fingerprint: input.fingerprint,
    phase: input.phase ?? "preparing",
    recoveryConfirmedAt: input.recoveryConfirmedAt,
    keyStorage,
    deviceName: input.runtime.device.publicIdentity.displayName,
    lastError: null,
  };
  await saveWorkspaceSecurityStatus(input.vaultPath, status);
  return status;
}

/** Reads the runtime, and says why when there is none. */
export async function readWorkspaceRuntime(vaultPath: string): Promise<WorkspaceRuntimeAccess> {
  const remembered = cache.get(vaultPath);
  if (remembered && !sessionLocked.has(vaultPath)) return { state: "unlocked", runtime: remembered };
  const envelope = await storedEnvelope(vaultPath);
  if (!envelope) return { state: "absent" };
  if (sessionLocked.has(vaultPath)) return { state: "locked", storage: envelope.storage };
  if (envelope.storage !== "native") return { state: "locked", storage: "passphrase" };
  const runtime = deserializePersonalWorkspaceRuntime(envelope.runtime);
  cache.set(vaultPath, runtime);
  return { state: "unlocked", runtime };
}

export async function unlockWorkspaceRuntime(vaultPath: string, passphrase?: string): Promise<PersonalWorkspaceRuntime> {
  sessionLocked.delete(vaultPath);
  const envelope = await storedEnvelope(vaultPath);
  if (!envelope) throw new Error("workspace-key-bundle-missing");
  let runtime: PersonalWorkspaceRuntime;
  if (envelope.storage === "native") {
    runtime = deserializePersonalWorkspaceRuntime(envelope.runtime);
  } else {
    if (!passphrase) throw new Error("workspace-passphrase-required");
    const kek = await deriveKekOffThread(passphrase, fromBase64(envelope.salt), envelope.params);
    let plaintext: Uint8Array;
    try {
      plaintext = aeadDecrypt(kek, fromBase64(envelope.nonce), fromBase64(envelope.ciphertext), fallbackAad());
    } catch {
      throw new Error("workspace-wrong-passphrase");
    }
    runtime = deserializePersonalWorkspaceRuntime(JSON.parse(utf8Decode(plaintext)) as SerializedPersonalWorkspaceRuntime);
    sessionKeks.set(vaultPath, new Uint8Array(kek));
  }
  cache.set(vaultPath, runtime);
  return runtime;
}

/**
 * Re-wraps the key bundle under a new passphrase, with a fresh salt.
 *
 * Content encryption has had this since its keyfile existed; the workspace bundle had no way
 * to change its passphrase at all (finding 2026-08-25, B6) — and a passphrase you cannot
 * change is one you cannot retire. The current one is verified by decrypting, so a typo fails
 * before anything is written.
 */
export async function changeWorkspaceFallbackPassphrase(
  vaultPath: string,
  currentPassphrase: string,
  nextPassphrase: string
): Promise<void> {
  if (nextPassphrase.length < WORKSPACE_FALLBACK_PASSPHRASE_MIN_LENGTH) throw new Error("workspace-fallback-passphrase-required");
  const envelope = await storedEnvelope(vaultPath);
  if (!envelope) throw new Error("workspace-key-bundle-missing");
  if (envelope.storage !== "passphrase") throw new Error("workspace-passphrase-not-used");
  const currentKek = await deriveKekOffThread(currentPassphrase, fromBase64(envelope.salt), envelope.params);
  let plaintext: Uint8Array;
  try {
    plaintext = aeadDecrypt(currentKek, fromBase64(envelope.nonce), fromBase64(envelope.ciphertext), fallbackAad());
  } catch {
    throw new Error("workspace-wrong-passphrase");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = aeadNonce();
  const kek = await deriveKekOffThread(nextPassphrase, salt, DEFAULT_KDF_PARAMS);
  await credentialManager.writeSecret(secretKey(vaultPath), {
    storage: "passphrase",
    params: DEFAULT_KDF_PARAMS,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    ciphertext: toBase64(aeadEncrypt(kek, nonce, plaintext, fallbackAad())),
  } satisfies PassphraseEnvelope);
  wipeBytes(plaintext);
  wipeBytes(currentKek);
  const previous = sessionKeks.get(vaultPath);
  if (previous) wipeBytes(previous);
  sessionKeks.set(vaultPath, new Uint8Array(kek));
}

/**
 * Locks the workspace on this device: the keys are zeroed, not merely dropped.
 *
 * Every caller stops the sync worker first, because the wipe reaches the same key objects the
 * worker would sign with.
 */
export function lockWorkspaceRuntime(vaultPath: string): void {
  const runtime = cache.get(vaultPath);
  if (runtime) wipeWorkspaceRuntimeSecrets(runtime);
  cache.delete(vaultPath);
  const kek = sessionKeks.get(vaultPath); if (kek) wipeBytes(kek);
  sessionKeks.delete(vaultPath);
  // Publications lock with their vault, so their keys leave memory with it. The
  // read path already refuses while locked; this is about not leaving publisher
  // admin keys sitting in a heap the user believes they just closed.
  wipePublicationCache(vaultPath);
  sessionLocked.add(vaultPath);
}

/** Re-seals a changed policy/key set without making fallback users re-enter their passphrase. */
export async function updateWorkspaceRuntime(vaultPath: string, runtime: PersonalWorkspaceRuntime): Promise<void> {
  const envelope = await storedEnvelope(vaultPath);
  if (!envelope) throw new Error("workspace-key-bundle-missing");
  const serialized = serializePersonalWorkspaceRuntime(runtime);
  if (envelope.storage === "native") {
    await credentialManager.writeSecret(secretKey(vaultPath), { storage: "native", runtime: serialized } satisfies NativeEnvelope);
  } else {
    const kek = sessionKeks.get(vaultPath);
    if (!kek) throw new Error("workspace-passphrase-required");
    const nonce = aeadNonce();
    await credentialManager.writeSecret(secretKey(vaultPath), {
      storage: "passphrase", params: envelope.params, salt: envelope.salt, nonce: toBase64(nonce),
      ciphertext: toBase64(aeadEncrypt(kek, nonce, utf8Encode(canonicalJson(serialized)), fallbackAad())),
    } satisfies PassphraseEnvelope);
  }
  cache.set(vaultPath, runtime);
}

export async function clearWorkspaceRuntime(vaultPath: string): Promise<void> {
  const runtime = cache.get(vaultPath);
  if (runtime) wipeWorkspaceRuntimeSecrets(runtime);
  cache.delete(vaultPath);
  const kek = sessionKeks.get(vaultPath); if (kek) wipeBytes(kek);
  sessionKeks.delete(vaultPath);
  wipePublicationCache(vaultPath);
  sessionLocked.delete(vaultPath);
  await credentialManager.removeSecret(secretKey(vaultPath));
  const store = await getSettingsStore();
  await store.delete(workspaceSecurityStatusKey(vaultPath));
  await store.save();
}

/**
 * Where a publication's own runtime lives (S4b).
 *
 * A publication IS a workspace, so it has its own device key and group keys, and
 * they must not be mixed with the vault's. The slot carries BOTH ids because a
 * publication belongs to a vault: the publication id alone would collide the
 * moment two vaults publish, and the OS keychain cannot be enumerated to find
 * the mistake afterwards.
 */
const publicationSecretKey = (vaultPath: string, publicationId: string) =>
  `workspace_pub_v1_${b64Path(vaultPath)}_${publicationId}`;

const publicationCache = new Map<string, PersonalWorkspaceRuntime>();

function wipePublicationCache(vaultPath: string): void {
  const prefix = `workspace_pub_v1_${b64Path(vaultPath)}_`;
  for (const [slot, runtime] of publicationCache) {
    if (!slot.startsWith(prefix)) continue;
    wipeWorkspaceRuntimeSecrets(runtime);
    publicationCache.delete(slot);
  }
}

/**
 * Seals a publication runtime exactly the way the vault's own runtime is sealed,
 * and with the vault's session KEK.
 *
 * Two consequences, both wanted. It is never weaker than the vault it came from
 * — a publication runtime holds the publisher's admin key for that publication
 * (invite, revoke), which is strictly more than a recipient may do, so it cannot
 * sit in the clear next to a passphrase-sealed vault. And there is never a
 * second passphrase prompt: you can only create or refresh a publication while
 * the vault is unlocked, so the KEK is already in this session. When it is not,
 * that is not a case to work around — the caller unlocks the vault first.
 */
export async function persistPublicationRuntime(
  vaultPath: string,
  publicationId: string,
  runtime: PersonalWorkspaceRuntime,
): Promise<void> {
  const serialized = serializePersonalWorkspaceRuntime(runtime);
  const keyStorage = (await storedEnvelope(vaultPath))?.storage ?? (await availableKeyStorage());
  let envelope: StoredWorkspaceRuntime;
  if (keyStorage === "native") {
    envelope = { storage: "native", runtime: serialized };
  } else {
    const kek = sessionKeks.get(vaultPath);
    if (!kek) throw new Error("workspace-passphrase-required");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const nonce = aeadNonce();
    envelope = {
      storage: "passphrase",
      params: DEFAULT_KDF_PARAMS,
      // The salt is recorded for shape only: the ciphertext is sealed with the
      // vault's KEK, which was derived from the vault's own salt. Deriving a
      // second KEK here would mean a second passphrase prompt for no gain.
      salt: toBase64(salt),
      nonce: toBase64(nonce),
      ciphertext: toBase64(aeadEncrypt(kek, nonce, utf8Encode(canonicalJson(serialized)), fallbackAad())),
    };
  }
  await credentialManager.writeSecret(publicationSecretKey(vaultPath, publicationId), envelope);
  publicationCache.set(publicationSecretKey(vaultPath, publicationId), runtime);
}

/** Reads a publication runtime, and says why when there is none. */
export async function readPublicationRuntime(
  vaultPath: string,
  publicationId: string,
): Promise<WorkspaceRuntimeAccess> {
  const slot = publicationSecretKey(vaultPath, publicationId);
  const remembered = publicationCache.get(slot);
  if (remembered && !sessionLocked.has(vaultPath)) return { state: "unlocked", runtime: remembered };
  const envelope = await credentialManager.readSecret<StoredWorkspaceRuntime>(slot);
  if (!envelope) return { state: "absent" };
  // Locking the vault locks its publications with it. That is the mental model
  // ("a publication exists because the vault does"), and it is also the truth:
  // refreshing one needs the vault's runtime to read the slice in the first place.
  if (sessionLocked.has(vaultPath)) return { state: "locked", storage: envelope.storage };
  if (envelope.storage === "native") {
    const runtime = deserializePersonalWorkspaceRuntime(envelope.runtime);
    publicationCache.set(slot, runtime);
    return { state: "unlocked", runtime };
  }
  const kek = sessionKeks.get(vaultPath);
  if (!kek) return { state: "locked", storage: "passphrase" };
  const plain = aeadDecrypt(kek, fromBase64(envelope.nonce), fromBase64(envelope.ciphertext), fallbackAad());
  const runtime = deserializePersonalWorkspaceRuntime(
    JSON.parse(utf8Decode(plain)) as SerializedPersonalWorkspaceRuntime,
  );
  publicationCache.set(slot, runtime);
  return { state: "unlocked", runtime };
}

/**
 * Removes publication runtimes when a vault is forgotten.
 *
 * The ids have to be read from the state store BEFORE `clearWorkspaceState`
 * drops the table — the OS keychain cannot be enumerated, so a slot whose id is
 * gone is a publisher admin key nobody can find again. Same ordering lesson as
 * the vault-forget sweep of 2026-08-19.
 */
export async function clearPublicationRuntimes(vaultPath: string, publicationIds: string[]): Promise<void> {
  for (const publicationId of publicationIds) {
    const slot = publicationSecretKey(vaultPath, publicationId);
    const runtime = publicationCache.get(slot);
    if (runtime) wipeWorkspaceRuntimeSecrets(runtime);
    publicationCache.delete(slot);
    await credentialManager.removeSecret(slot);
  }
}
