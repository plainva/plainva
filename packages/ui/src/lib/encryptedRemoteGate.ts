import { FatalSyncProtocolError, parseWorkspaceDocument, SyncRootMissingError, workspaceDocumentHash, type ISyncTarget, type PersonalWorkspaceRuntime } from "@plainva/core";
import { sameSyncTarget, type SyncStateBinding } from "./syncStateBinding";

/**
 * The plain sync and a cloud folder that holds an encrypted workspace (R8,
 * both shells).
 *
 * The rule costs an ordinary plain vault nothing. Its worker starts as it
 * always did, and the folder's own listing is the probe: the worker writes
 * nothing to the remote in a cycle before it has seen that cycle's listing, and
 * a listing that shows a workspace's genesis stops it (`workspaceListed`, in
 * the core). No extra request in any cycle, no wait when a vault opens.
 *
 * Only a vault that KNOWS something about its folder is held before its worker
 * starts, and only for it is the genesis read on its own. What it knows is a
 * fact of the vault, kept apart from the sync records (a reset never forgets
 * it), per folder:
 *
 *  - `encrypted`: the folder holds a workspace this device has not joined.
 *  - `joined`: this device is a member (kept while it has no keys - locked, or
 *    the key went with a reinstall).
 *  - `released`: this device ended the workspace as its only device and member:
 *    plain sync while the folder holds no genesis or exactly that one.
 *  - `left`: this device left the workspace, and other devices use it (or it
 *    cannot tell - `peers: "unknown"`).
 *
 * Each is a claim about the folder's CONTENT, so content lifts it: a folder
 * that answers "not found" several times in a row (one answer is not trusted -
 * an incomplete listing was the 2026-09-20 incident) is a normal folder again.
 * A server that will not show the hidden path at all is not retried forever:
 * the person gets the explicit way out.
 */
export interface EncryptedRemoteFact {
  v: 2;
  state: "encrypted" | "joined" | "released" | "left";
  /** The folder it speaks about; absent where it was written before the folder was read. */
  binding?: SyncStateBinding;
  /** The workspace the folder held (its genesis fingerprint), where known. */
  workspace?: string;
  /** `left`: whether other devices are known to use the workspace. */
  peers?: "others" | "unknown";
  /** Clean "not found" answers in a row. */
  absentInARow?: number;
  /** The server refused to show the hidden path: the way out is offered. */
  refused?: boolean;
}

export interface EncryptedRemotePorts {
  load(): Promise<unknown>;
  save(fact: EncryptedRemoteFact): Promise<void>;
  clear(): Promise<void>;
}

/** Clean "not found" answers in a row before a folder counts as normal again. */
export const ENCRYPTED_REMOTE_ABSENT_TO_CLEAR = 3;

function readFact(stored: unknown): EncryptedRemoteFact | null {
  if (!stored || typeof stored !== "object") return null;
  const fact = stored as Partial<EncryptedRemoteFact>;
  return fact.v === 2 && (fact.state === "encrypted" || fact.state === "joined" || fact.state === "released" || fact.state === "left") ? (fact as EncryptedRemoteFact) : null;
}

/** Storage never decides a start: a store that fails is "nothing known" for a read, and nothing for a write. */
async function safeLoad(ports: EncryptedRemotePorts): Promise<EncryptedRemoteFact | null> {
  try { return readFact(await ports.load()); } catch { return null; }
}
async function safeSave(ports: EncryptedRemotePorts, fact: EncryptedRemoteFact): Promise<void> {
  try { await ports.save(fact); } catch (error) { console.warn("[encryptedRemote] could not record the folder's state", error); }
}
async function safeClear(ports: EncryptedRemotePorts): Promise<void> {
  try { await ports.clear(); } catch (error) { console.warn("[encryptedRemote] could not clear the folder's state", error); }
}

/**
 * What the vault knows about this folder, or null - which is what nearly every
 * vault gets, at the cost of one local read. A fact without a folder takes this
 * one; another folder forgets it. Never rejects.
 */
