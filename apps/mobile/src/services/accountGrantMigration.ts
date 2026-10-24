import { refreshDriveAccessToken, refreshOneDriveAccessToken } from "@plainva/core";
import { createLegacyGrantSource, legacyOAuthToken, logDiagnostic, migrateAccountGrant, migrateVaultAccountGrants, rotateLegacyGrant, vaultGrantMigrationDiagnostic, PLAINVA_ONEDRIVE_CLIENT_ID, withAccountCredentialLock, type CloudAccountRecord, type CloudServiceId, type StoredAccountToken, type VaultGrantMigration } from "@plainva/ui";
import { legacyMailSecretKey, listMailAccounts, mailAccountKind, mailSecretKey, type MailAccountConfig } from "@plainva/ui/mail";
import { webdavFetch } from "../adapters/webdavHttp";
import { accountSecretKey, getAccountToken, saveAccountToken } from "./accountBroker";
import { accountCredentialStore } from "./accountCredentialStore";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { pimSecretKey } from "./pim/pimCredentials";
import { syncProviderSlot } from "./syncSlot";
import { authorizeNativeGoogle } from "./googleNativeAuthorization";

function retiredGrant(value: Record<string, unknown>, refreshToken: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value, refreshToken };
  if (value.nativeGoogle && !refreshToken) delete next.nativeGoogle;
  return next;
}

export async function rotateLegacyFileGrant(key: string, provider: "drive" | "onedrive" | "dropbox", expected: StoredAccountToken, refreshToken: string): Promise<void> {
  const source = createLegacyGrantSource({ store: accountCredentialStore, keys: [key],
    token: (raw) => {
      if (raw.provider !== provider || !raw.creds || typeof raw.creds !== "object") return null;
      const creds = raw.creds as Record<string, unknown>;
      return legacyOAuthToken(provider === "dropbox" ? { ...creds, clientId: creds.appKey } : creds);
    },
    replace: (raw, next) => ({ ...raw, creds: retiredGrant(raw.creds as Record<string, unknown>, next) }),
  });
  await rotateLegacyGrant(source, expected, refreshToken);
}

export async function migrateLegacyAccountGrant(vaultId: string, record: CloudAccountRecord, service: CloudServiceId, requiredServices?: readonly CloudServiceId[]) {
  const family = record.family;
  if (family !== "google" && family !== "microsoft") return "absent" as const;
  const bindingId = service === "calendar" ? record.services.calendar?.pimAccountId : record.services.mail?.mailAccountId;
  const provider = record.services.files?.provider;
  if (service === "files" && provider !== (family === "google" ? "drive" : "onedrive")) return "absent" as const;
  if (service !== "files" && !bindingId) return "absent" as const;
  if (service === "mail" && family !== "microsoft") return "absent" as const;
  const keys = service === "files" ? [syncProviderSlot(vaultId)] : service === "calendar" ? [pimSecretKey(vaultId, bindingId!)]
    : [mailSecretKey(vaultId, bindingId!), legacyMailSecretKey(vaultId, bindingId!)];
  const source = createLegacyGrantSource({ store: accountCredentialStore, keys,
    binding: service === "mail" ? async () => (await listMailAccounts(vaultId)).find((mail) => mail.id === bindingId) ?? null : undefined,
    token: (raw, binding) => {
      if (service === "calendar" && raw.kind !== family) return null;
      if (service === "files") {
        if (raw.provider !== provider || !raw.creds || typeof raw.creds !== "object") return null;
        return legacyOAuthToken(raw.creds as Record<string, unknown>);
      }
      if (service === "mail") {
        const mail = binding as MailAccountConfig | null;
        if (!mail || mailAccountKind(mail) !== "microsoft") return null;
        return legacyOAuthToken({ ...raw, clientId: mail.clientId || PLAINVA_ONEDRIVE_CLIENT_ID });
      }
      return legacyOAuthToken(raw);
    },
    replace: (raw, refreshToken) => service === "files" ? { ...raw, creds: retiredGrant(raw.creds as Record<string, unknown>, refreshToken) } : retiredGrant(raw, refreshToken),
  });
  return withAccountCredentialLock(`account-migration:${accountSecretKey(vaultId, record.id)}:${service}`, () => migrateAccountGrant({
    record: structuredClone(record), service, requiredServices, ...source,
    readRecord: () => loadCloudAccounts(vaultId).then((rows) => rows.find((row) => row.id === record.id)),
    readConfirmed: (token) => getAccountToken(vaultId, record.id, service, family, token),
    saveConfirmed: (token) => saveAccountToken(vaultId, record.id, token),
    fetch: webdavFetch,
    refresh: async (token, scope) => {
      if (family === "google" && token.nativeGoogle) return authorizeNativeGoogle(scope, false, token);
      if (family === "google") return refreshDriveAccessToken({ ...token, clientSecret: token.clientSecret ?? "" }, webdavFetch);
      return refreshOneDriveAccessToken({ clientId: token.clientId, refreshToken: token.refreshToken, scope }, webdavFetch);
    },
  }));
}

/**
 * The vault-wide pass of account sign-in plan K2 (`migrateVaultAccountGrants`):
 * every calendar and mailbox of a Google or Microsoft card hands a sign-in of
 * its own to the card before the services start. Bounded: a slow provider
 * never holds the vault back - what is still running finishes on its own,
 * and the next open finds it done or tries again.
 */
export async function migrateVaultGrants(vaultId: string, timeoutMs = 8000): Promise<VaultGrantMigration[] | null> {
  const pass = migrateVaultAccountGrants({
    cards: () => loadCloudAccounts(vaultId),
    migrate: (record, service) => migrateLegacyAccountGrant(vaultId, record, service),
  }).then((results) => {
    const line = vaultGrantMigrationDiagnostic(results);
    if (line) logDiagnostic("accounts", line);
    return results;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([pass, late]);
  } finally {
    clearTimeout(timer);
  }
}
