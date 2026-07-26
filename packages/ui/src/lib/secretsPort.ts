import {
  SecretPolicyError,
  bindingMatches,
  stableStringify,
  type SecretBinding,
  type SecretEntry,
  type SecretsBundle,
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
 * The rules, unchanged from the desktop original:
 *
 *  - **Every entry is validated BEFORE the keychain is touched.** A single bad
 *    entry aborts the whole import; there is no half-applied bundle.
 *  - **A local secret is never silently overwritten.** If this device has its
 *    own value for an account it did not import, an incoming different value is
 *    a conflict and raises rather than replacing it.
 *  - **Bindings must match.** An entry is only ever applied to an account with
 *    the same family, service, secret type, user and endpoint — so a password
 *    cannot land on a different server that happens to share an id.
 *  - **Deletions are tombstones, and only remove what WE imported.** A device's
 *    own, never-imported credential is not deleted by someone else's tombstone.
 *  - **Any failure rolls back** every slot already written in that run.
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
}

/** What a shell must provide; everything else is decided above. */
export interface SecretsPortHost {
  deviceId(): Promise<string>;
  readMeta(): Promise<SecretsPortMeta | null>;
  writeMeta(meta: SecretsPortMeta): Promise<void>;
  /** The device's accounts, with the secret each currently holds. */
  candidates(): Promise<LocalSecretCandidate[]>;
  readSlot(slot: string): Promise<unknown>;
  writeSlot(slot: string, value: unknown): Promise<void>;
  removeSlot(slot: string): Promise<void>;
  /** Injectable for tests; defaults to the wall clock. */
  now?(): string;
}

const emptyMeta = (): SecretsPortMeta => ({ entries: {}, imported: {} });

export function createSecretsPort(host: SecretsPortHost): SecretsPort {
  const now = () => (host.now ? host.now() : new Date().toISOString());

  return {
    async exportBundle(): Promise<SecretsBundle> {
      const deviceId = await host.deviceId();
      const stamp = now();
      const meta = (await host.readMeta()) ?? emptyMeta();
      const candidates = await host.candidates();
      const currentIds = new Set(candidates.filter((c) => c.secret).map((c) => c.logicalId));
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
      for (const [id, previous] of Object.entries(meta.entries)) {
        if (currentIds.has(id)) continue;
        const entryRev = previous.tombstone ? previous.entryRev : previous.entryRev + 1;
        const updatedAt = previous.tombstone ? previous.updatedAt : stamp;
        entries[id] = { entryRev, updatedAt, deviceId, binding: previous.binding, tombstone: true };
        meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt, deviceId, tombstone: true };
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

    async importBundle(bundle: SecretsBundle): Promise<void> {
      const meta = (await host.readMeta()) ?? emptyMeta();
      const candidates = await host.candidates();
      const byId = new Map(candidates.map((c) => [c.logicalId, c]));
      const operations: Array<{ entry: SecretEntry; candidate: LocalSecretCandidate }> = [];

      // Pass one: validate EVERYTHING. Nothing is written until this loop ends
      // without throwing — a bundle is applied whole or not at all.
      for (const [logicalId, entry] of Object.entries(bundle.entries)) {
        const candidate = byId.get(logicalId) ?? candidates.find((c) => bindingMatches(entry.binding, c.binding));
        if (!candidate && entry.tombstone) {
          // Nothing here to delete; remember the tombstone so this device does
          // not re-publish the account if it ever sees it again.
          meta.entries[logicalId] = {
            hash: "",
            entryRev: entry.entryRev,
            updatedAt: entry.updatedAt,
            deviceId: entry.deviceId,
            binding: entry.binding,
            tombstone: true,
          };
          delete meta.imported[logicalId];
          continue;
        }
        if (!candidate || entry.binding.secretType !== candidate.binding.secretType || !bindingMatches(entry.binding, candidate.binding)) {
          throw new SecretPolicyError(`no matching local account metadata for ${logicalId}`);
        }
        if (!entry.tombstone && !entry.secret) throw new SecretPolicyError(`missing secret payload for ${logicalId}`);
        if (!entry.tombstone && candidate.secret && !meta.imported[logicalId]) {
          // This device has its OWN value here. Replacing it would destroy a
          // credential nobody asked us to change.
          if (stableStringify(candidate.secret) !== stableStringify(entry.secret)) {
            throw new SecretPolicyError(`local secret conflict for ${logicalId}; local credentials were not overwritten`);
          }
        }
        operations.push({ entry, candidate });
      }

      // Pass two: apply, remembering the previous value of every slot touched.
      const snapshots = new Map<string, unknown>();
      const changed: string[] = [];
      try {
        for (const { entry, candidate } of operations) {
          if (!snapshots.has(candidate.slot)) snapshots.set(candidate.slot, await host.readSlot(candidate.slot));
          if (entry.tombstone) {
            if (meta.imported[candidate.logicalId]) {
              await host.removeSlot(candidate.slot);
              changed.push(candidate.slot);
            }
            delete meta.imported[candidate.logicalId];
          } else {
            await host.writeSlot(candidate.slot, candidate.apply(entry.secret!));
            meta.imported[candidate.logicalId] = true;
            changed.push(candidate.slot);
          }
          const hash = entry.tombstone ? "" : stableStringify({ binding: entry.binding, secret: entry.secret });
          meta.entries[candidate.logicalId] = {
            hash,
            entryRev: entry.entryRev,
            updatedAt: entry.updatedAt,
            deviceId: entry.deviceId,
            binding: entry.binding,
            tombstone: entry.tombstone,
          };
        }
        await host.writeMeta(meta);
      } catch (error) {
        for (const slot of changed.reverse()) {
          const previous = snapshots.get(slot);
          if (previous == null) await host.removeSlot(slot).catch(() => undefined);
          else await host.writeSlot(slot, previous).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}
