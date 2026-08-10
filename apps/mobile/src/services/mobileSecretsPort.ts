import { canonicalSecretId, canonicalizeEndpoint, type SecretBinding, type SecretsPort } from "@plainva/core";
import {
  createSecretsPort,
  familyOfCalDavUrl,
  familyOfImapHost,
  getPlatformServices,
  migrateSecretsMetaToCanonicalIds,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import { listMailAccounts, mailAccountKind, mailSecretKey } from "@plainva/ui/mail";
import { isPimRuntimeReady, listPimAccounts } from "./pim/pimService";
import { getPimCredentials, pimSecretKey, type PimStoredCredentials } from "./pim/pimCredentials";

/**
 * The phone's side of the encrypted secrets sideband (H2c).
 *
 * All the dangerous judgement — binding checks, tombstones, the refusal to
 * overwrite a local credential, the rollback — lives in the SHARED
 * `createSecretsPort`; this file only says where the phone keeps its accounts
 * and its keychain. That was the condition the plan set: half a port is worse
 * than none, and two hand-written copies of that logic would be exactly that.
 *
 * What travels: CalDAV and IMAP passwords. OAuth client registrations and
 * refresh tokens stay installation-local.
 *
 * Until this existed, an IMAP mailbox had to be signed in again on every
 * device; the bundle has always carried `imap-password`, there was simply
 * nothing on the phone to receive it.
 *
 * A candidate is named by `canonicalSecretId` (P4c), so it no longer waits for
 * the profile import to hand it a logical id. That wait was a real gap: a phone
 * that had its mailbox but not yet the profile mapping contributed NOTHING to
 * the bundle and could receive nothing either — silently, because a skipped
 * candidate leaves no trace. The name now comes from the credential itself.
 */

const metaKey = (vaultId: string) => `settingsSyncSecretMetaMobile_${vaultId}`;
const deviceKey = "settingsSyncDeviceIdMobile";

async function settingsStore() {
  return getPlatformServices().loadSettings();
}

async function deviceId(): Promise<string> {
  const store = await settingsStore();
  let value = await store.get<string>(deviceKey);
  if (!value) {
    value = crypto.randomUUID();
    await store.set(deviceKey, value);
    await store.save();
  }
  return value;
}

/** The accounts this device holds, in the shape the shared port expects. */
/** Public for logical-addressing contract tests; production consumes it below. */
export async function mobileCandidates(vaultId: string): Promise<LocalSecretCandidate[]> {
  const out: LocalSecretCandidate[] = [];

  for (const account of await listPimAccounts()) {
    const creds = await getPimCredentials(vaultId, account.id);
    const slot = pimSecretKey(vaultId, account.id);
    if (account.provider === "caldav") {
      const url = creds?.kind === "caldav" ? creds.url : typeof account.config.url === "string" ? account.config.url : "";
      const user = creds?.kind === "caldav" ? creds.user : typeof account.config.user === "string" ? account.config.user : "";
      if (!url || !user) continue;
      const binding: SecretBinding = {
        // Same fallback chain as the desktop, so the SAME account produces the
        // same binding on both platforms — otherwise no entry would ever match.
        family: familyOfCalDavUrl(url) ?? "webdav",
        service: "calendar",
        secretType: "caldav-password",
        user: user.trim().toLowerCase(),
        endpoint: canonicalizeEndpoint(url),
      };
      out.push({
        logicalId: canonicalSecretId(binding),
        slot,
        binding,
        secret: creds?.kind === "caldav" && creds.pass ? { pass: creds.pass } : null,
        apply: (secret) => ({ kind: "caldav", url, user, pass: secret.pass ?? "" } satisfies PimStoredCredentials),
      });
    }
  }

  for (const account of await listMailAccounts(vaultId)) {
    if (mailAccountKind(account) !== "imap") continue; // Microsoft = OAuth, never synced
    const slot = mailSecretKey(vaultId, account.id);
    const stored = await getPlatformServices().credentials.readSecret<{ pass?: string; refreshToken?: string }>(slot);
    const scheme = account.port === 993 ? "imaps" : "imap+starttls";
    const binding: SecretBinding = {
      family: familyOfImapHost(account.host) ?? "imap",
      service: "mail",
      secretType: "imap-password",
      user: account.user.trim().toLowerCase(),
      endpoint: canonicalizeEndpoint(`${scheme}://${account.host}:${account.port}`),
    };
    out.push({
      logicalId: canonicalSecretId(binding),
      slot,
      binding,
      secret: stored?.pass ? { pass: stored.pass } : null,
      apply: (secret) => ({ ...(stored ?? {}), pass: secret.pass ?? "" }),
    });
  }

  return out;
}

/** Mobile keychain bridge for the secrets sideband. */
export function createMobileSecretsPort(vaultId: string): SecretsPort {
  return createSecretsPort({
    deviceId,
    // The PIM runtime boots in PARALLEL with the sync worker (App.tsx starts
    // both without ordering), so a cycle can catch `listPimAccounts()` empty.
    // An empty list looks exactly like "the user deleted every account", and
    // export would answer with a tombstone each — which the other device then
    // applies by deleting a working password. Never tombstone until the runtime
    // that owns those accounts is actually up.
    accountsReady: async () => isPimRuntimeReady(),
    // See the desktop port: pre-P4c metadata is keyed by the old per-device
    // names, the candidates above by the canonical one.
    readMeta: async () =>
      migrateSecretsMetaToCanonicalIds(
        (await (await settingsStore()).get<SecretsPortMeta>(metaKey(vaultId))) ?? null,
      ),
    writeMeta: async (meta) => {
      const store = await settingsStore();
      await store.set(metaKey(vaultId), meta);
      await store.save();
    },
    candidates: () => mobileCandidates(vaultId),
    readSlot: (slot) => getPlatformServices().credentials.readSecret(slot),
    writeSlot: (slot, value) => getPlatformServices().credentials.writeSecret(slot, value),
    removeSlot: (slot) => getPlatformServices().credentials.removeSecret(slot),
  });
}
