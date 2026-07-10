// M1 platform stubs (ADR 0011): in-memory ISettingsStore/ICredentialStore so
// the shared UI layer runs in the browser. M2 replaces them with
// @capacitor/preferences and the iOS Keychain / Android Keystore.
import type { ICredentialStore, ISettingsStore } from "@plainva/ui";

const settings = new Map<string, unknown>();

export const memorySettingsStore: ISettingsStore = {
  async get<T>(key: string): Promise<T | undefined> {
    return settings.get(key) as T | undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    settings.set(key, value);
  },
  async delete(key: string): Promise<boolean> {
    return settings.delete(key);
  },
  async keys(): Promise<string[]> {
    return [...settings.keys()];
  },
  async save(): Promise<void> {},
};

const secrets = new Map<string, unknown>();

export const memoryCredentialStore: ICredentialStore = {
  async readSecret<T>(key: string): Promise<T | null> {
    return (secrets.get(key) as T | undefined) ?? null;
  },
  async writeSecret<T>(key: string, value: T): Promise<void> {
    secrets.set(key, value);
  },
  async removeSecret(key: string): Promise<void> {
    secrets.delete(key);
  },
};
