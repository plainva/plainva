import {
  SecretPolicyError,
  assertSecretsBundleStructure,
  bindingMatches,
  bindingMatchesExceptFamily,
  canonicalSecretId,
  isLegacyLowerCaseUser,
  isOldNameEntry,
  isLegacySecretType,
  isShareableSecretType,
  canonicalizeEndpoint,
  secretBindingUser,
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
 *    land on a different server that happens to share an id. The user is
 *    compared exactly; an entry written lower-cased by a client up to 0.8.7
 *    reaches the single account it can mean, and none when two could. The provider
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
    { hash: string; entryRev: number; updatedAt: string; deviceId: string; binding: SecretBinding; tombstone?: boolean; alias?: boolean }
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
  /**
   * Accounts "Remove account" took out on this device, by their exact name
   * (`retireSecret`). The next export writes their tombstone from that act,
   * not from comparing lists — which cannot tell "gone" from "alice" beside a
   * removed "Alice", or the last account from a runtime still booting.
   */
  retired?: Record<string, SecretBinding>;
  /**
   * Tombstones seen under an account's OLD name (review 2026-11-18, O1), by id
   * with their time. Never applied — a device up to 0.8.7 cannot say which of
   * two spellings it removed — but remembered: a later value under that name
   * puts nothing into the slot of an account here.
   */
  oldNameTombstones?: Record<string, string>;
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

/**
 * The binding of a CalDAV password, built ONCE for both shells: the user
 * exactly as typed — "Alice" and "alice" may be two accounts of one server, and
 * one secret name for both put one password into the other's slot (GitHub
 * issue 174, see `canonicalSecretId`). Throws on an endpoint that cannot be
 * canonicalized, as before.
 */
export function calDavSecretBinding(family: string, url: string, user: string): SecretBinding {
  return {
    family,
    service: "calendar",
    secretType: "caldav-password",
    user: secretBindingUser(user),
    endpoint: canonicalizeEndpoint(url),
  };
}

/**
 * The binding of an IMAP password. A mailbox is one account in any case of its
 * address (`mailIdentity`), so its user stays lower-cased and its secret keeps
 * the name it always had.
 */
export function imapSecretBinding(family: string, host: string, port: number, user: string): SecretBinding {
  const scheme = port === 993 ? "imaps" : "imap+starttls";
  return {
    family,
    service: "mail",
    secretType: "imap-password",
    user: secretBindingUser(user).toLowerCase(),
    endpoint: canonicalizeEndpoint(`${scheme}://${host}:${port}`),
  };
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
  ...(source?.retired ? { retired: Object.fromEntries(Object.entries(source.retired).map(([id, binding]) => [id, { ...binding }])) } : {}),
  ...(source?.oldNameTombstones ? { oldNameTombstones: { ...source.oldNameTombstones } } : {}),
});

/**
 * "Remove account" took this account out (review 2026-11-18): its entry is
 * tombstoned by the next export, under its exact name and — where no other
 * account here can mean it — the old name a device up to 0.8.7 reads it by.
 * An account that comes back before then keeps its entry.
 */
export async function retireSecret(host: Pick<SecretsPortHost, "readMeta" | "writeMeta">, binding: SecretBinding): Promise<void> {
  await serialized(async () => {
    const meta = cloneMeta(await host.readMeta());
    meta.retired = { ...(meta.retired ?? {}), [canonicalSecretId(binding)]: { ...binding } };
    await host.writeMeta(meta);
  });
}

/**
 * Every read-modify-write of the secrets metadata — export, import and
 * `retireSecret` — runs one after the other (review 2026-11-18): a removal
 * written while an export ran was otherwise overwritten by the export's
 * older copy, and its tombstone never went out.
 */
let metaQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = metaQueue.then(run, run);
  metaQueue = next.catch(() => undefined);
  return next;
}

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

