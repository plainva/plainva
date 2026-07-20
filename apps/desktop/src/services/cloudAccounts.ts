import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { refreshDriveAccessToken, refreshDropboxAccessToken, type PimAccountRow } from "@plainva/core";
import {
  reconcileCloudAccounts,
  familyOfSyncProvider,
  looksLikeNextcloud,
  identityKey,
  parseDriveAboutIdentity,
  parseDropboxAccountIdentity,
  familyOfWebDavUrl,
  familyOfCalDavUrl,
  familyOfImapHost,
  PLAINVA_ONEDRIVE_CLIENT_ID,
  PLAINVA_DROPBOX_APP_KEY,
  type CloudAccountRecord,
  type ObservedCloudState,
  type SyncProviderId,
} from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { credentialManager } from "./CredentialManager";
import { listMailAccounts, mailAccountKind } from "./mail/mailAccounts";
import type { PimRuntime } from "./pim/pimRuntime";

/**
 * Desktop side of the cloud-account registry (stage A of the central
 * "Cloud-Konten" plan): a per-vault settings-store entry that GROUPS the three
 * subsystem stores (sync keychain slots, pim_accounts, mail accounts) into
 * user-visible accounts. References only — the subsystems stay the runtime
 * truth, reconciliation is additive and never re-authenticates or deletes
 * subsystem state.
 */

export const CLOUD_ACCOUNTS_EVENT = "plainva-cloud-accounts-changed";

