import { PasswordChangeError, type PasswordChangePorts } from "./accountPasswordChange";

/** Native-only storage. The compare and write share a lane with every native
 * writer, including other windows; no settings or plaintext fallback. */
export interface ProtectedSecretStore {
  read(key: string): Promise<string | null>;
  compareAndSet(key: string, expected: string | null, value: string | null): Promise<boolean>;
}

export function createPasswordChangeJournal(store: ProtectedSecretStore, key: string): PasswordChangePorts["journal"] {
  const parse = (raw: string | null): unknown | null => {
    if (raw === null) return null;
    if (typeof raw !== "string") throw new PasswordChangeError("storage");
    const value: unknown = JSON.parse(raw);
    if (value === null) throw new PasswordChangeError("storage");
    return value;
  };
  const replace = async (expected: unknown, value: unknown | null): Promise<void> => {
    const raw = await store.read(key);
    if (JSON.stringify(parse(raw)) !== JSON.stringify(expected)) throw new PasswordChangeError("changed");
    if (!await store.compareAndSet(key, raw, value === null ? null : JSON.stringify(value))) throw new PasswordChangeError("changed");
  };
  return {
    read: async () => parse(await store.read(key)),
    write: (value, expected) => replace(expected, value),
    clear: (expected) => replace(expected, null),
  };
}
