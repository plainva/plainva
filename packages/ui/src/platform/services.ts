import type { ISettingsStore } from "./settings";
import type { ICredentialStore } from "./credentials";

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
