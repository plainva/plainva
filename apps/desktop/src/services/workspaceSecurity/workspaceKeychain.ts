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
  phase: "preparing" | "migrating" | "active" | "locked" | "error";
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

export async function getWorkspaceSecurityStatus(vaultPath: string): Promise<WorkspaceSecurityPublicStatus | null> {
  return (await getSettingsStore()).get<WorkspaceSecurityPublicStatus>(workspaceSecurityStatusKey(vaultPath)).then((status) => status ?? null);
}

export async function saveWorkspaceSecurityStatus(vaultPath: string, status: WorkspaceSecurityPublicStatus): Promise<void> {
  const store = await getSettingsStore();
  await store.set(workspaceSecurityStatusKey(vaultPath), status);
  await store.save();
  window.dispatchEvent(new CustomEvent("plainva-workspace-security-changed"));
}

export async function persistWorkspaceRuntime(input: {
  vaultPath: string;
  runtime: PersonalWorkspaceRuntime;
  fingerprint: string;
  recoveryConfirmedAt: string;
  fallbackPassphrase?: string;
}): Promise<WorkspaceSecurityPublicStatus> {
  const serialized = serializePersonalWorkspaceRuntime(input.runtime);
  const native = await credentialManager.checkKeychainStatus() === "native";
  let envelope: StoredWorkspaceRuntime;
  let keyStorage: WorkspaceKeyStorage;
  if (native) {
    envelope = { storage: "native", runtime: serialized };
    keyStorage = "native";
  } else {
    if (!input.fallbackPassphrase || input.fallbackPassphrase.length < 10) throw new Error("workspace-fallback-passphrase-required");
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
    keyStorage = "passphrase";
  }
  await credentialManager.writeSecret(secretKey(input.vaultPath), envelope);
  cache.set(input.vaultPath, input.runtime);
  sessionLocked.delete(input.vaultPath);
  const status: WorkspaceSecurityPublicStatus = {
    version: 1,
    workspaceId: input.runtime.workspaceId,
    fingerprint: input.fingerprint,
    phase: "preparing",
    recoveryConfirmedAt: input.recoveryConfirmedAt,
    keyStorage,
    deviceName: input.runtime.device.publicIdentity.displayName,
    lastError: null,
  };
  await saveWorkspaceSecurityStatus(input.vaultPath, status);
  return status;
}

export async function loadWorkspaceRuntime(vaultPath: string): Promise<PersonalWorkspaceRuntime | null> {
  if (sessionLocked.has(vaultPath)) return null;
  const remembered = cache.get(vaultPath);
  if (remembered) return remembered;
  const envelope = await credentialManager.readSecret<StoredWorkspaceRuntime>(secretKey(vaultPath));
  if (!envelope || envelope.storage !== "native") return null;
  const runtime = deserializePersonalWorkspaceRuntime(envelope.runtime);
  cache.set(vaultPath, runtime);
  return runtime;
}

export async function unlockWorkspaceRuntime(vaultPath: string, passphrase?: string): Promise<PersonalWorkspaceRuntime> {
  sessionLocked.delete(vaultPath);
  const envelope = await credentialManager.readSecret<StoredWorkspaceRuntime>(secretKey(vaultPath));
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

export function lockWorkspaceRuntime(vaultPath: string): void {
  cache.delete(vaultPath);
  const kek = sessionKeks.get(vaultPath); if (kek) wipeBytes(kek);
  sessionKeks.delete(vaultPath);
  sessionLocked.add(vaultPath);
}

/** Re-seals a changed policy/key set without making fallback users re-enter their passphrase. */
export async function updateWorkspaceRuntime(vaultPath: string, runtime: PersonalWorkspaceRuntime): Promise<void> {
  const envelope = await credentialManager.readSecret<StoredWorkspaceRuntime>(secretKey(vaultPath));
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
  cache.delete(vaultPath);
  const kek = sessionKeks.get(vaultPath); if (kek) wipeBytes(kek);
  sessionKeks.delete(vaultPath);
  sessionLocked.delete(vaultPath);
  await credentialManager.removeSecret(secretKey(vaultPath));
  const store = await getSettingsStore();
  await store.delete(workspaceSecurityStatusKey(vaultPath));
  await store.save();
}
