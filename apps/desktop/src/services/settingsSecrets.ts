import {
  SecretPolicyError,
  bindingMatches,
  canonicalizeEndpoint,
  stableStringify,
  type SecretBinding,
  type SecretEntry,
  type SecretsBundle,
  type SecretsPort,
} from "@plainva/core";
import { familyOfCalDavUrl, familyOfImapHost, type CloudAccountRecord } from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { loadCloudAccounts } from "./cloudAccounts";
import { getSettingsStore } from "./settingsStore";
import { listMailAccounts, mailAccountKind, mailSecretKey } from "./mail/mailAccounts";
import { getPimCredentials, pimSecretKey, type PimStoredCredentials } from "./pim/pimCredentials";
import type { PimRuntime } from "./pim/pimRuntime";

interface SecretMeta {
  entries: Record<string, { hash: string; entryRev: number; updatedAt: string; deviceId: string; binding: SecretBinding; tombstone?: boolean }>;
  /** Entries written by this profile may be updated/deleted by later imports. */
  imported: Record<string, boolean>;
}

interface LocalCandidate {
  logicalId: string;
  slot: string;
  binding: SecretBinding;
  secret: Record<string, string> | null;
  currentStored: unknown;
  apply(secret: Record<string, string>): unknown;
}

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
  const map = (await store.get<{ pimLocalToLogical?: Record<string, string>; mailLocalToLogical?: Record<string, string> }>(accountMapKey(vaultPath))) ?? {};
  return { deviceId, map: { pimLocalToLogical: map.pimLocalToLogical ?? {}, mailLocalToLogical: map.mailLocalToLogical ?? {} } };
}

function familyFor(records: CloudAccountRecord[], service: "calendar" | "mail", localId: string, fallback: string): string {
  const record = records.find((r) =>
    service === "calendar" ? r.services.calendar?.pimAccountId === localId : r.services.mail?.mailAccountId === localId
  );
  return record?.family ?? fallback;
}

async function localCandidates(vaultPath: string, pimRuntime: PimRuntime): Promise<LocalCandidate[]> {
  const [map, cloud, pimAccounts, mailAccounts] = await Promise.all([
    deviceIdAndMap(vaultPath).then((x) => x.map),
    loadCloudAccounts(vaultPath),
    pimRuntime.cache.listAccounts(),
    listMailAccounts(vaultPath),
  ]);
  const candidates: LocalCandidate[] = [];

  for (const account of pimAccounts) {
    const creds = await getPimCredentials(vaultPath, account.id);
    const logicalId = map.pimLocalToLogical[account.id] ?? account.id;
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
        slot: pimSecretKey(vaultPath, account.id),
        binding,
        secret: creds?.kind === "caldav" && creds.pass ? { pass: creds.pass } : null,
        currentStored: creds,
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
        slot: pimSecretKey(vaultPath, account.id),
        binding,
        secret: creds?.kind === "google" && creds.clientSecret ? { clientId: creds.clientId, clientSecret: creds.clientSecret } : null,
        currentStored: creds,
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
    const logicalId = map.mailLocalToLogical[account.id] ?? account.id;
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
      slot: mailSecretKey(vaultPath, account.id),
      binding,
      secret: stored?.pass ? { pass: stored.pass } : null,
      currentStored: stored,
      apply: (secret) => ({ ...(stored ?? {}), pass: secret.pass ?? "" }),
    });
  }
  return candidates;
}