/**
 * Rewrites a shell's own bookkeeping from the old per-device names to the
 * canonical one derived from the binding (P4c).
 *
 * Called by each shell when it READS its metadata, not by the port: the port is
 * deliberately agnostic about how its host names candidates — it only ever
 * compares the names it is given. A shell that has switched to
 * `canonicalSecretId` uses this so its stored metadata follows.
 *
 * Without it the first export after the update would find no `previous` for the
 * canonical id and restart its revision at 1, while the stale ids kept being
 * carried through the tombstone loop forever. It converges either way — the
 * merge picks the higher revision — but this saves a cycle and, more
 * importantly, stops the old names from accumulating locally.
 *
 * **Tombstones are deliberately left alone.** Moving one onto the canonical id
 * would hand a deletion to a device that has not been updated yet and still
 * addresses that credential under the old name — it would apply it by removing
 * a working password. An old tombstone whose binding still matches a live
 * candidate is already ignored by the export (P4b) and simply dies out.
 *
 * Nothing is merged: when the canonical id is already taken, the current entry
 * wins and the stale one is dropped. It is the same credential by definition;
 * the surviving entry is the one a current export or import wrote.
 */
export function migrateSecretsMetaToCanonicalIds<T extends SecretsPortMeta | null>(meta: T): T {
  if (!meta) return meta;
  for (const [id, entry] of Object.entries(meta.entries)) {
    if (entry.tombstone) continue;
    if (!isShareableSecretType(entry.binding.secretType)) continue;
    const canonical = canonicalSecretId(entry.binding);
    if (canonical === id) continue;
    if (!meta.entries[canonical]) meta.entries[canonical] = entry;
    delete meta.entries[id];
    if (meta.imported[id]) {
      meta.imported[canonical] = true;
      delete meta.imported[id];
    }
  }
  return meta;
}

/**
 * The name a device up to 0.8.7 knows this account's password by, when it is
 * another than the exact one and can mean nothing else here: a calendar user
 * in capitals, with no second account of the same kind on the same server
 * whose user differs only in case. The bridge is ONE-WAY (review 2026-11-18,
 * fourth round): this name is never exported — a mirror under it undid a
 * newer password everywhere and, once a twin was gone, handed one account's
 * password to the other. An entry a device up to 0.8.7 wrote under it is read
 * for this one account, when it is newer than the exact entry or there is none,
 * and never after a tombstone for the old name. A password changed on an
 * updated device therefore reaches a device on 0.8.7 only once that device is
 * updated too (named limit, release texts F36). "Newer" compares `updatedAt`,
 * the clocks of two devices: a device on 0.8.7 whose clock runs ahead can
 * cover a password changed on an updated device, for the other devices on
 * 0.8.7 and for updated ones (named limit, review 2026-11-18). Only an entry
 * without `exactUser` is read as an old name (`isOldNameEntry`).
 */
function oldNameId(candidate: LocalSecretCandidate, candidates: readonly LocalSecretCandidate[]): string | null {
  if (candidate.binding.service !== "calendar" || isLegacyLowerCaseUser(candidate.binding)) return null;
  const twin = candidates.some(
    (other) =>
      other !== candidate &&
      other.binding.secretType === candidate.binding.secretType &&
      bindingMatchesExceptFamily(other.binding, candidate.binding, "fold"),
  );
  if (twin) return null;
  const id = canonicalSecretId({ ...candidate.binding, user: candidate.binding.user.toLowerCase() });
  return id === candidate.logicalId ? null : id;
}

