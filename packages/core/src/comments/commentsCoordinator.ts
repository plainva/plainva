import type { IVaultAdapter } from "../vault/IVaultAdapter.js";

/** Shells use the same stable vault key for every wrapper/store instance.
 * Auxiliary desktop windows route their writes to the owner before this gate. */
export interface CommentsCoordination {
  vaultKey?: string;
  deviceId: string;
}

const localWrites = new Map<string, Promise<void>>();
const syncCycles = new Map<string, Promise<void>>();
const adapterIds = new WeakMap<IVaultAdapter, number>();
let nextAdapterId = 0;

function keyFor(vault: IVaultAdapter, options: CommentsCoordination): string {
  let identity: string;
  if (options.vaultKey !== undefined) identity = `vault:${options.vaultKey}`;
  else {
    let id = adapterIds.get(vault);
    if (id === undefined) { id = ++nextAdapterId; adapterIds.set(vault, id); }
    identity = `adapter:${id}`;
  }
  return JSON.stringify([identity, options.deviceId]);
}

async function serial<T>(tails: Map<string, Promise<void>>, key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(work);
  const tail = result.then(() => undefined, () => undefined);
  tails.set(key, tail);
  try { return await result; }
  finally { if (tails.get(key) === tail) tails.delete(key); }
}

/** Disk read/merge/write and quarantine share this gate. Never hold it for network I/O. */
export function withCommentsWrite<T>(vault: IVaultAdapter, options: CommentsCoordination, work: () => Promise<T>): Promise<T> {
  return serial(localWrites, keyFor(vault, options), work);
}

/** Separate transport ordering prevents an older upload overtaking a newer cycle,
 * while a stalled download never prevents a local reply from reaching disk. */
export function withCommentsSync<T>(vault: IVaultAdapter, options: CommentsCoordination, work: () => Promise<T>): Promise<T> {
  return serial(syncCycles, keyFor(vault, options), work);
}
