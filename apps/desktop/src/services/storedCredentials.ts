import { credentialManager } from "./CredentialManager";
import { getSettingsStore } from "./settingsStore";
import { collectVaultKeychainSlots } from "./vaultForget";

/**
 * "Stored access" — what Plainva has put in the OS keychain, and for whom (P5b).
 *
 * The keychain accumulates. The maintainer's held a master-key cache for a vault
 * path that no longer exists and provider credentials for a test vault given up
 * long ago (2026-08-10). Nothing ever listed them, so nothing could be decided
 * about them: the names alone say neither which account nor which vault they
 * belong to (B6), and "forget this vault" cannot reach a vault that is no longer
 * in the list at all (E2).
 *
 * **The known limit, stated plainly.** This does not enumerate the keychain —
 * the `keyring` crate has no search API, and doing it natively would mean three
 * platform-specific implementations of which only one could be verified here.
 * Instead every slot Plainva could have written is DERIVED and then probed with
 * a single read. The derivation covers every vault the settings store still
 * remembers, which is more than the recent list: a vault removed from that list
 * keeps its settings keys unless the user also chose "forget app data". What
 * stays invisible is a slot whose settings keys are gone as well. Enumerating
 * for real belongs with the naming change (P6), which needs native work anyway.
 */

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

const decodeVaultPath = (encoded: string): string | null => {
  try {
    const decoded = decodeURIComponent(escape(atob(encoded)));
    // Round-trip guard: a settings key that merely ends in something
    // base64-shaped must not be mistaken for a vault path.
    return decoded && b64(decoded) === encoded ? decoded : null;
  } catch {
    return null;
  }
};

/**
 * Every vault path the settings store still carries evidence of.
 *
 * Per-vault keys all end in `_<b64(path)>` (see perVaultStoreSuffix), so the
 * paths can be read back out of the key names — including those of vaults that
 * were dropped from the recent list.
 */
export async function knownVaultPathsFromSettings(): Promise<string[]> {
  const store = await getSettingsStore();
  const paths = new Set<string>();
  for (const key of await store.keys()) {
    const underscore = key.lastIndexOf("_");
    if (underscore < 0) continue;
    const path = decodeVaultPath(key.slice(underscore + 1));
    if (path) paths.add(path);
  }
  return [...paths].sort();
}

export type StoredCredentialKind = "files" | "calendar" | "mail" | "account" | "vault";

export interface StoredCredentialEntry {
  slot: string;
  vaultPath: string;
  kind: StoredCredentialKind;
  /** Provider or account id as it appears in the slot; absent for vault-wide slots. */
  detail?: string;
  /** The vault is no longer in the recent list — a leftover, not in use. */
  orphaned: boolean;
}

const PROVIDER_SLOTS = ["webdav", "drive", "s3", "onedrive", "dropbox"] as const;

function describeSlot(slot: string, vaultPath: string): { kind: StoredCredentialKind; detail?: string } {
  const key = b64(vaultPath);
  const provider = PROVIDER_SLOTS.find((p) => slot === `${p}_credentials_${key}`);
  if (provider) return { kind: "files", detail: provider };
  if (slot.startsWith("pim_")) return { kind: "calendar", detail: slot.slice(4, slot.length - key.length - 1) };
  if (slot.startsWith("mail_")) return { kind: "mail", detail: slot.slice(5, slot.length - key.length - 1) };
  if (slot.startsWith("account_repair_backup_")) return { kind: "vault", detail: "repair-backup" };
  if (slot.startsWith("account_")) return { kind: "account", detail: slot.slice(8, slot.length - key.length - 1) };
  if (slot.startsWith("mkcache_")) return { kind: "vault", detail: "master-key" };
  return { kind: "vault" };
}

/** Every slot name Plainva could have written for this vault. */
async function candidateSlots(vaultPath: string): Promise<string[]> {
  const key = b64(vaultPath);
  return [
    ...PROVIDER_SLOTS.map((p) => `${p}_credentials_${key}`),
    ...(await collectVaultKeychainSlots(vaultPath)),
  ];
}

/**
 * Probes the derived slots and returns the ones that actually hold something.
 *
 * `recentVaults` decides only whether an entry is flagged as a leftover; the
 * listing itself never depends on it, because the leftovers are the point.
 */
export async function listStoredCredentials(): Promise<StoredCredentialEntry[]> {
  const store = await getSettingsStore();
  const recent = new Set((await store.get<string[]>("recentVaults")) ?? []);
  const active = await store.get<string>("lastVaultPath");
  if (active) recent.add(active);

  const entries: StoredCredentialEntry[] = [];
  for (const vaultPath of await knownVaultPathsFromSettings()) {
    for (const slot of await candidateSlots(vaultPath)) {
      let present: boolean;
      try {
        present = (await credentialManager.readSecret(slot)) !== null;
      } catch {
        // An unreadable slot is reported as absent rather than failing the
        // whole listing: one locked entry must not hide the other findings.
        present = false;
      }
      if (!present) continue;
      entries.push({
        slot,
        vaultPath,
        ...describeSlot(slot, vaultPath),
        orphaned: !recent.has(vaultPath),
      });
    }
  }
  // Leftovers first — they are what the user came to decide about.
  return entries.sort((a, b) =>
    a.orphaned === b.orphaned ? a.vaultPath.localeCompare(b.vaultPath) || a.slot.localeCompare(b.slot) : a.orphaned ? -1 : 1,
  );
}

/** Removes one stored access. Always explicit; nothing here is automatic (E2). */
export async function removeStoredCredential(slot: string): Promise<void> {
  await credentialManager.removeSecret(slot);
}
