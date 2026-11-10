import { probeRemoteGenesis } from "@plainva/core";
import { sameSyncTarget, type SyncStateBinding } from "./syncStateBinding";

/**
 * Whether a vault that has NOT joined an encrypted workspace may start the
 * plain file sync against its cloud folder (R8 follow-up, both shells).
 *
 * The plain sync knows nothing of a workspace. Started against a folder that
 * holds one, it pushes this device's notes up as plain text next to the
 * encrypted objects - the one thing encryption exists to prevent. The phone
 * therefore probed for `.pvws/genesis.pvgen` before each start, but let a
 * FAILED probe through ("we cannot confirm a workspace"); the desktop did not
 * probe at all.
 *
 * What a probe once found is a fact of the vault, kept apart from the sync
 * records (a reset of those never forgets it), per destination:
 *
 *  - `encrypted`: the folder holds a workspace this device has not joined.
 *    Learned from a probe that found the genesis, or from the connect wizard
 *    that bound the vault to such a folder. Until the device joins, nothing
 *    starts the plain sync - not a failed probe, not a probe that comes back
 *    empty (a listing that missed a file is exactly what a provider does on a
 *    bad day). It is a recoverable state, retried with the next start.
 *  - `released`: this device left the workspace on purpose - lifting the
 *    encryption, or decommissioning it here. The folder keeps its `.pvws/`
 *    objects (they are immutable), and the plain sync is what the person asked
 *    for, so it runs.
 *
 * Joining clears the fact (the encrypted worker takes over), and so does
 * another destination: the fact speaks about one folder.
 */
export interface EncryptedRemoteFact {
  v: 1;
  state: "encrypted" | "released";
  /** The folder it speaks about; absent where it was written before the folder was read (the wizard). */
  binding?: SyncStateBinding;
}

export interface EncryptedRemotePorts {
  load(): Promise<unknown>;
  save(fact: EncryptedRemoteFact): Promise<void>;
  clear(): Promise<void>;
}

export type EncryptedRemoteGate =
  /** No workspace is known or found: the plain sync may start. A failed probe is handed on for the log. */
  | { kind: "plain"; probeError: unknown | null }
  /** The folder holds a workspace this device has not joined: pair or recover first. */
  | { kind: "pair-required" }
  /** The vault is known to sit on an encrypted workspace and the probe could not confirm it now: try again later. */
  | { kind: "unconfirmed"; probeError: unknown | null };

function readFact(stored: unknown): EncryptedRemoteFact | null {
  if (!stored || typeof stored !== "object") return null;
  const fact = stored as Partial<EncryptedRemoteFact>;
  return fact.v === 1 && (fact.state === "encrypted" || fact.state === "released") ? (fact as EncryptedRemoteFact) : null;
}

/** The fact for this destination, or null. A fact without a folder adopts this one. */
async function factFor(ports: EncryptedRemotePorts, binding: SyncStateBinding): Promise<EncryptedRemoteFact | null> {
  const fact = readFact(await ports.load().catch(() => null));
  if (!fact) return null;
  if (!fact.binding) {
    const adopted: EncryptedRemoteFact = { ...fact, binding };
    await ports.save(adopted);
    return adopted;
  }
  if (sameSyncTarget(fact.binding, binding)) return fact;
  await ports.clear();
  return null;
}

export async function decideEncryptedRemote(input: {
  ports: EncryptedRemotePorts;
  binding: SyncStateBinding;
  /** Reads `.pvws/genesis.pvgen` through the vault's own target. */
  readGenesis: () => Promise<Uint8Array | null>;
}): Promise<EncryptedRemoteGate> {
  const fact = await factFor(input.ports, input.binding);
  if (fact?.state === "released") return { kind: "plain", probeError: null };
  const probe = await probeRemoteGenesis(input.readGenesis);
  if (probe.encryptedGenesisFound) {
    if (fact?.state !== "encrypted") await input.ports.save({ v: 1, state: "encrypted", binding: input.binding });
    return { kind: "pair-required" };
  }
  if (fact?.state === "encrypted") return { kind: "unconfirmed", probeError: probe.probeError };
  return { kind: "plain", probeError: probe.probeError };
}

/** The connect wizard bound this vault to a folder that holds a workspace. */
export async function markEncryptedRemote(ports: EncryptedRemotePorts, binding?: SyncStateBinding): Promise<void> {
  await ports.save({ v: 1, state: "encrypted", ...(binding ? { binding } : {}) });
}

/** This device lifted or decommissioned the workspace: the plain sync is what the person asked for. */
export async function markEncryptedRemoteReleased(ports: EncryptedRemotePorts): Promise<void> {
  await ports.save({ v: 1, state: "released" });
}

/** The device joined: the encrypted worker runs, the fact has served. */
export async function clearEncryptedRemote(ports: EncryptedRemotePorts): Promise<void> {
  if (readFact(await ports.load().catch(() => null))) await ports.clear();
}

/** The settings key both shells keep the fact under, per vault. */
export const encryptedRemoteKey = (vaultKey: string): string => `encryptedRemote_${vaultKey}`;

/** The ports over a settings store, as both shells keep it. */
export function encryptedRemoteSettingsPorts(
  store: { get<T>(key: string): Promise<T | null | undefined>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown>; save(): Promise<void> },
  vaultKey: string,
): EncryptedRemotePorts {
  const key = encryptedRemoteKey(vaultKey);
  return {
    load: async () => (await store.get<EncryptedRemoteFact>(key)) ?? null,
    save: async (fact) => { await store.set(key, fact); await store.save(); },
    clear: async () => { await store.delete(key); await store.save(); },
  };
}

/** A start held back because the workspace could not be confirmed tries again after this long. */
export const ENCRYPTED_REMOTE_RETRY_MS = 60_000;
