import {
  getPlatformServices,
  reconcileCloudAccounts,
  type CloudAccountRecord,
  type ObservedCloudState,
  type SyncProviderId,
} from "@plainva/ui";
import { listMailAccounts, mailAccountKind } from "@plainva/ui/mail";
import { listPimAccounts } from "./pim/pimService";
import { getActiveVaultEntry } from "./vaultRegistry";

/**
 * The phone's cloud-account registry — a real one, stored per vault, the same
 * `CloudAccountRecord[]` the desktop keeps (plan decision E4).
 *
 * The mobile Cloud accounts screen used to DERIVE its list from the PIM and
 * mail accounts it happened to find. Derivation cannot know two things that
 * matter: which provider family an account belongs to (a self-hosted CalDAV
 * server is not distinguishable from any other WebDAV by its URL alone), and
 * which services belong to the SAME account. The first one broke the secrets
 * sync — the desktop said "nextcloud", the phone said "webdav", and the
 * credential binding never matched. The second made one account look like two.
 *
 * The record set is also what travels in the settings profile, so a phone that
 * only derived its own view would silently drop the desktop's registry on every
 * round trip.
 */

const registryKey = (vaultId: string) => `cloudAccounts_${vaultId}`;
export const CLOUD_ACCOUNTS_EVENT = "m-cloud-accounts-changed";

async function store() {
  return getPlatformServices().loadSettings();
}

export async function loadCloudAccounts(vaultId: string): Promise<CloudAccountRecord[]> {
  const raw = await (await store()).get<CloudAccountRecord[]>(registryKey(vaultId));
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string" && !!r.services) : [];
}

export async function saveCloudAccounts(vaultId: string, records: CloudAccountRecord[]): Promise<void> {
  const s = await store();
  await s.set(registryKey(vaultId), records);
  await s.save();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CLOUD_ACCOUNTS_EVENT));
}

/** Drops the registry of a deleted vault (mirrors clearMobileSyncState). */
export async function clearCloudAccounts(vaultId: string): Promise<void> {
  const s = await store();
  await s.delete(registryKey(vaultId));
  await s.save();
}

/** What the subsystems on this device currently report. */
async function observe(vaultId: string): Promise<ObservedCloudState> {
  const entry = await getActiveVaultEntry().catch(() => null);
  const pim = (await listPimAccounts()).map((a) => ({
    id: a.id,
    provider: a.provider,
    label: a.label,
    ...(typeof a.config.clientId === "string" ? { byoClientId: a.config.clientId } : {}),
  }));
  const mail = (await listMailAccounts(vaultId)).map((a) => ({
    id: a.id,
    kind: mailAccountKind(a),
    label: a.label,
    user: a.user,
    host: a.host,
    ...(a.clientId ? { byoClientId: a.clientId } : {}),
  }));
  // The registry entry stores the provider as a plain string; only the five
  // known sync providers are meaningful here.
  const provider = entry?.provider as SyncProviderId | undefined;
  const knownProvider = provider && (["webdav", "drive", "onedrive", "dropbox", "s3"] as const).includes(provider) ? provider : undefined;
  return {
    ...(knownProvider ? { sync: { provider: knownProvider } } : {}),
    pim,
    mail,
  };
}

/**
 * Reconciles the stored registry against what this device actually has.
 *
 * Deliberately conservative in one place: when the PIM runtime is not up yet,
 * its accounts are fed back from the STORED registry instead of being observed
 * as absent — otherwise a boot race would drop every calendar account from the
 * registry and, through the profile, from the other devices too.
 */
export async function refreshCloudAccounts(vaultId: string, pimReady: boolean): Promise<CloudAccountRecord[]> {
  const stored = await loadCloudAccounts(vaultId);
  const observed = await observe(vaultId);
  if (!pimReady) {
    observed.pim = stored
      .filter((r) => r.services.calendar)
      .map((r) => ({ id: r.services.calendar!.pimAccountId, provider: "caldav" as const, label: r.label }));
  }
  const next = reconcileCloudAccounts(stored, observed);
  if (JSON.stringify(next) !== JSON.stringify(stored)) await saveCloudAccounts(vaultId, next);
  return next;
}
