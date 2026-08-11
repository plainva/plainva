import type { ISettingsStore } from "./settings";
import type { ICredentialStore } from "./credentials";
import type { KeychainSlotInput } from "../lib/keychainSlots";

/**
 * The bundle of platform capabilities an app shell injects at startup
 * (ADR 0011). Shared code never imports shell APIs; it asks the registry.
 * Grows additively (fetch, folder pickers, …) as extraction proceeds.
 */
export interface PlatformServices {
  /** Loads (or returns) the app-wide settings store. */
  loadSettings(): Promise<ISettingsStore>;
  /** Secret storage for sync credentials. */
  credentials: ICredentialStore;
  /** Opens a URL in the system browser. */
  openExternal(url: string): Promise<void>;
  /**
   * Waits for a pending editor save of `path` to land before shared code
   * rewrites that file. Without it a save queued a second ago overwrites the
   * change immediately after it was written — the shell owns its editor, so
   * only the shell can answer this. Optional: a shell with no editor open (or
   * none at all) simply resolves.
   */
  flushPendingSave?(path: string): Promise<void>;
  /**
   * Names the OS keychain entries this shell writes (P6).
   *
   * Optional, and deliberately so: readable names exist to be READ by a person
   * in Seahorse / Keychain Access / Credential Manager. Android stores its
   * secrets in a Keystore-encrypted preference file and iOS in a keychain that
   * no shipped app browses — a rename there would be pure risk for a benefit
   * nobody can see. A shell that registers nothing keeps the legacy names.
   */
  keychainSlotName?(input: KeychainSlotInput): string;
}

let current: PlatformServices | null = null;

/** Called once by the app shell (desktop: main.tsx) before the first render. */
export function setPlatformServices(services: PlatformServices): void {
  current = services;
}

export function hasPlatformServices(): boolean {
  return current !== null;
}

export function getPlatformServices(): PlatformServices {
  if (!current) {
    throw new Error(
      "PlatformServices not registered — the app shell must call setPlatformServices() at startup",
    );
  }
  return current;
}

/**
 * Waits for the shell's pending save of `path`, if it has one. Shared write
 * paths call this before rewriting a file so an editor save queued a second
 * ago cannot land on top of the change.
 */
export async function flushPendingSave(path: string): Promise<void> {
  if (!hasPlatformServices()) return;
  await getPlatformServices().flushPendingSave?.(path);
}
