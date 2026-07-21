/**
 * Desktop content-E2E manifest + per-connection state (settings-sync plan §3.5,
 * P4/P5). Reads the remote `encryption.json` and persists what THIS device knows
 * about a sync connection's E2E status (locally, keyed by the connection
 * fingerprint), so the fail-closed guard can distinguish "never encrypted"
 * (trust-on-first-use plaintext) from "known encrypted" (missing manifest =
 * fatal). No key material is stored here — only the public fingerprint, the
 * known-encrypted flag, the last accepted generation and the expected key id.
 */
import {
  ENCRYPTION_MANIFEST_PATH,
  connectionFingerprint,
  type ConnectionE2EState,
  type ISyncTarget,
} from "@plainva/core";
import { getSettingsStore } from "./settingsStore";

/** This app's guard version (must be >= manifest.minGuardVersion). */
export const GUARD_VERSION = 1;

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const stateKey = (connectionId: string) => `e2eState_${b64(connectionId)}`;

/** Loads this device's known E2E state for a connection (default: never encrypted). */
export async function loadConnectionState(connectionId: string): Promise<ConnectionE2EState> {
  const s = await getSettingsStore();
  const stored = await s.get<Partial<ConnectionE2EState>>(stateKey(connectionId));
  return {
    connectionId,
    knownEncrypted: stored?.knownEncrypted === true,
    lastGeneration: typeof stored?.lastGeneration === "number" ? stored.lastGeneration : undefined,
    expectedKeyId: typeof stored?.expectedKeyId === "string" ? stored.expectedKeyId : undefined,
  };
}

export async function saveConnectionState(state: ConnectionE2EState): Promise<void> {
  const s = await getSettingsStore();
  await s.set(stateKey(state.connectionId), state);
  await s.save();
}

/** Reads the raw remote manifest text, or null when absent. */
export async function readRemoteManifest(target: ISyncTarget): Promise<string | null> {
  const bytes = await target.download(ENCRYPTION_MANIFEST_PATH);
  return bytes ? new TextDecoder().decode(bytes as BufferSource) : null;
}

/** The connection fingerprint for a provider + remote root (re-exported helper). */
export function connectionIdFor(provider: string, remoteRoot: string): string {
  return connectionFingerprint(provider, remoteRoot);
}
