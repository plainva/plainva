import { PasswordChangeError, type PasswordChangeTarget } from "./accountPasswordChange";
import type { CloudServiceId } from "./cloudAccounts";
import type { ProtectedSecretStore } from "./passwordChangeJournal";

/** A snapshot includes only the secret and the fields that bind it to its
 * endpoint. Cosmetic account metadata remains owned by its normal editor. */
export function createPasswordCredentialTarget<T, B>(opts: {
  service: CloudServiceId;
  key: string;
  store: ProtectedSecretStore;
  read(): Promise<T | null>;
  readBinding(): Promise<B>;
  withPassword(value: T, password: string): T;
  verify(value: T, binding: B, password: string): Promise<void>;
  beforeWrite?(): Promise<void>;
}): PasswordChangeTarget {
  const source = async () => {
    const credential = await opts.read();
    if (credential === null) throw new PasswordChangeError("missing", opts.service);
    return { credential, binding: await opts.readBinding() };
  };
  type Source = Awaited<ReturnType<typeof source>>;
  const parse = (value: string) => JSON.parse(value) as Source;
  return {
    service: opts.service,
    read: async () => JSON.stringify(await source()),
    withPassword: (previous, password) => {
      const value = parse(previous);
      return JSON.stringify({ ...value, credential: opts.withPassword(value.credential, password) });
    },
    verify: async (password, previous) => {
      const value = parse(previous);
      await opts.verify(value.credential, value.binding, password);
    },
    write: async (expected, next) => {
      await opts.beforeWrite?.();
      const current = await source();
      if (JSON.stringify(current) !== expected) throw new PasswordChangeError("changed", opts.service);
      const replacement = parse(next);
      if (JSON.stringify(current.binding) !== JSON.stringify(replacement.binding)) throw new PasswordChangeError("changed", opts.service);
      const raw = await opts.store.read(opts.key);
      if (raw === null || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(current.credential)
        || JSON.stringify(await opts.readBinding()) !== JSON.stringify(current.binding)) throw new PasswordChangeError("changed", opts.service);
      if (!await opts.store.compareAndSet(opts.key, raw, JSON.stringify(replacement.credential))) throw new PasswordChangeError("changed", opts.service);
    },
  };
}
