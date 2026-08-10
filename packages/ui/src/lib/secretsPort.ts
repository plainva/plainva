import {
  SecretPolicyError,
  assertSecretsBundleStructure,
  bindingMatches,
  bindingMatchesExceptFamily,
  isLegacySecretType,
  isShareableSecretType,
  stableStringify,
  type SecretBinding,
  type SecretEntry,
  type SecretImportReason,
  type SecretImportStatus,
  type SecretsBundle,
  type SecretsImportResult,
  type SecretsPort,
} from "@plainva/core";

/**
 * The keychain side of the encrypted secrets sideband, written ONCE for both
 * shells (H2c).
 *
 * This is the most dangerous code in the settings sync: it decides when a
 * credential from another device may replace one on this device, and a mistake
 * either overwrites a working password or leaks one into the wrong account. The
 * desktop had a careful ~250-line implementation of it; porting a second copy
 * to mobile would have meant maintaining that judgement twice. Instead the
 * judgement lives here and each shell supplies only what is genuinely
 * platform-specific: how to reach its keychain, its settings store, and its
 * list of accounts.
 *
 * The rules:
 *
 *  - **The complete decrypted structure is validated BEFORE the keychain is
 *    touched.** Cryptographic/structural failure rejects the whole bundle.
 *  - **A local secret is never silently overwritten.** If this device has its
 *    own value for an account it did not import, an incoming different value is
 *    rejected for that entry without blocking independent accounts.
 *  - **Bindings must match.** An entry is only ever applied to an account with
 *    the same service, secret type, user and endpoint — so a password cannot
 *    land on a different server that happens to share an id. The provider
 *    family is compared too, but a family-only difference is tolerated (see
 *    bindingMatchesExceptFamily): it is a catalog label, not an address.
 *  - **An account this device does not know yet is SKIPPED, not fatal.** That is
 *    the normal state of a new device, not a policy violation; refusing the whole
 *    bundle for it meant a fresh device received nothing at all. The skipped ids
 *    are reported so the shell can say so.
 *  - **Deletions are tombstones, and only remove what WE imported.** A device's
 *    own, never-imported credential is not deleted by someone else's tombstone.
 *  - **Each write group has a snapshot.** A slot failure rolls back that group;
 *    a metadata-commit failure rolls back every successful group in the run.
 */

/** Local account this device could contribute a secret for, or receive one into. */
export interface LocalSecretCandidate {
  /** Stable id across devices (the account id, or its mapped logical id). */
  logicalId: string;
  /** Keychain slot name on THIS device. */
  slot: string;
  binding: SecretBinding;
  /** The shareable payload this device holds, or null when it has none. */
  secret: Record<string, string> | null;
  /** Builds the value to store from an incoming payload (keeps device-local
   *  fields such as OAuth refresh tokens intact). */
  apply(secret: Record<string, string>): unknown;
}

export interface SecretsPortMeta {
  entries: Record<
    string,
    { hash: string; entryRev: number; updatedAt: string; deviceId: string; binding: SecretBinding; tombstone?: boolean }
  >;
  /** Entries written BY an import — only these may be removed by a tombstone. */
  imported: Record<string, boolean>;
  /**
   * Redacted evidence that a retired credential was observed. It deliberately
   * excludes binding values, publisher ids and credential payloads.
   */
  quarantine: Record<
    string,
    {
      reason: "legacy-secret-type";
      secretType: string;
      entryRev: number;
      updatedAt: string;
    }
  >;
}

/** What a shell must provide; everything else is decided above. */
export interface SecretsPortHost {
  deviceId(): Promise<string>;
  readMeta(): Promise<SecretsPortMeta | null>;
  writeMeta(meta: SecretsPortMeta): Promise<void>;
  /** The device's accounts, with the secret each currently holds. */
  candidates(): Promise<LocalSecretCandidate[]>;
  /**
   * Whether `candidates()` currently reflects the FULL truth of this device.
   *
   * A mobile account list is served by a runtime that boots in parallel with the
   * sync worker, so a cycle can catch it empty. Without this, an empty list is
   * indistinguishable from "the user deleted everything" and export would write
   * a tombstone per account — which the other device then applies by DELETING a
   * working password. Answering false suppresses tombstoning for that run;
   * everything else still works.
   */
  accountsReady?(): Promise<boolean>;
  readSlot(slot: string): Promise<unknown>;
  writeSlot(slot: string, value: unknown): Promise<void>;
  removeSlot(slot: string): Promise<void>;
  /** Injectable for tests; defaults to the wall clock. */
  now?(): string;
}

