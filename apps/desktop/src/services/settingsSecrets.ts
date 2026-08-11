import { canonicalSecretId, canonicalizeEndpoint, type SecretBinding, type SecretsPort } from "@plainva/core";
import {
  createSecretsPort,
  familyOfCalDavUrl,
  familyOfImapHost,
  migrateSecretsMetaToCanonicalIds,
  type CloudAccountRecord,
  type LocalSecretCandidate,
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

async function deviceId(): Promise<string> {
  const store = await getSettingsStore();
  let value = await store.get<string>("deviceId");
  if (!value) {
    value = globalThis.crypto.randomUUID();
    await store.set("deviceId", value);
    await store.save();
  }
  return value;
}

function familyFor(records: CloudAccountRecord[], service: "calendar" | "mail", localId: string, fallback: string): string {
  const record = records.find((r) =>
    service === "calendar" ? r.services.calendar?.pimAccountId === localId : r.services.mail?.mailAccountId === localId
  );
  return record?.family ?? fallback;
}

/**
 * A MAIL credential has nothing to do with the calendar runtime, yet demanding
 * one here (and in `secrets()`) meant a vault without a running PIM runtime
 * never transported a mail password at all — silently, with nothing in the
 * diagnostics to show for it. The phone never had that coupling
 * (`createMobileSecretsPort(vaultId)` asks for nothing else); the desktop was
 * the outlier. Without a runtime the mail candidates are still built, only the
 * calendar ones are skipped.
 */
async function localCandidates(vaultPath: string, pimRuntime: PimRuntime | null): Promise<LocalSecretCandidate[]> {
  const [cloud, pimAccounts, mailAccounts] = await Promise.all([
    loadCloudAccounts(vaultPath),
    pimRuntime ? pimRuntime.cache.listAccounts() : Promise.resolve([]),
    listMailAccounts(vaultPath),
  ]);
  const candidates: LocalSecretCandidate[] = [];

  for (const account of pimAccounts) {
    const creds = await getPimCredentials(vaultPath, account.id);
    const slot = pimSecretKey(vaultPath, account.id);
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
        logicalId: canonicalSecretId(binding),
        slot,
        binding,
        secret: creds?.kind === "caldav" && creds.pass ? { pass: creds.pass } : null,
        apply: (secret) => ({ kind: "caldav", url, user, pass: secret.pass ?? "" } satisfies PimStoredCredentials),
      });
    }
  }

  for (const account of mailAccounts) {
    if (mailAccountKind(account) !== "imap") continue;
    const stored = await credentialManager.readSecret<{ pass?: string; refreshToken?: string }>(mailSecretKey(vaultPath, account.id));
    const slot = mailSecretKey(vaultPath, account.id);
    const scheme = account.port === 993 ? "imaps" : "imap+starttls";
    const binding: SecretBinding = {
      family: familyFor(cloud, "mail", account.id, familyOfImapHost(account.host) ?? "imap"),
      service: "mail",
      secretType: "imap-password",
      user: account.user.trim().toLowerCase(),
      endpoint: canonicalizeEndpoint(`${scheme}://${account.host}:${account.port}`),
    };
    candidates.push({
      logicalId: canonicalSecretId(binding),
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
export function createDesktopSecretsPort(vaultPath: string, pimRuntime: PimRuntime | null): SecretsPort {
  return createSecretsPort({
    deviceId,
    // Metadata written before P4c is keyed by the old per-device names; the
    // candidates above are now named canonically. Migrating on read keeps the
    // two in step (the port persists the result on its next export).
    readMeta: async () =>
      (await getSettingsStore())
        .get<SecretsPortMeta>(metaKey(vaultPath))
        .then((m) => migrateSecretsMetaToCanonicalIds(m ?? null)),
    writeMeta: async (meta) => {
      const store = await getSettingsStore();
      await store.set(metaKey(vaultPath), meta);
      await store.save();
    },
    candidates: () => localCandidates(vaultPath, pimRuntime),
    // Without the PIM runtime this device does NOT know its full account
    // picture: the mail candidates are complete, the calendar ones are missing.
    // The candidate list is therefore not empty and `looksUnavailable` would not
    // fire — a CalDAV credential would be declared deleted and removed on every
    // other device. Saying so plainly suppresses tombstoning for those runs;
    // everything else (publishing and receiving secrets) keeps working. This is
    // the same answer the phone gives while its runtime boots.
    accountsReady: async () => pimRuntime !== null,
    readSlot: (slot) => credentialManager.readSecret(slot),
    writeSlot: (slot, value) => credentialManager.writeSecret(slot, value),
    removeSlot: (slot) => credentialManager.removeSecret(slot),
  });
}
