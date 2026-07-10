import { Store } from "@tauri-apps/plugin-store";
import type { ISettingsStore } from "@plainva/ui";

/**
 * Desktop implementation of the platform-neutral settings access (ADR 0011).
 * ONE app-wide Tauri store file carries the global and per-vault keys.
 * Every other module talks ISettingsStore through getSettingsStore() — the
 * platformBoundary test confines direct plugin-store imports to this module
 * and the CredentialManager (which owns its separate credentials.bin).
 */
export const STORE_KEY = "plainva-settings.json";

/** Loads the app settings store behind the platform-neutral interface. */
export function getSettingsStore(): Promise<ISettingsStore> {
  return Store.load(STORE_KEY);
}