const emptyMeta = (): SecretsPortMeta => ({ entries: {}, imported: {}, quarantine: {} });

const cloneMeta = (source: SecretsPortMeta | null): SecretsPortMeta => ({
  entries: Object.fromEntries(
    Object.entries(source?.entries ?? {}).map(([id, entry]) => [
      id,
      { ...entry, binding: { ...entry.binding } },
    ]),
  ),
  imported: { ...(source?.imported ?? {}) },
  quarantine: Object.fromEntries(
    Object.entries(source?.quarantine ?? {}).map(([id, entry]) => [id, { ...entry }]),
  ),
});

const emptyImportResult = (): SecretsImportResult => ({
  entries: [],
  imported: [],
  unchanged: [],
  rejected: [],
  stale: [],
  errors: [],
  unknownAccounts: [],
  legacyEntries: [],
});

function recordImportResult(
  result: SecretsImportResult,
  logicalId: string,
  status: SecretImportStatus,
  reason?: SecretImportReason,
): void {
  result.entries.push({ logicalId, status, ...(reason ? { reason } : {}) });
  if (status === "error") result.errors.push(logicalId);
  else result[status].push(logicalId);
}

function compareEntryVersion(
  incoming: SecretEntry,
  previous: Pick<SecretEntry, "entryRev" | "updatedAt" | "deviceId">,
): number {
  if (incoming.entryRev !== previous.entryRev) return incoming.entryRev > previous.entryRev ? 1 : -1;
  if (incoming.updatedAt !== previous.updatedAt) return incoming.updatedAt > previous.updatedAt ? 1 : -1;
  if (incoming.deviceId !== previous.deviceId) return incoming.deviceId > previous.deviceId ? 1 : -1;
  return 0;
}

const entryHash = (entry: SecretEntry): string =>
  entry.tombstone ? "" : stableStringify({ binding: entry.binding, secret: entry.secret });