/** Desktop OS-keychain bridge for the encrypted secrets sideband. */
export function createDesktopSecretsPort(vaultPath: string, pimRuntime: PimRuntime): SecretsPort {
  return {
    async exportBundle(): Promise<SecretsBundle> {
      const store = await getSettingsStore();
      const { deviceId } = await deviceIdAndMap(vaultPath);
      const now = new Date().toISOString();
      const meta = (await store.get<SecretMeta>(metaKey(vaultPath))) ?? { entries: {}, imported: {} };
      const candidates = await localCandidates(vaultPath, pimRuntime);
      const currentIds = new Set(candidates.filter((c) => c.secret).map((c) => c.logicalId));
      const entries: Record<string, SecretEntry> = {};

      for (const candidate of candidates) {
        if (!candidate.secret) continue;
        const hash = stableStringify({ binding: candidate.binding, secret: candidate.secret });
        const previous = meta.entries[candidate.logicalId];
        const changed = !previous || previous.hash !== hash || previous.tombstone;
        const entryRev = changed ? (previous?.entryRev ?? 0) + 1 : previous.entryRev;
        const updatedAt = changed ? now : previous.updatedAt;
        entries[candidate.logicalId] = { entryRev, updatedAt, deviceId: changed ? deviceId : previous.deviceId, binding: candidate.binding, secret: candidate.secret };
        meta.entries[candidate.logicalId] = { hash, entryRev, updatedAt, deviceId: entries[candidate.logicalId].deviceId, binding: candidate.binding };
      }
      for (const [id, previous] of Object.entries(meta.entries)) {
        if (currentIds.has(id)) continue;
        const entryRev = previous.tombstone ? previous.entryRev : previous.entryRev + 1;
        const updatedAt = previous.tombstone ? previous.updatedAt : now;
        entries[id] = { entryRev, updatedAt, deviceId, binding: previous.binding, tombstone: true };
        meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt, deviceId, tombstone: true };
      }
      await store.set(metaKey(vaultPath), meta);
      await store.save();
      return { format: "plainva-secrets", version: 1, bundleRev: Math.max(0, ...Object.values(entries).map((e) => e.entryRev)), updatedAt: now, entries };
    },

    async importBundle(bundle: SecretsBundle): Promise<void> {
      const store = await getSettingsStore();
      const meta = (await store.get<SecretMeta>(metaKey(vaultPath))) ?? { entries: {}, imported: {} };
      const candidates = await localCandidates(vaultPath, pimRuntime);
      const byId = new Map(candidates.map((c) => [c.logicalId, c]));
      const operations: Array<{ entry: SecretEntry; candidate: LocalCandidate }> = [];

      // Validate every entry and every conflict before touching the keychain.
      for (const [logicalId, entry] of Object.entries(bundle.entries)) {
        const candidate = byId.get(logicalId) ?? candidates.find((c) => bindingMatches(entry.binding, c.binding));
        if (!candidate && entry.tombstone) {
          meta.entries[logicalId] = { hash: "", entryRev: entry.entryRev, updatedAt: entry.updatedAt, deviceId: entry.deviceId, binding: entry.binding, tombstone: true };
          delete meta.imported[logicalId];
          continue;
        }
        if (!candidate || entry.binding.secretType !== candidate.binding.secretType || !bindingMatches(entry.binding, candidate.binding)) {
          throw new SecretPolicyError(`no matching local account metadata for ${logicalId}`);
        }
        if (!entry.tombstone && !entry.secret) throw new SecretPolicyError(`missing secret payload for ${logicalId}`);
        if (!entry.tombstone && candidate.secret && !meta.imported[logicalId]) {
          const localShareable = candidate.secret;
          if (stableStringify(localShareable) !== stableStringify(entry.secret)) {
            throw new SecretPolicyError(`local secret conflict for ${logicalId}; local credentials were not overwritten`);
          }
        }
        operations.push({ entry, candidate });
      }

      const snapshots = new Map<string, unknown>();
      const changed: string[] = [];
      try {
        for (const { entry, candidate } of operations) {
          if (!snapshots.has(candidate.slot)) snapshots.set(candidate.slot, await credentialManager.readSecret(candidate.slot));
          if (entry.tombstone) {
            if (meta.imported[candidate.logicalId]) {
              await credentialManager.removeSecret(candidate.slot);
              changed.push(candidate.slot);
            }
            delete meta.imported[candidate.logicalId];
          } else {
            await credentialManager.writeSecret(candidate.slot, candidate.apply(entry.secret!));
            meta.imported[candidate.logicalId] = true;
            changed.push(candidate.slot);
          }
          const hash = entry.tombstone ? "" : stableStringify({ binding: entry.binding, secret: entry.secret });
          meta.entries[candidate.logicalId] = { hash, entryRev: entry.entryRev, updatedAt: entry.updatedAt, deviceId: entry.deviceId, binding: entry.binding, tombstone: entry.tombstone };
        }
        await store.set(metaKey(vaultPath), meta);
        await store.save();
      } catch (error) {
        for (const slot of changed.reverse()) {
          const previous = snapshots.get(slot);
          if (previous == null) await credentialManager.removeSecret(slot).catch(() => undefined);
          else await credentialManager.writeSecret(slot, previous).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}
