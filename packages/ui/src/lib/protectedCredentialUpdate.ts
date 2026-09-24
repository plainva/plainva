import { sameStoredValue } from "@plainva/core";
import type { ProtectedSecretStore } from "./passwordChangeJournal";

/** A rotation can replace only the exact credential that requested it. The
 * native CAS also covers writers in other windows and preserves login metadata. */
export async function replaceProtectedCredential(store: ProtectedSecretStore, key: string, previous: unknown, next: unknown): Promise<void> {
  const raw = await store.read(key);
  if (raw === null || !sameStoredValue(JSON.parse(raw), previous)) throw new Error("Stored sign-in changed");
  const replacement = JSON.stringify(next);
  if (!await store.compareAndSet(key, raw, replacement)) throw new Error("Stored sign-in changed");
  if (await store.read(key) !== replacement) throw new Error("Sign-in storage not confirmed");
}

/** Reconnects also support absent credentials on a second device and historical
 * key names. Every existing source is replaced only by native CAS. */
export async function replaceProtectedSlot(store: ProtectedSecretStore, keys: string[], previous: unknown, next: unknown): Promise<void> {
  if (!keys.length) throw new Error("No credential slot supplied");
  for (const key of [...new Set(keys)]) {
    if (await store.read(key) !== null) return replaceProtectedCredential(store, key, previous, next);
  }
  if (previous !== null) throw new Error("Stored sign-in changed");
  const value = JSON.stringify(next);
  if (!await store.compareAndSet(keys[0], null, value)) throw new Error("Stored sign-in changed");
  if (await store.read(keys[0]) !== value) throw new Error("Sign-in storage not confirmed");
}
