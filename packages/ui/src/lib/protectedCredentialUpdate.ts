import type { ProtectedSecretStore } from "./passwordChangeJournal";

/** A rotation can replace only the exact credential that requested it. The
 * native CAS also covers writers in other windows and preserves login metadata. */
export async function replaceProtectedCredential(store: ProtectedSecretStore, key: string, previous: unknown, next: unknown): Promise<void> {
  const raw = await store.read(key);
  if (raw === null || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(previous)) throw new Error("Stored sign-in changed");
  const replacement = JSON.stringify(next);
  if (!await store.compareAndSet(key, raw, replacement)) throw new Error("Stored sign-in changed");
  if (await store.read(key) !== replacement) throw new Error("Sign-in storage not confirmed");
}
