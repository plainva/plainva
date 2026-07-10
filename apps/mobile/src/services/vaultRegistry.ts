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

export interface VaultEntry {
  id: string;
  /** Display name; empty for the local vault (the UI localizes that). */
  name: string;
  provider?: string;
  /** Sync paused ("disconnected" in the UI); credentials stay stored. */
  paused?: boolean;
}

interface RegistryState {
  vaults: VaultEntry[];
  activeId: string;
}

const KEY = "vault_registry";

/** Pre-isolation credential slots: they belonged to the mixed sandbox. */
const PRE_ISOLATION_SECRET_KEYS = ["sync_provider_mobile", "webdav_credentials_mobile"];

let cache: RegistryState | null = null;

async function persist(state: RegistryState): Promise<void> {
  cache = state;
  await Preferences.set({ key: KEY, value: JSON.stringify(state) });
}

export async function loadRegistry(): Promise<RegistryState> {
  if (cache) return cache;
  const { value } = await Preferences.get({ key: KEY });
  if (value) {
    try {
      const parsed = JSON.parse(value) as RegistryState;
      if (parsed?.vaults?.length && parsed.activeId) {
        cache = parsed;
        return parsed;
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
  await persist({ vaults: [...reg.vaults, entry], activeId: reg.activeId });
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
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