export function createSecretsPort(host: SecretsPortHost): SecretsPort {
  const now = () => (host.now ? host.now() : new Date().toISOString());

  return {
    async exportBundle(): Promise<SecretsBundle> {
      const deviceId = await host.deviceId();
      const stamp = now();
      const meta = (await host.readMeta()) ?? emptyMeta();
      // OAuth registrations may still be exposed by an older shell adapter,
      // but the shared port is the final policy boundary for every platform.
      const candidates = (await host.candidates()).filter((candidate) =>
        isShareableSecretType(candidate.binding.secretType)
      );
      const currentIds = new Set(candidates.filter((c) => c.secret).map((c) => c.logicalId));
      // Every account this device KNOWS, with or without a stored secret.
      //
      // "Account here, slot empty" is not a removal — it is the ordinary state of
      // a device that has not signed in yet: the account arrives with the
      // settings profile, the credential deliberately does not (see
      // `replaceMailAccounts`). Publishing a tombstone for it deleted a WORKING
      // password on every other device. Reported 2026-08-10: five tombstones for
      // one Gmail app password across three devices, one at entryRev 214 from the
      // resulting ping-pong. Only an account that is GONE may be tombstoned.
      const knownIds = new Set(candidates.map((c) => c.logicalId));
      const entries: Record<string, SecretEntry> = {};

      for (const candidate of candidates) {
        if (!candidate.secret) continue;
        const hash = stableStringify({ binding: candidate.binding, secret: candidate.secret });
        const previous = meta.entries[candidate.logicalId];
        // The revision only moves when the secret actually changed — otherwise
        // two devices would ping-pong revisions on every cycle.
        const changed = !previous || previous.hash !== hash || previous.tombstone;
        const entryRev = changed ? (previous?.entryRev ?? 0) + 1 : previous.entryRev;
        const updatedAt = changed ? stamp : previous.updatedAt;
        entries[candidate.logicalId] = {
          entryRev,
          updatedAt,
          deviceId: changed ? deviceId : previous.deviceId,
          binding: candidate.binding,
          secret: candidate.secret,
        };
        meta.entries[candidate.logicalId] = {
          hash,
          entryRev,
          updatedAt,
          deviceId: entries[candidate.logicalId].deviceId,
          binding: candidate.binding,
        };
      }

      // An account that vanished here becomes a tombstone, so the other device
      // learns it was removed rather than resurrecting it on the next cycle.
      //
      // But a tombstone DELETES a credential on every other device, so it must
      // never be guesswork. Two guards: the host says its account list is ready,
      // and a list that came back completely empty while we know of accounts is
      // treated as "not ready" regardless — that shape is a runtime that has not
      // booted yet, and the cost of being wrong is a destroyed password.
      const ready = host.accountsReady ? await host.accountsReady() : true;
      const looksUnavailable = candidates.length === 0 && Object.keys(meta.entries).length > 0;
      if (ready && !looksUnavailable) {
        for (const [id, previous] of Object.entries(meta.entries)) {
          // Never turn retired Google client metadata into a tombstone. An old
          // client could interpret that tombstone by deleting its still-needed
          // local registration. S9 handles explicit quarantine/migration.
          if (!isShareableSecretType(previous.binding.secretType)) continue;
          if (currentIds.has(id)) continue;
          // The account is still here, only its secret is missing on THIS device.
          // Leave the remote entry untouched: the merge then carries the
          // credential back to us instead of destroying it everywhere.
          if (knownIds.has(id)) continue;
          const entryRev = previous.tombstone ? previous.entryRev : previous.entryRev + 1;
          const updatedAt = previous.tombstone ? previous.updatedAt : stamp;
          entries[id] = { entryRev, updatedAt, deviceId, binding: previous.binding, tombstone: true };
          meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt, deviceId, tombstone: true };
        }
      } else {
        // Re-publish what we still know unchanged, so this cycle neither deletes
        // nor resurrects anything while the device is still coming up.
        for (const [id, previous] of Object.entries(meta.entries)) {
          if (currentIds.has(id) || entries[id]) continue;
          if (previous.tombstone) {
            entries[id] = { entryRev: previous.entryRev, updatedAt: previous.updatedAt, deviceId: previous.deviceId, binding: previous.binding, tombstone: true };
          }
        }
      }

      await host.writeMeta(meta);
      return {
        format: "plainva-secrets",
        version: 1,
        bundleRev: Math.max(0, ...Object.values(entries).map((e) => e.entryRev)),
        updatedAt: stamp,
        entries,
      };
    },

    async importBundle(bundle: SecretsBundle): Promise<SecretsImportResult> {
      // Fatal boundary: validate the complete decrypted document before reading
      // candidates or touching metadata/keychain state.
      assertSecretsBundleStructure(bundle);

      const originalMeta = await host.readMeta();
      const meta = cloneMeta(originalMeta);
      const candidates = await host.candidates();
      const byId = new Map(candidates.map((candidate) => [candidate.logicalId, candidate]));
      const operations: Array<{
        logicalId: string;
        entry: SecretEntry;
        candidate: LocalSecretCandidate;
      }> = [];
      const result = emptyImportResult();
      let metaDirty = false;

      const rememberEntry = (logicalId: string, entry: SecretEntry) => {
        meta.entries[logicalId] = {
          hash: entryHash(entry),
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: entry.binding,
          tombstone: entry.tombstone,
        };
        metaDirty = true;
      };

      // Isolate policy outcomes and build safe write groups. No write can
      // precede a later malformed entry because the full structure is already
      // validated above.
      for (const [logicalId, entry] of Object.entries(bundle.entries)) {
        if (isLegacySecretType(entry.binding.secretType)) {
          const quarantined = {
            reason: "legacy-secret-type" as const,
            secretType: entry.binding.secretType,
            entryRev: entry.entryRev,
            updatedAt: entry.updatedAt,
          };
          if (stableStringify(meta.quarantine[logicalId]) !== stableStringify(quarantined)) {
            meta.quarantine[logicalId] = quarantined;
            metaDirty = true;
          }
          result.legacyEntries.push(logicalId);
          recordImportResult(result, logicalId, "rejected", "legacy-secret-type");
          continue;
        }
        if (!isShareableSecretType(entry.binding.secretType)) {
          recordImportResult(result, logicalId, "rejected", "unsupported-secret-type");
          continue;
        }

        const previous = meta.entries[logicalId];
        if (previous) {
          const order = compareEntryVersion(entry, previous);
          if (order < 0) {
            recordImportResult(result, logicalId, "stale", "older-entry");
            continue;
          }
          if (order === 0) {
            if (
              previous.hash === entryHash(entry) &&
              Boolean(previous.tombstone) === Boolean(entry.tombstone)
            ) {
              recordImportResult(result, logicalId, "unchanged", "already-current");
            } else {
              recordImportResult(result, logicalId, "rejected", "version-collision");
            }
            continue;
          }
        }

        // An id match is never sufficient by itself: type and endpoint binding
        // must still agree. Family alone may differ because it is a catalog
        // label rather than a credential destination.
        const direct = byId.get(logicalId);
        const candidate =
          (direct &&
          direct.binding.secretType === entry.binding.secretType &&
          bindingMatchesExceptFamily(entry.binding, direct.binding)
            ? direct
            : undefined) ??
          candidates.find(
            (item) =>
              item.binding.secretType === entry.binding.secretType &&
              bindingMatches(entry.binding, item.binding),
          ) ??
          candidates.find(
            (item) =>
              item.binding.secretType === entry.binding.secretType &&
              bindingMatchesExceptFamily(entry.binding, item.binding),
          );

        if (!candidate && entry.tombstone) {
          rememberEntry(logicalId, entry);
          delete meta.imported[logicalId];
          recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          continue;
        }
        if (!candidate) {
          result.unknownAccounts.push(logicalId);
          recordImportResult(
            result,
            logicalId,
            "rejected",
            direct ? "binding-mismatch" : "unknown-account",
          );
          continue;
        }

        if (entry.tombstone && !meta.imported[logicalId]) {
          rememberEntry(logicalId, entry);
          if (candidate.secret) {
            recordImportResult(result, logicalId, "rejected", "local-secret-protected");
          } else {
            recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          }
          continue;
        }
        if (!entry.tombstone && candidate.secret && !meta.imported[logicalId]) {
          if (stableStringify(candidate.secret) !== stableStringify(entry.secret)) {
            recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
            continue;
          }
          rememberEntry(logicalId, entry);
          recordImportResult(result, logicalId, "unchanged", "already-current");
          continue;
        }
        operations.push({ logicalId, entry, candidate });
      }

      // Apply each independent slot group against its own snapshot. The first
      // snapshot per slot is retained so a metadata failure can roll back every
      // successful group as one transaction.
      const initialSnapshots = new Map<string, unknown>();
      const successfulSlots = new Set<string>();
      const restoreSlot = async (slot: string, previous: unknown) => {
        if (previous == null) await host.removeSlot(slot);
        else await host.writeSlot(slot, previous);
      };

      for (const { logicalId, entry, candidate } of operations) {
        let previous: unknown;
        try {
          previous = await host.readSlot(candidate.slot);
        } catch {
          recordImportResult(result, logicalId, "error", "slot-read-failed");
          continue;
        }
        if (!initialSnapshots.has(candidate.slot)) {
          initialSnapshots.set(candidate.slot, previous);
        }

        try {
          if (entry.tombstone) {
            await host.removeSlot(candidate.slot);
            delete meta.imported[logicalId];
          } else {
            await host.writeSlot(candidate.slot, candidate.apply(entry.secret!));
            meta.imported[logicalId] = true;
          }
          rememberEntry(logicalId, entry);
          successfulSlots.add(candidate.slot);
          recordImportResult(result, logicalId, "imported");
        } catch {
          try {
            await restoreSlot(candidate.slot, previous);
          } catch {
            throw new SecretPolicyError("secret slot rollback failed");
          }
          recordImportResult(result, logicalId, "error", "slot-write-failed");
        }
      }

      if (!metaDirty) return result;

      try {
        await host.writeMeta(meta);
      } catch {
        let rollbackFailed = false;
        for (const slot of [...successfulSlots].reverse()) {
          try {
            await restoreSlot(slot, initialSnapshots.get(slot));
          } catch {
            rollbackFailed = true;
          }
        }
        throw new SecretPolicyError(
          rollbackFailed
            ? "secret metadata write and credential rollback failed"
            : "secret metadata write failed; credential writes rolled back",
        );
      }
      return result;
    },
  };
}
