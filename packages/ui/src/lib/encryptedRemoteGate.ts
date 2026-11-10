import { FatalSyncProtocolError, parseWorkspaceDocument, probeRemoteGenesis, workspaceDocumentHash, type ISyncTarget, type PersonalWorkspaceRuntime } from "@plainva/core";
import { sameSyncTarget, type SyncStateBinding } from "./syncStateBinding";

/**
 * Whether the plain file sync may touch a cloud folder (R8, both shells).
 *
 * The plain sync knows nothing of an encrypted workspace. Run against a folder
 * that holds one, it uploads this device's notes and settings profile as plain
 * text next to the encrypted objects - the one thing encryption exists to
 * prevent. So nothing plain touches the folder before this rule says so: not
 * the file worker, not the settings-only sync, and - per cycle, from the core
 * (`PlainRemoteGuard`) - not a worker already running when another device
 * makes the folder a workspace.
 *
 * What a probe once found is a fact of the vault, kept apart from the sync
 * records (a reset of those never forgets it), per folder:
 *
 *  - `encrypted`: the folder holds a workspace this device has not joined.
 *  - `joined`: this device is a member. Joining does not erase the knowledge:
 *    a locked phone, or one whose key went with a reinstall, has no runtime and
 *    must not fall back to the plain sync.
 *  - `released`: this device ended the workspace for this folder - it lifted
 *    the encryption as its only device and member. Recorded with the identity
 *    of the workspace it ended: the folder may be synced plainly while it holds
 *    no genesis or exactly that one, never another workspace's.
 *  - `left`: this device left a workspace that other devices still use. The
 *    folder is theirs: no plain sync into it, ever; the vault needs another folder.
 *
 * Only another folder forgets a fact.
 */
export interface EncryptedRemoteFact {
  v: 2;
  state: "encrypted" | "joined" | "released" | "left";
  /** The folder it speaks about; absent where it was written before the folder was read. */
  binding?: SyncStateBinding;
  /** The workspace the folder held (its genesis fingerprint), where known. */
  workspace?: string;
  /** Clean "not found" answers in a row while the folder is known to hold a workspace. */
  absentInARow?: number;
}

export interface EncryptedRemotePorts {
  load(): Promise<unknown>;
  save(fact: EncryptedRemoteFact): Promise<void>;
  clear(): Promise<void>;
}

/** After this many clean "not found" answers the person may decide the workspace is gone. */
export const ENCRYPTED_REMOTE_ABSENT_TO_OFFER = 3;

export type EncryptedRemoteGate =
  /** The plain sync may start. A failed probe is handed on for the log. */
  | { kind: "plain"; probeError: unknown | null }
  /** The folder holds a workspace this device has not joined: pair or recover first. */
  | { kind: "pair-required" }
  /** This device left a workspace others still use: the vault needs another folder. */
  | { kind: "left" }
  /**
   * Nothing could be confirmed: wait and try again. `known`: the folder is
   * known to hold a workspace; `first`: it never synced plainly against this
   * folder and the probe failed. `mayDismiss`: the workspace was answered
   * "not found" often enough that the person may call the folder a normal one.
   */
  | { kind: "unconfirmed"; why: "known" | "first"; probeError: unknown | null; mayDismiss: boolean };

function readFact(stored: unknown): EncryptedRemoteFact | null {
  if (!stored || typeof stored !== "object") return null;
  const fact = stored as Partial<EncryptedRemoteFact>;
  return fact.v === 2 && (fact.state === "encrypted" || fact.state === "joined" || fact.state === "released" || fact.state === "left") ? (fact as EncryptedRemoteFact) : null;
}

/** The fact for this folder, or null. A fact without a folder takes this one; another folder forgets it. */
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

/** The identity of the workspace a genesis names; one that does not parse is a workspace of unknown identity. */
export function workspaceIdentityOf(genesisBytes: Uint8Array): string {
  try {
    return workspaceDocumentHash(parseWorkspaceDocument(genesisBytes));
  } catch {
    return "unreadable-genesis";
  }
}

type Probe = { found: string } | { found: null; error: unknown | null };

async function probe(readGenesis: () => Promise<Uint8Array | null>): Promise<Probe> {
  const read: { bytes: Uint8Array | null } = { bytes: null };
  const result = await probeRemoteGenesis(async () => (read.bytes = await readGenesis()));
  if (result.encryptedGenesisFound && read.bytes) return { found: workspaceIdentityOf(read.bytes) };
  return { found: null, error: result.probeError };
}

export async function decideEncryptedRemote(input: {
  ports: EncryptedRemotePorts;
  binding: SyncStateBinding;
  /** Reads `.pvws/genesis.pvgen` through the vault's own target. */
  readGenesis: () => Promise<Uint8Array | null>;
  /** The vault completed a plain sync against THIS folder before (its records confirm remote files). */
  syncedPlainlyBefore: () => Promise<boolean>;
}): Promise<EncryptedRemoteGate> {
  const fact = await factFor(input.ports, input.binding);
  if (fact?.state === "left") return { kind: "left" };
  const answer = await probe(input.readGenesis);

  if (answer.found !== null) {
    if (fact?.state === "released" && fact.workspace === answer.found) return { kind: "plain", probeError: null };
    // Another workspace than the one this device ended, or one nobody knew of.
    const state = fact?.state === "joined" ? "joined" : "encrypted";
    await input.ports.save({ v: 2, state, binding: input.binding, workspace: answer.found, absentInARow: 0 });
    return { kind: "pair-required" };
  }

  if (answer.error === null) {
    // A clean "not found".
    if (!fact || fact.state === "released") return { kind: "plain", probeError: null };
    const absentInARow = (fact.absentInARow ?? 0) + 1;
    await input.ports.save({ ...fact, binding: input.binding, absentInARow });
    return { kind: "unconfirmed", why: "known", probeError: null, mayDismiss: absentInARow >= ENCRYPTED_REMOTE_ABSENT_TO_OFFER };
  }

  // The probe failed: nothing about the folder is known now.
  if (fact && fact.state !== "released") return { kind: "unconfirmed", why: "known", probeError: answer.error, mayDismiss: false };
  if (await input.syncedPlainlyBefore().catch(() => false)) return { kind: "plain", probeError: answer.error };
  return { kind: "unconfirmed", why: "first", probeError: answer.error, mayDismiss: false };
}