export async function encryptedRemoteFactFor(ports: EncryptedRemotePorts, binding: SyncStateBinding): Promise<EncryptedRemoteFact | null> {
  const fact = await safeLoad(ports);
  if (!fact) return null;
  if (!fact.binding) {
    const adopted: EncryptedRemoteFact = { ...fact, binding };
    await safeSave(ports, adopted);
    return adopted;
  }
  if (sameSyncTarget(fact.binding, binding)) return fact;
  await safeClear(ports);
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

/**
 * What reading the genesis failed with, per provider.
 *
 *  - WebDAV and S3 address the path itself: 404 is "not there" (the target
 *    answers null), and 400/403/405/409/451 are a server that will not show a
 *    hidden path at all - nginx and Apache hardening (`location ~ /\. { deny
 *    all; }`), an S3 policy limited to a prefix (403 for any key it may not
 *    list). Waiting does not change that.
 *  - Google Drive, OneDrive and Dropbox address by name through their API,
 *    which never refuses a dot name: a 403 there is a rate limit or a
 *    permission of the account, and passes like any other error.
 *  - A folder that is gone is the worker's own recovery (`root-missing`).
 */
export type GenesisReadFailure = "root-missing" | "refused" | "transient";

export function classifyGenesisReadError(error: unknown, provider: string): GenesisReadFailure {
  if (error instanceof SyncRootMissingError) return "root-missing";
  const status = (error as { status?: unknown } | null)?.status;
  if ((provider === "webdav" || provider === "s3") && typeof status === "number" && [400, 403, 405, 409, 451].includes(status)) return "refused";
  return "transient";
}

export type HeldFolderVerdict =
  /** The plain worker may start; its listing stays the net. */
  | { kind: "plain" }
  /** The folder is gone: the worker starts and shows its own recovery. */
  | { kind: "root-missing" }
  /** The folder holds a workspace this device has not joined. */
  | { kind: "pair-required" }
  /** This device left a workspace others use, or cannot tell. */
  | { kind: "left"; peers: "others" | "unknown" }
  /** The server will not show the hidden path: the person decides. */
  | { kind: "refused" }
  /** Not confirmed yet - a failed read, or a "not found" not yet repeated: wait and ask again. */
  | { kind: "waiting" };

/**
 * For a vault WITH a fact only: reads the genesis and decides. Never rejects -
 * a failure inside is "waiting".
 */
export async function decideHeldFolder(input: {
  ports: EncryptedRemotePorts;
  binding: SyncStateBinding;
  fact: EncryptedRemoteFact;
  provider: string;
  readGenesis: () => Promise<Uint8Array | null>;
}): Promise<HeldFolderVerdict> {
  const { ports, binding, fact } = input;
  let bytes: Uint8Array | null;
  try {
    bytes = await input.readGenesis();
  } catch (error) {
    const failure = classifyGenesisReadError(error, input.provider);
    if (failure === "root-missing") return { kind: "root-missing" };
    if (failure === "refused") {
      if (!fact.refused) await safeSave(ports, { ...fact, binding, refused: true });
      return { kind: "refused" };
    }
    return { kind: "waiting" };
  }
  if (bytes && bytes.length > 0) {
    const found = workspaceIdentityOf(bytes);
    if (fact.state === "released" && fact.workspace === found) return { kind: "plain" };
    if (fact.state === "left" && (!fact.workspace || fact.workspace === found)) {
      await safeSave(ports, { ...fact, binding, workspace: found, absentInARow: 0, refused: false });
      return { kind: "left", peers: fact.peers ?? "unknown" };
    }
    await safeSave(ports, { v: 2, state: fact.state === "joined" ? "joined" : "encrypted", binding, workspace: found, absentInARow: 0 });
    return { kind: "pair-required" };
  }
  // A clean "not found".
  if (fact.state === "released") return { kind: "plain" };
  const absentInARow = (fact.absentInARow ?? 0) + 1;
  if (absentInARow >= ENCRYPTED_REMOTE_ABSENT_TO_CLEAR) {
    // Verified by repetition: the folder holds no workspace any more.
    await safeClear(ports);
    return { kind: "plain" };
  }
  await safeSave(ports, { ...fact, binding, absentInARow, refused: false });
  return { kind: "waiting" };
}

/**
 * For the plain worker's `workspaceListed` (core): asked only when a listing
 * shows a genesis. Lets the sync go on next to exactly the workspace this
 * device ended; anything else records the fact and stops the worker.
 */
export function plainWorkspaceListed(input: { ports: EncryptedRemotePorts; binding: SyncStateBinding; readGenesis: (target: ISyncTarget) => Promise<Uint8Array | null> }) {
  return async (target: ISyncTarget): Promise<void> => {
    const fact = await encryptedRemoteFactFor(input.ports, input.binding);
    let found = "unreadable-genesis";
    try {
      const bytes = await input.readGenesis(target);
      if (bytes && bytes.length > 0) found = workspaceIdentityOf(bytes);
    } catch {
      // Listed but not readable: still a workspace.
    }
    if (fact?.state === "released" && fact.workspace === found) return;
    if (fact?.state !== "left") {
      await safeSave(input.ports, { v: 2, state: fact?.state === "joined" ? "joined" : "encrypted", binding: input.binding, workspace: found, absentInARow: 0 });
    }
    throw new FatalSyncProtocolError("encrypted-workspace", "the cloud folder holds an encrypted workspace this device has not joined");
  };
}

/**
 * The settings-only sync's one look per session (files off: no listing shows a
 * genesis). A vault with a fact asks the held-folder rule; one without reads
 * the genesis once (`listFolders` speaks about the account's root, not the
 * vault's folder, so there is no shallower look).
 */
export function settingsOnlyFolderCheck(input: {
  ports: EncryptedRemotePorts;
  binding: SyncStateBinding;
  provider: string;
  target: ISyncTarget;
  readGenesis: (target: ISyncTarget) => Promise<Uint8Array | null>;
}) {
  return async (): Promise<void> => {
    const fact = await encryptedRemoteFactFor(input.ports, input.binding);
    if (fact) {
      const verdict = await decideHeldFolder({ ports: input.ports, binding: input.binding, fact, provider: input.provider, readGenesis: () => input.readGenesis(input.target) });
      if (verdict.kind === "plain" || verdict.kind === "root-missing") return;
      if (verdict.kind === "waiting") throw new Error("the cloud folder could not be checked yet");
      throw new FatalSyncProtocolError("encrypted-workspace", "the cloud folder holds an encrypted workspace this device may not sync next to");
    }
    // One read per session. A failure - a server that will not show the hidden
    // path, a network hiccup - stops nothing for a vault that knows nothing:
    // the settings run meets the same network on its own.
    const listed = await input.readGenesis(input.target).catch(() => null);
    if (!listed || listed.length === 0) return;
    await plainWorkspaceListed(input)(input.target);
  };
}

/** The connect wizard or "Add vault" bound this vault to a folder that holds a workspace. */
export async function markEncryptedRemote(ports: EncryptedRemotePorts, binding?: SyncStateBinding): Promise<void> {
  await safeSave(ports, { v: 2, state: "encrypted", ...(binding ? { binding } : {}) });
}

/** The device joined: the knowledge stays, as membership. */
export async function markEncryptedRemoteJoined(ports: EncryptedRemotePorts, workspace?: string): Promise<void> {
  const fact = await safeLoad(ports);
  if (fact?.state === "joined" && (!workspace || fact.workspace === workspace)) return;
  await safeSave(ports, { v: 2, state: "joined", ...(fact?.binding ? { binding: fact.binding } : {}), ...(workspace ?? fact?.workspace ? { workspace: workspace ?? fact?.workspace } : {}) });
}

/**
 * What lifting or decommissioning on this device means for its folder. Neither
 * touches the remote (its `.pvws/` objects are immutable), so the workspace
 * lives on for every other device. Only the workspace's single active device of
 * its single active member ends it; without its runtime (a locked device) the
 * app cannot tell.
 */
export function workspaceDeparture(runtime: Pick<PersonalWorkspaceRuntime, "genesis" | "policy"> | null): { workspace: string | undefined; sole: boolean | "unknown" } {
  if (!runtime?.policy?.payload) return { workspace: undefined, sole: "unknown" };
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
export async function markEncryptedRemoteDeparted(ports: EncryptedRemotePorts, departure: { workspace: string | undefined; sole: boolean | "unknown" }): Promise<void> {
  const fact = await safeLoad(ports);
  const binding = fact?.binding ? { binding: fact.binding } : {};
  if (departure.sole === true && departure.workspace) await safeSave(ports, { v: 2, state: "released", ...binding, workspace: departure.workspace });
  else await safeSave(ports, { v: 2, state: "left", ...binding, peers: departure.sole === false ? "others" : "unknown", ...(departure.workspace ? { workspace: departure.workspace } : {}) });
}

/**
 * The person's own word that this folder holds no workspace for this device -
 * offered where the app cannot find out: a server that will not show the
 * hidden path, or a departure from a workspace whose other devices the app
 * cannot see. The listing net stays behind it.
 */
export async function dismissEncryptedRemote(ports: EncryptedRemotePorts): Promise<boolean> {
  if (!(await encryptedRemoteDismissable(ports))) return false;
  await safeClear(ports);
  return true;
}

export async function encryptedRemoteDismissable(ports: EncryptedRemotePorts): Promise<boolean> {
  const fact = await safeLoad(ports);
  return !!fact && (fact.refused === true || (fact.state === "left" && fact.peers === "unknown"));
}

/** The settings key the phone keeps the fact under, per vault id. */
export const encryptedRemoteKey = (vaultKey: string): string => `encryptedRemote_${vaultKey}`;

/** The ports over a settings store (the phone: keyed by the vault's stable id). */
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

/** Where the desktop keeps the fact: inside the vault's own device-local folder, so it moves with the vault. */
export const ENCRYPTED_REMOTE_FILE = ".plainva/encrypted-remote.json";

/** The ports over a vault folder (the desktop: the fact travels when the vault folder moves). */
export function encryptedRemoteFilePorts(vault: { exists(path: string): Promise<boolean>; readTextFile(path: string): Promise<string>; writeTextFile(path: string, value: string): Promise<void>; deleteItem?(path: string): Promise<void> }): EncryptedRemotePorts {
  return {
    load: async () => ((await vault.exists(ENCRYPTED_REMOTE_FILE)) ? JSON.parse(await vault.readTextFile(ENCRYPTED_REMOTE_FILE)) : null),
    save: async (fact) => { await vault.writeTextFile(ENCRYPTED_REMOTE_FILE, JSON.stringify(fact)); },
    clear: async () => { if ((await vault.exists(ENCRYPTED_REMOTE_FILE)) && vault.deleteItem) await vault.deleteItem(ENCRYPTED_REMOTE_FILE); },
  };
}

/** A held vault asks again after this long, then longer. */
export const ENCRYPTED_REMOTE_RETRY_MS = 60_000;
export const ENCRYPTED_REMOTE_RETRY_MAX_MS = 15 * 60_000;
export const encryptedRemoteRetryDelay = (attempt: number): number => Math.min(ENCRYPTED_REMOTE_RETRY_MAX_MS, ENCRYPTED_REMOTE_RETRY_MS * 2 ** Math.max(0, attempt));

/** The message key of a held vault's state, one per verdict, both shells. */
export function heldFolderMessageKey(verdict: HeldFolderVerdict): string {
  switch (verdict.kind) {
    case "left": return verdict.peers === "unknown" ? "workspaceSecurity.leftUnknownPeers" : "workspaceSecurity.leftWorkspaceFolder";
    case "refused": return "workspaceSecurity.dotPathRefused";
    case "waiting": return "workspaceSecurity.folderUnconfirmed";
    default: return "workspaceSecurity.mobilePairRequired";
  }
}