export function createSecretsPort(host: SecretsPortHost): SecretsPort {
  const now = () => (host.now ? host.now() : new Date().toISOString());

  return {
    exportBundle: () => serialized(() => exportBundle()),
    importBundle: (bundle: SecretsBundle) => serialized(() => importBundle(bundle)),
  };

  async function exportBundle(): Promise<SecretsBundle> {
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
          // The user is this account's exact spelling: never an old name (O1).
          exactUser: true,
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
      // What "Remove account" took out here is tombstoned whatever the lists
      // say — it is known, not inferred (`retireSecret`).
      const tombstone = (id: string) => {
        const previous = meta.entries[id];
        if (!previous || previous.tombstone || currentIds.has(id)) return;
        const entryRev = previous.entryRev + 1;
        entries[id] = { entryRev, updatedAt: stamp, deviceId, binding: previous.binding, tombstone: true, exactUser: true };
        meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt: stamp, deviceId, tombstone: true };
      };
      for (const id of Object.keys(meta.retired ?? {})) {
        delete meta.retired![id];
        if (knownIds.has(id)) continue;
        tombstone(id);
      }
      if (meta.retired && Object.keys(meta.retired).length === 0) delete meta.retired;

      const ready = host.accountsReady ? await host.accountsReady() : true;
      const looksUnavailable = candidates.length === 0 && Object.keys(meta.entries).length > 0;
      if (ready && !looksUnavailable) {
        for (const [id, previous] of Object.entries(meta.entries)) {
          // Never turn retired Google client metadata into a tombstone. An old
          // client could interpret that tombstone by deleting its still-needed
          // local registration. S9 handles explicit quarantine/migration.
          if (!isShareableSecretType(previous.binding.secretType)) continue;
          // An old name read for an account here (`oldNameId`) is never
          // written back, not as a tombstone either.
          if (previous.alias) continue;
          if (currentIds.has(id)) continue;
          // The account is still here, only its secret is missing on THIS device.
          // Leave the remote entry untouched: the merge then carries the
          // credential back to us instead of destroying it everywhere.
          if (knownIds.has(id)) continue;
          // The same credential under a DIFFERENT name. A logical id is derived
          // from the local account id, so every device minted its own for one and
          // the same password — six of them for a single Gmail app password in
          // the maintainer's bundle (2026-08-10), five already tombstoned.
          // Tombstoning a foreign id destroys precisely the credential this
          // device still holds, merely under the other device's name for it. The
          // import side has resolved entries by binding for a while; the export
          // side has to apply the same yardstick.
          //
          // Users are compared without regard to case here, and only here: an
          // entry a device up to 0.8.7 named for a user in capitals carries
          // the user lower-cased, and the account is still on this device
          // under its exact spelling. A tombstone in doubt is never written.
          if (candidates.some((candidate) => bindingMatchesExceptFamily(previous.binding, candidate.binding, "fold"))) continue;
          const entryRev = previous.tombstone ? previous.entryRev : previous.entryRev + 1;
          const updatedAt = previous.tombstone ? previous.updatedAt : stamp;
          entries[id] = { entryRev, updatedAt, deviceId, binding: previous.binding, tombstone: true, exactUser: true };
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
  }

  async function importBundle(bundle: SecretsBundle): Promise<SecretsImportResult> {
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
        viaOldName: boolean;
      }> = [];
      const result = emptyImportResult();
      let metaDirty = false;

      const rememberEntry = (logicalId: string, entry: SecretEntry, alias = false) => {
        meta.entries[logicalId] = {
          hash: entryHash(entry),
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: entry.binding,
          tombstone: entry.tombstone,
          ...(alias ? { alias: true } : {}),
        };
        metaDirty = true;
      };

      const rememberOldNameTombstone = (logicalId: string, entry: SecretEntry) => {
        if (meta.oldNameTombstones?.[logicalId] === entry.updatedAt) return;
        meta.oldNameTombstones = { ...(meta.oldNameTombstones ?? {}), [logicalId]: entry.updatedAt };
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
        const sameType = (item: LocalSecretCandidate) => item.binding.secretType === entry.binding.secretType;
        const exactCandidate =
          (direct && sameType(direct) && bindingMatchesExceptFamily(entry.binding, direct.binding) ? direct : undefined) ??
          candidates.find((item) => sameType(item) && bindingMatches(entry.binding, item.binding)) ??
          candidates.find((item) => sameType(item) && bindingMatchesExceptFamily(entry.binding, item.binding));
        // An entry from a device up to 0.8.7 carries the user lower-cased,
        // whatever its spelling was. It still reaches the account it names
        // when exactly one account here could be meant — never one of two
        // that differ only in case, and never an account an entry with its
        // exact spelling already speaks for (that one is current; the
        // lower-cased one would put an older password back).
        // Whether this entry can be an old name is said by the entry itself —
        // no `exactUser`, so a device up to 0.8.7 wrote it — never by the
        // spelling of its user alone: "alice" is also the exact name of an
        // account of its own (review 2026-11-18, O1).
        const oldNameShaped = isOldNameEntry(entry);
        const foldMatches = oldNameShaped
          ? candidates.filter((item) => sameType(item) && bindingMatchesExceptFamily(entry.binding, item.binding, "fold"))
          : [];
        // Two accounts here that differ only in case: an entry from 0.8.7
        // cannot say which one it means, so it is read for neither. A tombstone
        // among them is remembered, not applied.
        if (foldMatches.length > 1) {
          if (entry.tombstone) rememberOldNameTombstone(logicalId, entry);
          recordImportResult(result, logicalId, "unchanged", "old-name-not-taken");
          continue;
        }
        const legacyCandidate = !exactCandidate && foldMatches.length === 1 ? foldMatches[0] : undefined;
        // ...and only as its old name, one way (`oldNameId`): never a
        // tombstone, never after a tombstone for that name was seen here, and
        // only when it is newer than the exact entry of that account.
        if (legacyCandidate) {
          const exact = Object.entries(bundle.entries).find(
            ([otherId, other]) =>
              otherId !== logicalId &&
              other.binding.secretType === entry.binding.secretType &&
              bindingMatchesExceptFamily(other.binding, legacyCandidate.binding),
          )?.[1];
          const retiredName = meta.entries[logicalId]?.tombstone === true || !!meta.oldNameTombstones?.[logicalId];
          if (entry.tombstone) rememberOldNameTombstone(logicalId, entry);
          if (entry.tombstone || retiredName || (exact && !(entry.updatedAt > exact.updatedAt))) {
            recordImportResult(result, logicalId, "unchanged", exact ? "superseded-by-exact-entry" : "old-name-not-taken");
            continue;
          }
        }
        // The exact entry of an account whose old name carries a NEWER
        // password (a device up to 0.8.7 changed it): that one is read.
        const oldName = exactCandidate ? oldNameId(exactCandidate, candidates) : null;
        const oldEntry = oldName && oldName !== logicalId ? bundle.entries[oldName] : undefined;
        if (
          oldEntry && isOldNameEntry(oldEntry) && !oldEntry.tombstone && meta.entries[oldName!]?.tombstone !== true && !meta.oldNameTombstones?.[oldName!] &&
          oldEntry.binding.secretType === entry.binding.secretType && oldEntry.updatedAt > entry.updatedAt
        ) {
          recordImportResult(result, logicalId, "unchanged", "superseded-by-later-entry");
          continue;
        }
        const candidate = exactCandidate ?? legacyCandidate;
        const viaOldName = !!candidate && candidate.logicalId !== logicalId && !exactCandidate;
        // The old name and the exact one of one account share one record of having been imported.
        const pairImported = !!meta.imported[logicalId] || (!!candidate && !!meta.imported[candidate.logicalId]);

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

        if (entry.tombstone && !pairImported) {
          rememberEntry(logicalId, entry);
          if (candidate.secret) {
            recordImportResult(result, logicalId, "rejected", "local-secret-protected");
          } else {
            recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          }
          continue;
        }
        if (!entry.tombstone && candidate.secret && !pairImported) {
          if (stableStringify(candidate.secret) !== stableStringify(entry.secret)) {
            recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
            continue;
          }
          rememberEntry(logicalId, entry, viaOldName);
          recordImportResult(result, logicalId, "unchanged", "already-current");
          continue;
        }
        operations.push({ logicalId, entry, candidate, viaOldName });
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

      for (const { logicalId, entry, candidate, viaOldName } of operations) {
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
            // Read under its old name (`oldNameId`): the account's exact name was written with it.
            if (viaOldName) meta.imported[candidate.logicalId] = true;
          }
          rememberEntry(logicalId, entry, viaOldName);
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
  }
}
