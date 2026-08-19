import {
  identityKey,
  parseDriveAboutIdentity,
  parseDropboxAccountIdentity,
  parseGoogleUserInfo,
  parseMicrosoftMe,
  type CloudAccountRecord,
  type VerifiedProviderIdentity,
} from "@plainva/ui";
import {
  ONEDRIVE_DEFAULT_SCOPE,
  refreshDriveAccessToken,
  refreshDropboxAccessToken,
  refreshOneDriveAccessToken,
} from "@plainva/core";
import { webdavFetch } from "../adapters/webdavHttp";
import { getAccountToken } from "./accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { getPimCredentials } from "./pim/pimCredentials";
import { getStoredProvider } from "./syncService";

/**
 * Giving a cloud card the address of the account behind it (P5).
 *
 * The desktop has done this since stage A; the phone never did, so its cards
 * carried a vault name and a calendar's own label and nothing that could be
 * compared. That is not cosmetic: the merge rule is "same family AND same
 * verified identity", so a card without one can never fold — the phone listed
 * accounts the desktop had long since joined, and every sync handed the split
 * back (finding 2026-08-19).
 *
 * One cheap call per account, silent on every failure, and never a guess: an
 * address the user typed is not provider-attested, so CalDAV stays untouched.
 */

interface Identity {
  email: string | null;
  verified?: VerifiedProviderIdentity;
}

const needsIdentity = (record: CloudAccountRecord) =>
  !identityKey(record.label) || !record.verifiedProviderIdentity;

async function googleIdentity(clientId: string, clientSecret: string, refreshToken: string): Promise<Identity | null> {
  const { accessToken } = await refreshDriveAccessToken({ clientId, clientSecret, refreshToken }, webdavFetch);
  const res = await webdavFetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok) {
    const profile = parseGoogleUserInfo(await res.json());
    if (profile) return { email: profile.label ?? null, verified: profile.identity };
  }
  // A token predating the identity scope still answers Drive's own about call,
  // which names the user — an address without attestation, but a real one.
  const about = await webdavFetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!about.ok) return null;
  return { email: parseDriveAboutIdentity(await about.json()) };
}

async function microsoftIdentity(clientId: string, refreshToken: string): Promise<Identity | null> {
  const { accessToken } = await refreshOneDriveAccessToken(
    { clientId, refreshToken, scope: ONEDRIVE_DEFAULT_SCOPE },
    webdavFetch,
  );
  const res = await webdavFetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const profile = parseMicrosoftMe(await res.json());
  return profile ? { email: profile.label ?? null, verified: profile.identity } : null;
}

async function apply(vaultId: string, records: CloudAccountRecord[], targetId: string, found: Identity | null) {
  if (!found || (!found.email && !found.verified)) return null;
  const next = records.map((record) =>
    record.id === targetId
      ? {
          ...record,
          ...(found.email ? { label: found.email } : {}),
          ...(found.verified ? { verifiedProviderIdentity: found.verified } : {}),
        }
      : record,
  );
  await saveCloudAccounts(vaultId, next);
  return next;
}

/**
 * The calendar-only card. Google only, for the desktop's reasons: a CalDAV
 * address is user-entered, and a Microsoft calendar token does not necessarily
 * carry `User.Read` — refreshing it against a foreign scope to find out is not
 * a silent best-effort operation.
 */
export async function backfillMobileCalendarIdentity(vaultId: string): Promise<CloudAccountRecord[] | null> {
  const records = await loadCloudAccounts(vaultId);
  const target = records.find((r) => !r.services.files && r.services.calendar && needsIdentity(r));
  if (!target) return null;
  try {
    const creds = await getPimCredentials(vaultId, target.services.calendar!.pimAccountId);
    if (creds?.kind !== "google") return null;
    // A stage-B account keeps its per-service token deliberately empty; the
    // shared one is the only one that can answer.
    const refreshToken = creds.refreshToken || (await getAccountToken(vaultId, target.id))?.refreshToken;
    if (!refreshToken) return null;
    return await apply(vaultId, records, target.id, await googleIdentity(creds.clientId, creds.clientSecret, refreshToken));
  } catch {
    return null;
  }
}

/** The files card — sync slots store a token and no identity at all. */
export async function backfillMobileSyncIdentity(vaultId: string): Promise<CloudAccountRecord[] | null> {
  const records = await loadCloudAccounts(vaultId);
  const target = records.find((r) => r.services.files && needsIdentity(r));
  if (!target) return null;
  try {
    const provider = await getStoredProvider(vaultId);
    if (!provider) return null;
    const creds = provider.creds as { clientId?: string; clientSecret?: string; appKey?: string; refreshToken?: string };
    const shared = (await getAccountToken(vaultId, target.id))?.refreshToken;
    const refreshToken = creds.refreshToken || shared;
    if (!refreshToken) return null;

    let found: Identity | null = null;
    if (provider.provider === "drive" && creds.clientId) {
      found = await googleIdentity(creds.clientId, creds.clientSecret ?? "", refreshToken);
    } else if (provider.provider === "onedrive" && creds.clientId) {
      found = await microsoftIdentity(creds.clientId, refreshToken);
    } else if (provider.provider === "dropbox" && creds.appKey) {
      const { accessToken } = await refreshDropboxAccessToken({ appKey: creds.appKey, refreshToken }, webdavFetch);
      const res = await webdavFetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) found = { email: parseDropboxAccountIdentity(await res.json()) };
    }
    return await apply(vaultId, records, target.id, found);
  } catch {
    return null;
  }
}
