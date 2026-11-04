import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getSettingsStore } from "./settingsStore";
import { notifyAppearanceChanged } from "./appearanceSync";

/**
 * The name a vault goes by in Plainva on this device (Sammelplan § 3.169 Nr. 3).
 *
 * The phone has always let a vault be renamed — a label in its vault list, the
 * cloud folder untouched. The desktop named a vault after its folder and had
 * nothing to rename it with. Renaming the FOLDER is not the same thing: every
 * per-vault setting, the index and the keychain slots are keyed by the path,
 * and the folder belongs to the person and to whatever else reads it. So the
 * desktop gets what the phone has: a name of the vault's own, kept beside its
 * other per-vault settings (`vaultName_<b64(path)>`, the suffix "forget this
 * vault" sweeps), on this device only, and shown wherever the vault is named —
 * the settings rail, the vault picker, the vault line of the sidebar and the
 * start screen. Without one, the folder's name stands, as before.
 */

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

export const vaultNameKey = (vaultPath: string) => `vaultName_${b64(vaultPath)}`;

/** The folder's name — what a vault without a name of its own is called. */
export function vaultFolderLabel(vaultPath: string): string {
  return vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? vaultPath;
}

const names = new Map<string, string>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

function load(vaultPath: string): void {
  if (loading.has(vaultPath)) return;
  loading.add(vaultPath);
  void getSettingsStore()
    .then((store) => store.get<string>(vaultNameKey(vaultPath)))
    .then((name) => {
      if (typeof name === "string" && name.trim()) names.set(vaultPath, name.trim());
      else names.delete(vaultPath);
      notify();
    })
    .catch(() => {
      // No store (browser, tests): the folder's name stands.
    });
}

/** The vault's name: its own where it has one, else the folder's. */
export function vaultLabel(vaultPath: string): string {
  return names.get(vaultPath) ?? vaultFolderLabel(vaultPath);
}

/** Whether the vault has a name of its own (the rename row shows the folder beside it). */
export function hasOwnVaultName(vaultPath: string): boolean {
  return names.has(vaultPath);
}

/**
 * Re-renders with the names of these vaults, read once per vault and kept;
 * a rename anywhere in this window shows at once.
 */
export function useVaultLabels(vaultPaths: readonly (string | null | undefined)[]): (vaultPath: string) => string {
  const key = vaultPaths.filter(Boolean).join("\n");
  useEffect(() => {
    for (const path of key.split("\n")) if (path) load(path);
  }, [key]);
  const seen = useSyncExternalStore(subscribe, () => version);
  // A new function whenever a name changed: a memoised render that called the
  // old one with the same path would keep the old name.
  return useMemo(() => {
    void seen;
    return (vaultPath: string) => vaultLabel(vaultPath);
  }, [seen]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Gives the vault a name of its own, or takes it away: an empty name, or the
 * folder's own, means "called after its folder" and removes the setting.
 */
export async function renameVault(vaultPath: string, name: string): Promise<void> {
  const trimmed = name.trim();
  const store = await getSettingsStore();
  if (!trimmed || trimmed === vaultFolderLabel(vaultPath)) {
    await store.delete(vaultNameKey(vaultPath));
    names.delete(vaultPath);
  } else {
    await store.set(vaultNameKey(vaultPath), trimmed);
    names.set(vaultPath, trimmed);
  }
  await store.save();
  notify();
  // Every other window names the vault too - its title bar first of all
  // (Sammelplan § 3.171 Nr. 4) - and keeps the names it read in memory.
  notifyAppearanceChanged();
}

/**
 * Reads every name this window has asked for again: another window renamed a
 * vault (`appearanceSync.ts`).
 */
export function reloadVaultNames(): void {
  const known = new Set([...loading, ...names.keys()]);
  loading.clear();
  for (const path of known) load(path);
}

/** Drops the remembered name after "forget this vault" removed the setting. */
export function forgetVaultName(vaultPath: string): void {
  if (names.delete(vaultPath)) notify();
  loading.delete(vaultPath);
}
