import { Preferences } from "@capacitor/preferences";
import type { ICredentialStore, ISettingsStore } from "@plainva/ui";

/**
 * Mobile platform services (M2). Settings map onto @capacitor/preferences
 * (UserDefaults / SharedPreferences; localStorage on the web dev server).
 * Values are JSON-encoded because Preferences stores strings only.
 *
 * Credentials use the same Preferences store under a "secret_" prefix for
 * now — functional parity with the desktop's plugin-store fallback, NOT
 * hardened yet. Moving them into the iOS Keychain / Android Keystore via a
 * secure-storage plugin is a planned M3 companion step (before real sync
 * tokens land on devices).
 */

export const capacitorSettingsStore: ISettingsStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const { value } = await Preferences.get({ key });
    if (value === null) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    await Preferences.set({ key, value: JSON.stringify(value) });
  },
  async delete(key: string): Promise<boolean> {
    const { value } = await Preferences.get({ key });
    await Preferences.remove({ key });
    return value !== null;
  },
  async keys(): Promise<string[]> {
    const { keys } = await Preferences.keys();
    return keys.filter((k) => !k.startsWith("secret_"));
  },
  async save(): Promise<void> {},
};

const secretKey = (key: string) => `secret_${key}`;

export const capacitorCredentialStore: ICredentialStore = {
  async readSecret<T>(key: string): Promise<T | null> {
    const { value } = await Preferences.get({ key: secretKey(key) });
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  async writeSecret<T>(key: string, value: T): Promise<void> {
    await Preferences.set({ key: secretKey(key), value: JSON.stringify(value) });
  },
  async removeSecret(key: string): Promise<void> {
    await Preferences.remove({ key: secretKey(key) });
  },
};
