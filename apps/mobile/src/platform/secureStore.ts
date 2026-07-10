import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { ICredentialStore } from "@plainva/ui";
import { capacitorCredentialStore } from "./capacitorPlatform";

/**
 * Keystore-hardened ICredentialStore (M3): natively the SecureStore plugin
 * (AndroidKeyStore AES/GCM; iOS Keychain once that shell exists) with a
 * one-time transparent migration of legacy Preferences secrets. The plain
 * web dev server keeps the Preferences fallback — same trust level as the
 * desktop's store fallback.
 */

interface SecureStoreNative {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

const SecureStore = registerPlugin<SecureStoreNative>("SecureStore");

const legacyKey = (key: string) => `secret_${key}`;

const nativeStore: ICredentialStore = {
  async readSecret<T>(key: string): Promise<T | null> {
    const { value } = await SecureStore.get({ key });
    if (value !== null) {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    // One-time migration: secrets written before the hardening live in
    // plain Preferences under "secret_<key>".
    const legacy = await Preferences.get({ key: legacyKey(key) });
    if (legacy.value === null) return null;
    await SecureStore.set({ key, value: legacy.value });
    await Preferences.remove({ key: legacyKey(key) });
    try {
      return JSON.parse(legacy.value) as T;
    } catch {
      return null;
    }
  },
  async writeSecret<T>(key: string, value: T): Promise<void> {
    await SecureStore.set({ key, value: JSON.stringify(value) });
    await Preferences.remove({ key: legacyKey(key) });
  },
  async removeSecret(key: string): Promise<void> {
    await SecureStore.remove({ key });
    await Preferences.remove({ key: legacyKey(key) });
  },
};

export const secureCredentialStore: ICredentialStore = Capacitor.isNativePlatform()
  ? nativeStore
  : capacitorCredentialStore;
