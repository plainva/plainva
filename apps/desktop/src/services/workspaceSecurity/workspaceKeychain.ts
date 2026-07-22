import {
  DEFAULT_KDF_PARAMS,
  aeadDecrypt,
  aeadEncrypt,
  aeadNonce,
  canonicalJson,
  deriveKek,
  encodeWorkspaceDocument,
  fromBase64,
  parseWorkspaceDocument,
  toBase64,
  utf8Decode,
  utf8Encode,
  type KdfParams,
  type PersonalWorkspaceRuntime,
  type WorkspaceDeviceIdentity,
  type WorkspaceGroupKeyEpoch,
} from "@plainva/core";
import { credentialManager } from "../CredentialManager";
import { getSettingsStore } from "../settingsStore";

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

interface SerializedWorkspaceRuntime {
  version: 1;
  workspaceId: string;
  ownerMemberId: string;
  device: {
    publicIdentity: WorkspaceDeviceIdentity["publicIdentity"];
    signingPublicKey: string;
    signingPrivateKey: string;
    hpkePublicKey: string;
    hpkePrivateKey: string;
  };
  ownerGroup: {
    groupId: string;
    keyEpoch: number;
    hpkePublicKey: string;
    hpkePrivateKey: string;
    catalogKey: string;
  };
  genesis: string;
  policy: string;
  grants: string[];
}

interface NativeEnvelope {
  storage: "native";
  runtime: SerializedWorkspaceRuntime;
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
const sessionLocked = new Set<string>();
const b64Path = (path: string) => btoa(unescape(encodeURIComponent(path)));
const secretKey = (vaultPath: string) => `workspace_v1_${b64Path(vaultPath)}`;
export const workspaceSecurityStatusKey = (vaultPath: string) => `workspaceSecurity_${b64Path(vaultPath)}`;
// Keep this as a string at module scope. Calling an imported helper during
// module initialization creates a production-only chunk-cycle hazard.
const FALLBACK_AAD_LABEL = "plainva/workspace/device-key-bundle/v1";
const fallbackAad = () => utf8Encode(FALLBACK_AAD_LABEL);

function serializeRuntime(runtime: PersonalWorkspaceRuntime): SerializedWorkspaceRuntime {
  return {
    version: 1,
    workspaceId: runtime.workspaceId,
    ownerMemberId: runtime.ownerMemberId,
    device: {
      publicIdentity: runtime.device.publicIdentity,
      signingPublicKey: toBase64(runtime.device.secrets.signing.publicKey),
      signingPrivateKey: toBase64(runtime.device.secrets.signing.privateKey),
      hpkePublicKey: toBase64(runtime.device.secrets.hpke.publicKey),
      hpkePrivateKey: toBase64(runtime.device.secrets.hpke.privateKey),
    },
    ownerGroup: {
      groupId: runtime.ownerGroup.groupId,
      keyEpoch: runtime.ownerGroup.keyEpoch,
      hpkePublicKey: toBase64(runtime.ownerGroup.hpke.publicKey),
      hpkePrivateKey: toBase64(runtime.ownerGroup.hpke.privateKey),
      catalogKey: toBase64(runtime.ownerGroup.catalogKey),
    },
    genesis: toBase64(encodeWorkspaceDocument(runtime.genesis)),
    policy: toBase64(encodeWorkspaceDocument(runtime.policy)),
    grants: runtime.grants.map((grant) => toBase64(encodeWorkspaceDocument(grant))),
  };
}

function deserializeRuntime(value: SerializedWorkspaceRuntime): PersonalWorkspaceRuntime {
  if (value?.version !== 1) throw new Error("Unsupported encrypted-workspace key bundle");
  const device: WorkspaceDeviceIdentity = {
    publicIdentity: value.device.publicIdentity,
    secrets: {
      signing: { publicKey: fromBase64(value.device.signingPublicKey), privateKey: fromBase64(value.device.signingPrivateKey) },
      hpke: { publicKey: fromBase64(value.device.hpkePublicKey), privateKey: fromBase64(value.device.hpkePrivateKey) },
    },
  };
  const ownerGroup: WorkspaceGroupKeyEpoch = {
    groupId: value.ownerGroup.groupId,
    keyEpoch: value.ownerGroup.keyEpoch,
    hpke: { publicKey: fromBase64(value.ownerGroup.hpkePublicKey), privateKey: fromBase64(value.ownerGroup.hpkePrivateKey) },
    catalogKey: fromBase64(value.ownerGroup.catalogKey),
  };
  const genesis = parseWorkspaceDocument(fromBase64(value.genesis));
  const policy = parseWorkspaceDocument(fromBase64(value.policy));
  if (genesis.kind !== "genesis" || policy.kind !== "policy") throw new Error("Encrypted-workspace key bundle has invalid control documents");
  return {
    workspaceId: value.workspaceId,
    ownerMemberId: value.ownerMemberId,
    device,
    ownerGroup,
    genesis: genesis as PersonalWorkspaceRuntime["genesis"],
    policy: policy as PersonalWorkspaceRuntime["policy"],
    grants: value.grants.map((grant) => {
      const parsed = parseWorkspaceDocument(fromBase64(grant));
      if (parsed.kind !== "grant") throw new Error("Encrypted-workspace key bundle has an invalid grant");
      return parsed as PersonalWorkspaceRuntime["grants"][number];
    }),
  };
}

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
  const serialized = serializeRuntime(input.runtime);
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
    const kek = await deriveKek(input.fallbackPassphrase, salt, DEFAULT_KDF_PARAMS);
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
  const runtime = deserializeRuntime(envelope.runtime);
  cache.set(vaultPath, runtime);
  return runtime;
}

export async function unlockWorkspaceRuntime(vaultPath: string, passphrase?: string): Promise<PersonalWorkspaceRuntime> {
  sessionLocked.delete(vaultPath);
  const envelope = await credentialManager.readSecret<StoredWorkspaceRuntime>(secretKey(vaultPath));
  if (!envelope) throw new Error("workspace-key-bundle-missing");
  let runtime: PersonalWorkspaceRuntime;
  if (envelope.storage === "native") {
    runtime = deserializeRuntime(envelope.runtime);
  } else {
    if (!passphrase) throw new Error("workspace-passphrase-required");
    const kek = await deriveKek(passphrase, fromBase64(envelope.salt), envelope.params);
    let plaintext: Uint8Array;
    try {
      plaintext = aeadDecrypt(kek, fromBase64(envelope.nonce), fromBase64(envelope.ciphertext), fallbackAad());
    } catch {
      throw new Error("workspace-wrong-passphrase");
    }
    runtime = deserializeRuntime(JSON.parse(utf8Decode(plaintext)) as SerializedWorkspaceRuntime);
  }
  cache.set(vaultPath, runtime);
  return runtime;
}

export function lockWorkspaceRuntime(vaultPath: string): void {
  cache.delete(vaultPath);
  sessionLocked.add(vaultPath);
}

export async function clearWorkspaceRuntime(vaultPath: string): Promise<void> {
  cache.delete(vaultPath);
  sessionLocked.delete(vaultPath);
  await credentialManager.removeSecret(secretKey(vaultPath));
  const store = await getSettingsStore();
  await store.delete(workspaceSecurityStatusKey(vaultPath));
  await store.save();
}
