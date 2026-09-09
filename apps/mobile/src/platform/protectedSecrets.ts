import { registerPlugin } from "@capacitor/core";
import type { ProtectedSecretStore } from "@plainva/ui";

interface NativeProtectedStore {
  get(args: { key: string }): Promise<{ value: string | null }>;
  compareAndSet(args: { key: string; expected: string | null; value: string | null }): Promise<{ changed: boolean }>;
}

/** Native Keychain/Keystore only: unavailable storage keeps the intent pending. */
export const protectedSecrets: ProtectedSecretStore = {
  async read(key) {
    const { value } = await registerPlugin<NativeProtectedStore>("SecureStore").get({ key });
    if (value !== null && typeof value !== "string") throw new Error("Invalid protected storage response");
    return value;
  },
  async compareAndSet(key, expected, value) {
    const { changed } = await registerPlugin<NativeProtectedStore>("SecureStore").compareAndSet({ key, expected, value });
    if (typeof changed !== "boolean") throw new Error("Invalid protected storage response");
    return changed;
  },
};