/**
 * Asked before the plain sync writes anything to the folder, every cycle (R8).
 * A genesis this device may not sync next to stops the sync with a fatal,
 * explained state and records the fact; a failed probe skips the cycle - the
 * next one asks again.
 */
export function plainRemoteGuard(input: { ports: EncryptedRemotePorts; binding: SyncStateBinding; readGenesis: (target: ISyncTarget) => Promise<Uint8Array | null> }) {
  return async (target: ISyncTarget): Promise<void> => {
    const bytes = await input.readGenesis(target);
    if (!bytes || bytes.length === 0) return;
    const found = workspaceIdentityOf(bytes);
    const fact = await factFor(input.ports, input.binding);
    if (fact?.state === "released" && fact.workspace === found) return;
    if (fact?.state !== "left") {
      await input.ports.save({ v: 2, state: fact?.state === "joined" ? "joined" : "encrypted", binding: input.binding, workspace: found, absentInARow: 0 });
    }
    throw new FatalSyncProtocolError("encrypted-workspace", "the cloud folder holds an encrypted workspace this device has not joined");
  };
}

/** The connect wizard or "Add vault" bound this vault to a folder that holds a workspace. */
export async function markEncryptedRemote(ports: EncryptedRemotePorts, binding?: SyncStateBinding): Promise<void> {
  await ports.save({ v: 2, state: "encrypted", ...(binding ? { binding } : {}) });
}

/** The device joined: the knowledge stays, as membership. */
export async function markEncryptedRemoteJoined(ports: EncryptedRemotePorts, workspace?: string): Promise<void> {
  const fact = readFact(await ports.load().catch(() => null));
  if (fact?.state === "joined" && (!workspace || fact.workspace === workspace)) return;
  await ports.save({ v: 2, state: "joined", ...(fact?.binding ? { binding: fact.binding } : {}), ...(workspace ?? fact?.workspace ? { workspace: workspace ?? fact?.workspace } : {}) });
}

/**
 * What lifting or decommissioning on this device means for its folder.
 * The remote is not touched by either (its `.pvws/` objects are immutable):
 * the workspace lives on for every other device. Only a device that is the
 * workspace's single active device of its single active member ends it.
 */
export function workspaceDeparture(runtime: Pick<PersonalWorkspaceRuntime, "genesis" | "policy"> | null): { workspace: string | undefined; sole: boolean } {
  if (!runtime) return { workspace: undefined, sole: false };
  if (!runtime.policy?.payload) return { workspace: undefined, sole: false };
  const devices = runtime.policy.payload.devices.filter((device) => device.state === "active").length;
  const members = runtime.policy.payload.members.filter((member) => member.state === "active").length;
  let workspace: string | undefined;
  try {
    workspace = workspaceDocumentHash(runtime.genesis);
  } catch {
    workspace = undefined;
  }
  return { workspace, sole: devices <= 1 && members <= 1 };
}

/** This device lifted or decommissioned the workspace (see `workspaceDeparture`). */
export async function markEncryptedRemoteDeparted(ports: EncryptedRemotePorts, departure: { workspace: string | undefined; sole: boolean }): Promise<void> {
  const fact = readFact(await ports.load().catch(() => null));
  const binding = fact?.binding ? { binding: fact.binding } : {};
  if (departure.sole && departure.workspace) await ports.save({ v: 2, state: "released", ...binding, workspace: departure.workspace });
  else await ports.save({ v: 2, state: "left", ...binding, ...(departure.workspace ? { workspace: departure.workspace } : {}) });
}

/**
 * The person's own word, offered only after repeated clean "not found"
 * answers: this folder no longer holds an encrypted workspace. The per-cycle
 * guard stays behind it - a genesis that turns up after all stops the sync.
 */
export async function dismissEncryptedRemote(ports: EncryptedRemotePorts): Promise<boolean> {
  const fact = readFact(await ports.load().catch(() => null));
  if (!fact || (fact.state !== "encrypted" && fact.state !== "joined") || (fact.absentInARow ?? 0) < ENCRYPTED_REMOTE_ABSENT_TO_OFFER) return false;
  await ports.clear();
  return true;
}

/** Whether the person may now call the folder a normal one (both shells show the action from this). */
export async function encryptedRemoteDismissable(ports: EncryptedRemotePorts): Promise<boolean> {
  const fact = readFact(await ports.load().catch(() => null));
  return !!fact && (fact.state === "encrypted" || fact.state === "joined") && (fact.absentInARow ?? 0) >= ENCRYPTED_REMOTE_ABSENT_TO_OFFER;
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

/** A start held back because the folder could not be confirmed tries again after this long, then longer. */
export const ENCRYPTED_REMOTE_RETRY_MS = 60_000;
export const ENCRYPTED_REMOTE_RETRY_MAX_MS = 15 * 60_000;
export const encryptedRemoteRetryDelay = (attempt: number): number => Math.min(ENCRYPTED_REMOTE_RETRY_MAX_MS, ENCRYPTED_REMOTE_RETRY_MS * 2 ** Math.max(0, attempt));