const registryKey = (vaultPath: string) => `cloudAccounts_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function loadCloudAccounts(vaultPath: string): Promise<CloudAccountRecord[]> {
  const store = await getSettingsStore();
  const raw = await store.get<CloudAccountRecord[]>(registryKey(vaultPath));
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string" && !!r.services) : [];
}

export async function saveCloudAccounts(vaultPath: string, records: CloudAccountRecord[]): Promise<void> {
  const store = await getSettingsStore();
  await store.set(registryKey(vaultPath), records);
  await store.save();
  window.dispatchEvent(new CustomEvent(CLOUD_ACCOUNTS_EVENT, { detail: { vaultPath } }));
}

/**
 * Reads the vault's sync slots and derives the active provider (same
 * precedence as the settings form: drive > onedrive > dropbox > s3 > webdav)
 * plus whatever identity/extra data is derivable WITHOUT network calls.
 */
export async function observeSyncSlot(vaultPath: string): Promise<ObservedCloudState["sync"]> {
  const drive = await credentialManager.getDriveCredentials(vaultPath);
  if (drive) return { provider: "drive", byoClientId: drive.clientId || undefined };
  const onedrive = await credentialManager.getOneDriveCredentials(vaultPath);
  if (onedrive) {
    return {
      provider: "onedrive",
      byoClientId: onedrive.clientId && onedrive.clientId !== PLAINVA_ONEDRIVE_CLIENT_ID ? onedrive.clientId : undefined,
    };
  }
  const dropbox = await credentialManager.getDropboxCredentials(vaultPath);
  if (dropbox) {
    return {
      provider: "dropbox",
      byoClientId: dropbox.appKey && dropbox.appKey !== PLAINVA_DROPBOX_APP_KEY ? dropbox.appKey : undefined,
    };
  }
  const s3 = await credentialManager.getS3Credentials(vaultPath);
  if (s3) return { provider: "s3", identity: s3.bucket || undefined };
  const webdav = await credentialManager.getWebDavCredentials(vaultPath);
  if (webdav) {
    // A catalog provider's WebDAV host (Fastmail/Yandex/…) makes the slot a
    // named suite family; the user field of those suites is the mail address.
    const catalogFamily = familyOfWebDavUrl(webdav.url) ?? undefined;
    let identity: string | undefined;
    if (catalogFamily && identityKey(webdav.user)) {
      identity = webdav.user;
    } else {
      try {
        identity = `${webdav.user}@${new URL(webdav.url).host}`;
      } catch {
        identity = webdav.user || undefined;
      }
    }
    return {
      provider: "webdav",
      identity,
      flavor: looksLikeNextcloud(webdav.url) ? "nextcloud" : undefined,
      family: catalogFamily,
    };
  }
  return undefined;
}

async function observeState(vaultPath: string, pimRuntime: PimRuntime | null): Promise<ObservedCloudState> {
  const sync = await observeSyncSlot(vaultPath);
  let pim: ObservedCloudState["pim"] = [];
  if (pimRuntime) {
    const rows: PimAccountRow[] = await pimRuntime.cache.listAccounts();
    pim = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      byoClientId:
        typeof r.config?.clientId === "string" && r.config.clientId !== PLAINVA_ONEDRIVE_CLIENT_ID
          ? r.config.clientId
          : undefined,
      family:
        r.provider === "caldav" && typeof r.config?.url === "string"
          ? (familyOfCalDavUrl(r.config.url) ?? undefined)
          : undefined,
    }));
  }
  const mailAccounts = await listMailAccounts(vaultPath);
  const mail: ObservedCloudState["mail"] = mailAccounts.map((a) => ({
    id: a.id,
    kind: mailAccountKind(a),
    label: a.label,
    user: a.user,
    host: a.host,
    byoClientId: a.clientId && a.clientId !== PLAINVA_ONEDRIVE_CLIENT_ID ? a.clientId : undefined,
    family: mailAccountKind(a) === "imap" ? (familyOfImapHost(a.host) ?? undefined) : undefined,
  }));
  return { sync, pim, mail };
}

/**
 * Loads, reconciles against the live subsystem state and persists the result
 * when it changed. Safe without a pim runtime (closed vault): calendar
 * references are then carried through unverified rather than dropped.
 */
export async function refreshCloudAccounts(vaultPath: string, pimRuntime: PimRuntime | null): Promise<CloudAccountRecord[]> {
  const stored = await loadCloudAccounts(vaultPath);
  const observed = await observeState(vaultPath, pimRuntime);
  if (!pimRuntime) {
    // No runtime = no pim truth. Feed the stored calendar refs back as
    // observations so reconcile keeps them instead of treating them as gone.
    observed.pim = stored
      .filter((r) => r.services.calendar)
      .map((r) => ({ id: r.services.calendar!.pimAccountId, provider: "caldav" as const, label: r.label }));
  }
  const next = reconcileCloudAccounts(stored, observed);
  if (JSON.stringify(next) !== JSON.stringify(stored) && recordShape(next) !== lastSavedShape.get(vaultPath)) {
    lastSavedShape.set(vaultPath, recordShape(next));
    await saveCloudAccounts(vaultPath, next);
  }
  return next;
}

/**
 * Event-storm guard: saveCloudAccounts dispatches CLOUD_ACCOUNTS_EVENT, whose
 * listeners call refreshCloudAccounts again. When the settings store cannot
 * persist (readonly disk, mocked store), every round would re-derive the same
 * accounts under FRESH random ids and "change" forever. The id-less shape of
 * the last save therefore blocks re-saving the semantically identical result.
 */
const lastSavedShape = new Map<string, string>();
const recordShape = (records: CloudAccountRecord[]): string =>
  JSON.stringify(records.map(({ id: _id, ...rest }) => rest));

/**
 * Best-effort identity backfill for the files-only account of this vault
 * (sync slots store tokens without any identity). Cheap where the existing
 * scopes allow it: Drive `about.get`, Dropbox `get_current_account`. OneDrive
 * stays without identity until its next re-consent (`/me` needs User.Read,
 * which the sync token does not carry). Silent on every failure.
 */
export async function backfillSyncIdentity(vaultPath: string): Promise<CloudAccountRecord[] | null> {
  const records = await loadCloudAccounts(vaultPath);
  const target = records.find((r) => r.services.files && !identityKey(r.label));
  if (!target) return null;
  const provider = target.services.files!.provider;
  try {
    let email: string | null = null;
    if (provider === "drive") {
      const creds = await credentialManager.getDriveCredentials(vaultPath);
      if (!creds?.refreshToken) return null;
      const { accessToken } = await refreshDriveAccessToken(
        { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken },
        httpFetch
      );
      const res = await httpFetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) email = parseDriveAboutIdentity(await res.json());
    } else if (provider === "dropbox") {
      const creds = await credentialManager.getDropboxCredentials(vaultPath);
      if (!creds?.refreshToken) return null;
      const { accessToken } = await refreshDropboxAccessToken(
        { appKey: creds.appKey, refreshToken: creds.refreshToken },
        httpFetch
      );
      const res = await httpFetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) email = parseDropboxAccountIdentity(await res.json());
    }
    if (!email) return null;
    const next = records.map((r) => (r.id === target.id ? { ...r, label: email! } : r));
    await saveCloudAccounts(vaultPath, next);
    return next;
  } catch {
    return null;
  }
}

/** Display family of the vault's active sync provider (slim sync page card). */
export function syncProviderFamily(provider: SyncProviderId) {
  return familyOfSyncProvider(provider);
}
