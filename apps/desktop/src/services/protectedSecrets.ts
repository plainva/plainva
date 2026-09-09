import { invoke } from "@tauri-apps/api/core";
import type { ProtectedSecretStore } from "@plainva/ui";

/** Recovery intents must never fall back to the general settings store. */
export const protectedSecrets: ProtectedSecretStore = {
  async read(key) {
    const value = await invoke<unknown>("keychain_get", { key });
    if (value !== null && typeof value !== "string") throw new Error("Invalid protected storage response");
    return value;
  },
  async compareAndSet(key, expected, value) {
    const changed = await invoke<unknown>("keychain_compare_and_set", { key, expected, value });
    if (typeof changed !== "boolean") throw new Error("Invalid protected storage response");
    return changed;
  },
};
