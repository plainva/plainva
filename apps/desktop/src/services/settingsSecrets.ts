import { canonicalizeEndpoint, type SecretBinding, type SecretsPort } from "@plainva/core";
import {
  createSecretsPort,
  familyOfCalDavUrl,
  familyOfImapHost,
  normalizeAccountMap,
  type CloudAccountRecord,
  type LocalSecretCandidate,
  type ProfileAccountMap,
  type SecretsPortMeta,
} from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { loadCloudAccounts } from "./cloudAccounts";
import { getSettingsStore } from "./settingsStore";
import { listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import { getPimCredentials, pimSecretKey, type PimStoredCredentials } from "./pim/pimCredentials";
import type { PimRuntime } from "./pim/pimRuntime";

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const metaKey = (vaultPath: string) => `settingsSyncSecretMeta_${b64(vaultPath)}`;
const accountMapKey = (vaultPath: string) => `settingsSyncAccountMap_${b64(vaultPath)}`;

async function deviceIdAndMap(vaultPath: string) {
  const store = await getSettingsStore();
  let deviceId = await store.get<string>("deviceId");
  if (!deviceId) {
    deviceId = globalThis.crypto.randomUUID();
    await store.set("deviceId", deviceId);
    await store.save();
  }
  const map = normalizeAccountMap(await store.get<ProfileAccountMap>(accountMapKey(vaultPath)));
  return { deviceId, map };
}

function familyFor(records: CloudAccountRecord[], service: "calendar" | "mail", localId: string, fallback: string): string {
  const record = records.find((r) =>
    service === "calendar" ? r.services.calendar?.pimAccountId === localId : r.services.mail?.mailAccountId === localId
  );
  return record?.family ?? fallback;
}

async function localCandidates(vaultPath: string, pimRuntime: PimRuntime): Promise<LocalSecretCandidate[]> {
  const [map, cloud, pimAccounts, mailAccounts] = await Promise.all([
    deviceIdAndMap(vaultPath).then((x) => x.map),
    loadCloudAccounts(vaultPath),
    pimRuntime.cache.listAccounts(),
    listMailAccounts(vaultPath),
  ]);
  const candidates: LocalSecretCandidate[] = [];

  for (const account of pimAccounts) {
    const creds = await getPimCredentials(vaultPath, account.id);
    const slot = pimSecretKey(vaultPath, account.id);
    const logicalId = map.secretLocalToLogical[slot] ?? map.pimLocalToLogical[account.id] ?? account.id;
    if (account.provider === "caldav") {
      const url = creds?.kind === "caldav" ? creds.url : typeof account.config.url === "string" ? account.config.url : "";
      const user = creds?.kind === "caldav" ? creds.user : typeof account.config.user === "string" ? account.config.user : "";
      if (!url || !user) continue;
      const binding: SecretBinding = {
        family: familyFor(cloud, "calendar", account.id, familyOfCalDavUrl(url) ?? "webdav"),
        service: "calendar",
        secretType: "caldav-password",
        user: user.trim().toLowerCase(),
        endpoint: canonicalizeEndpoint(url),
      };
      candidates.push({
        logicalId,
        slot,
        binding,
        secret: creds?.kind === "caldav" && creds.pass ? { pass: creds.pass } : null,
        apply: (secret) => ({ kind: "caldav", url, user, pass: secret.pass ?? "" } satisfies PimStoredCredentials),
      });
    } else if (account.provider === "google") {
      const clientId = creds?.kind === "google" ? creds.clientId : typeof account.config.clientId === "string" ? account.config.clientId : "";
      if (!clientId) continue;
      const binding: SecretBinding = {
        family: familyFor(cloud, "calendar", account.id, "google"),
        service: "calendar",
        secretType: "google-pim-client",
        user: account.label.trim().toLowerCase(),
        endpoint: canonicalizeEndpoint("https://accounts.google.com"),
      };
      candidates.push({
        logicalId,
        slot,
        binding,
        secret: creds?.kind === "google" && creds.clientSecret ? { clientId: creds.clientId, clientSecret: creds.clientSecret } : null,
        // Refresh tokens remain device-local and are deliberately preserved.
        apply: (secret) => ({
          kind: "google",
          clientId: secret.clientId ?? clientId,
          clientSecret: secret.clientSecret ?? "",
          refreshToken: creds?.kind === "google" ? creds.refreshToken : "",
        } satisfies PimStoredCredentials),
      });
    }
  }

  for (const account of mailAccounts) {
    if (mailAccountKind(account) !== "imap") continue;
    const stored = await credentialManager.readSecret<{ pass?: string; refreshToken?: string }>(mailSecretKey(vaultPath, account.id));
    const slot = mailSecretKey(vaultPath, account.id);
    const logicalId = map.secretLocalToLogical[slot] ?? map.mailLocalToLogical[account.id] ?? account.id;
    const scheme = account.port === 993 ? "imaps" : "imap+starttls";
    const binding: SecretBinding = {
      family: familyFor(cloud, "mail", account.id, familyOfImapHost(account.host) ?? "imap"),
      service: "mail",
      secretType: "imap-password",
      user: account.user.trim().toLowerCase(),
      endpoint: canonicalizeEndpoint(`${scheme}://${account.host}:${account.port}`),
    };
    candidates.push({
      logicalId,
      slot,
      binding,
      secret: stored?.pass ? { pass: stored.pass } : null,
      apply: (secret) => ({ ...(stored ?? {}), pass: secret.pass ?? "" }),
    });
  }
  return candidates;
}

/**
 * Desktop OS-keychain bridge for the encrypted secrets sideband.
 *
 * The decision logic - binding checks, tombstones, per-entry revisions, the
 * conflict rule and the rollback - lives in @plainva/ui createSecretsPort, so
 * the phone runs the SAME code rather than a second, subtly different copy
 * (H2c). This function supplies only what is desktop-specific.
 */
export function createDesktopSecretsPort(vaultPath: string, pimRuntime: PimRuntime): SecretsPort {
  return createSecretsPort({
    deviceId: async () => (await deviceIdAndMap(vaultPath)).deviceId,
    readMeta: async () => (await getSettingsStore()).get<SecretsPortMeta>(metaKey(vaultPath)).then((m) => m ?? null),
    writeMeta: async (meta) => {
      const store = await getSettingsStore();
      await store.set(metaKey(vaultPath), meta);
      await store.save();
    },
    candidates: () => localCandidates(vaultPath, pimRuntime),
    readSlot: (slot) => credentialManager.readSecret(slot),
    writeSlot: (slot, value) => credentialManager.writeSecret(slot, value),
    removeSlot: (slot) => credentialManager.removeSecret(slot),
  });
}
