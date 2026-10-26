import { Preferences } from "@capacitor/preferences";
import { getPlatformServices } from "@plainva/ui";

/**
 * Vault registry (M3.5 isolation rework): every cloud connection gets its
 * OWN local container — filesystem root, index database, sync queue and
 * credential slot — so providers can never mix files (maintainer
 * requirement 2026-07-10). The pre-rework single sandbox lives on as the
 * "local" vault; the registry itself is tiny JSON in Preferences.
 */

export const LOCAL_VAULT_ID = "local";

/**
 * A vault that lives in a folder the user picked on the device (external vault
 * folder plan, P4). The handle is opaque to the WebView; the label is what the
 * picker showed. The platform is recorded because a bookmark cannot be
 * resolved by the other shell — a registry restored across platforms would
 * otherwise carry a handle that looks valid and is not.
 */
export interface ExternalFolderRef {
  handle: string;
  label: string;
  platform: "android" | "ios";
}

export interface VaultEntry {
  id: string;
  /** Display name; empty for the local vault (the UI localizes that). */
  name: string;
  provider?: string;
  /** Written by older versions for "Trennen"; read once and moved to `pausedHere` (`migrateLegacyPause`). */
  paused?: boolean;
  /**
   * Sync paused by the person ("Pause sync", plan "Verbinden", V3) - its own
   * flag, so that the app resuming its pause cannot undo it (review finding 5b).
   */
  pausedHere?: boolean;
  /**
   * The vault's files were taken out of it while it was not open (an account
   * removed): its sync queue and per-file records are cleared when it opens
   * next (second review, B4b).
   */
  clearSyncStateOnOpen?: boolean;
  /** Set for a vault in a user-picked folder outside the app container. */
  external?: ExternalFolderRef;
}

/** True for a vault whose files live outside the app container (E3: an additional vault, never a replacement). */
export function isExternalVault(entry: VaultEntry | null | undefined): entry is VaultEntry & { external: ExternalFolderRef } {
  return Boolean(entry?.external?.handle);
}

export interface RegistryState {
  vaults: VaultEntry[];
  activeId: string;
}

const KEY = "vault_registry";

/** Pre-isolation credential slots: they belonged to the mixed sandbox. */
const PRE_ISOLATION_SECRET_KEYS = ["sync_provider_mobile", "webdav_credentials_mobile"];

let cache: RegistryState | null = null;
// Creation intent lives for this process only. Reopening a registered vault,
// including an empty one, must never offer or apply a newer template.
const newLocalVaults = new Set<string>();
export function consumeNewLocalVault(id: string): boolean {
  return newLocalVaults.delete(id);
}

async function persist(state: RegistryState): Promise<void> {
  cache = state;
  await Preferences.set({ key: KEY, value: JSON.stringify(state) });
}

/** `paused` (older versions' "Trennen") becomes `pausedHere`; the registry unchanged when there is none. */
export function migrateLegacyPause(registry: RegistryState): RegistryState {
  if (!registry.vaults.some((vault) => vault.paused !== undefined)) return registry;
  return {
    ...registry,
    vaults: registry.vaults.map((vault) => {
      if (vault.paused === undefined) return vault;
      const { paused, ...rest } = vault;
      return paused ? { ...rest, pausedHere: true } : rest;
    }),
  };
}

export async function loadRegistry(): Promise<RegistryState> {
  if (cache) return cache;
  const { value } = await Preferences.get({ key: KEY });
  if (value) {
    try {
      const parsed = JSON.parse(value) as RegistryState;
      if (parsed?.vaults?.length && parsed.activeId) {
        // Older versions wrote the person's "Trennen" as `paused`; it is the
        // person's own pause, `pausedHere`, which no sign-in undoes (second
        // review, B4a). Moved once, then written back.
        const migrated = migrateLegacyPause(parsed);
        cache = migrated;
        if (migrated !== parsed) await persist(migrated);
        return migrated;
      }
    } catch {
      /* corrupt registry -> rebuild below */
    }
  }
  // First run after the rework: keep the existing sandbox as the local
  // vault and DISCONNECT any pre-isolation sync slot — its local files are
  // a mixed set and must never be pushed anywhere again.
  const fresh: RegistryState = {
    vaults: [{ id: LOCAL_VAULT_ID, name: "" }],
    activeId: LOCAL_VAULT_ID,
  };
  if (!value) newLocalVaults.add(LOCAL_VAULT_ID);
  await persist(fresh);
  const creds = getPlatformServices().credentials;
  for (const key of PRE_ISOLATION_SECRET_KEYS) {
    await creds.removeSecret(key).catch(() => {});
  }
  return fresh;
}

export async function listVaults(): Promise<VaultEntry[]> {
  return (await loadRegistry()).vaults;
}

export async function getActiveVaultEntry(): Promise<VaultEntry> {
  const reg = await loadRegistry();
  return reg.vaults.find((v) => v.id === reg.activeId) ?? reg.vaults[0];
}

export async function addVault(entry: VaultEntry): Promise<void> {
  const reg = await loadRegistry();
  if (reg.vaults.some(v => v.id === entry.id)) throw new Error(`vault already registered: ${entry.id}`);
  await persist({ vaults: [...reg.vaults, entry], activeId: reg.activeId });
  if (!entry.provider && !entry.external) newLocalVaults.add(entry.id);
}

export async function setActiveVault(id: string): Promise<void> {
  const reg = await loadRegistry();
  if (!reg.vaults.some((v) => v.id === id)) throw new Error(`unknown vault: ${id}`);
  await persist({ ...reg, activeId: id });
}

export async function getVaultEntry(id: string): Promise<VaultEntry | null> {
  const reg = await loadRegistry();
  return reg.vaults.find((v) => v.id === id) ?? null;
}

export async function updateVault(id: string, patch: Partial<Omit<VaultEntry, "id">>): Promise<void> {
  const reg = await loadRegistry();
  await persist({
    ...reg,
    vaults: reg.vaults.map((v) => (v.id === id ? { ...v, ...patch } : v)),
  });
  window.dispatchEvent(new CustomEvent("m-vaults-changed"));
}

/** Removes the registry entry only — the caller tears down container/slot. */
export async function removeVault(id: string): Promise<void> {
  if (id === LOCAL_VAULT_ID) throw new Error("the local vault cannot be removed");
  const reg = await loadRegistry();
  await persist({
    activeId: reg.activeId === id ? LOCAL_VAULT_ID : reg.activeId,
    vaults: reg.vaults.filter((v) => v.id !== id),
  });
  window.dispatchEvent(new CustomEvent("m-vaults-changed"));
}

export function newVaultId(): string {
  return crypto.randomUUID();
}
