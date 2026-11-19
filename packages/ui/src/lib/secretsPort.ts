import {
  SecretPolicyError,
  assertSecretsBundleStructure,
  bindingMatches,
  bindingMatchesExceptFamily,
  canonicalSecretId,
  bridgeSecretTypeOf,
  currentSecretTypeOf,
  isBridgeSecretType,
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
import { holdsSecretsMarks, isSecretsMark, sealSecretsMeta, secretsMarker, type SecretsMarker } from "./secretsMark";
import { logDiagnosticCounted } from "../services/diagnosticsLog";

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
 *    compared exactly; an entry of a client up to 0.8.7 (an old type, the user
 *    lower-cased) reaches the single account it can mean, and none when two
 *    could. The provider
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
    {
      hash: string;
      entryRev: number;
      updatedAt: string;
      deviceId: string;
      binding: SecretBinding;
      tombstone?: boolean;
      alias?: boolean;
      /**
       * Knowledge lost with the key (`ownsMark`, round nine): the mark of what
       * the slot held when the shared document disagreed with it, and the
       * revision seen there. The slot stays local until it is restored from the
       * document or a password is typed here again.
       */
      held?: string;
      heldRev?: number;
    }
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
  /**
   * Old names this device closed when "Remove account" took the account out
   * (`closeOldName`), by id with the time. A value a device up to 0.8.7 writes
   * under one later reaches no other account here. The lock is the removed
   * account's: it ends when that same account is on this device again
   * (review 2026-11-18, round seven).
   */
  closedOldNames?: Record<string, string>;
  /**
   * The document, accounts and slots the last import took with nothing left
   * open, as a mark (`settledKey`). The same again is settled: nothing is
   * written and nothing reported (round seven).
   */
  settled?: string;
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
  /** The key of the marks, telling "not there" (null) from "no answer" (throws) (`secretsMark.ts`). */
  readMarkKey?(): Promise<unknown>;
  /** Whether any record on this device, of any vault, holds marks of a key (`secretsMark.ts`). */
  marksOnDevice?(): Promise<boolean>;
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
    secretType: "caldav-password-2",
    user: secretBindingUser(user),
    endpoint: canonicalizeEndpoint(url),
  };
}

/**
 * The binding of an IMAP password. A mailbox is one account in any case of its
 * address (`mailIdentity`), so its user stays lower-cased.
 */
export function imapSecretBinding(family: string, host: string, port: number, user: string): SecretBinding {
  const scheme = port === 993 ? "imaps" : "imap+starttls";
  return {
    family,
    service: "mail",
    secretType: "imap-password-2",
    user: secretBindingUser(user).toLowerCase(),
    endpoint: canonicalizeEndpoint(`${scheme}://${host}:${port}`),
  };
}

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
  ...(source?.closedOldNames ? { closedOldNames: { ...source.closedOldNames } } : {}),
  ...(source?.settled ? { settled: source.settled } : {}),
});

/**
 * "Remove account" took this account out (review 2026-11-18): its entry is
 * tombstoned by the next export, under its name in the current type. Its old
 * name, under which a device up to 0.8.7 may still hold it, is never written.
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

/**
 * The start of the app puts the sealing of the marks (`secretsMark.ts`,
 * `sealSecretsMetaInStore`) into the same line as every export and import,
 * first (review 2026-11-18, round nine): called before any vault opens, no
 * secrets round begins before it and none runs while it reads and writes the
 * store. `run` must not call `serialized` itself.
 */
export function sealSecretsAtStart<T>(run: () => Promise<T>): Promise<T> {
  return serialized(run);
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

/**
 * The mark of a binding and its secret (`secretsMark.ts`): what this file
 * keeps to tell an unchanged password from a changed one, never the password.
 */
const pairMark = (mark: SecretsMarker, binding: SecretBinding, secret: unknown): Promise<string> =>
  mark(stableStringify({ binding, secret }));

const entryHash = async (mark: SecretsMarker, entry: SecretEntry): Promise<string> =>
  entry.tombstone ? "" : pairMark(mark, entry.binding, entry.secret);

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
    // The old types too: what a device up to 0.8.7 knew, under the name that
    // version gives it, so `carryOldKnowledge` finds it after the update.
    if (!isShareableSecretType(entry.binding.secretType) && !isBridgeSecretType(entry.binding.secretType)) continue;
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
 * The name a device up to 0.8.7 knows this account's password by: the old
 * type, the user lower-cased (`BRIDGE_SECRET_TYPES`) — unless a second account
 * of the same kind on the same server has a user that differs only in case;
 * then that name can mean either and is read for neither. The bridge is
 * ONE-WAY (review 2026-11-18, fourth and sixth round): this name is never
 * written — a mirror under it undid a newer password everywhere and, once a
 * twin was gone, handed one account's password to the other. An entry a device
 * up to 0.8.7 wrote under it is read for this one account, when it is newer
 * than the entry in the current type or there is none, and never after a
 * tombstone for the old name. A password changed on an updated device does not
 * reach a device on 0.8.7 (named limit, release texts). "Newer" compares
 * `updatedAt`, the clocks of two devices: a device on 0.8.7 whose clock runs
 * ahead can cover a password changed on an updated device, for the other
 * devices on 0.8.7 and for updated ones (named limit, review 2026-11-18).
 */
function oldNameId(candidate: LocalSecretCandidate, candidates: readonly LocalSecretCandidate[]): string | null {
  if (!isShareableSecretType(candidate.binding.secretType)) return null;
  const twin = candidates.some(
    (other) =>
      other !== candidate &&
      other.binding.secretType === candidate.binding.secretType &&
      bindingMatchesExceptFamily(other.binding, candidate.binding, "fold"),
  );
  if (twin) return null;
  return bridgeIdOf(candidate.binding);
}

/**
 * The move into the current type is no change (review 2026-11-18, round
 * seven). What this device knew about an account's password under its old
 * name — the revision, time and device of that entry, whether it came in
 * through the sync — holds for the account's name in the current type, once,
 * when that name has no record here yet. The entry the device then publishes
 * in the current place carries the order of the knowledge it comes from, never
 * the time of the update, so a newer entry in the old place still wins against
 * an older password moved here; and a device that received its password
 * follows a change made elsewhere as before the update. Twins carry nothing:
 * their old name means neither (`oldNameId`). The old record stays, for the
 * entries a device on 0.8.7 keeps writing under that name.
 */
async function carryOldKnowledge(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[], mark: SecretsMarker): Promise<boolean> {
  let carried = false;
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType) || meta.entries[candidate.logicalId]) continue;
    const old = oldNameId(candidate, candidates);
    const known = old ? meta.entries[old] : undefined;
    if (!old || !known || known.tombstone || known.alias || !isBridgeSecretType(known.binding.secretType)) continue;
    // A record of a lost key is no knowledge to carry (round eleven).
    if (isLostMark(mark, known.hash)) continue;
    // What this device knew about an account it removed is no knowledge
    // about another one under the same old name (round eight, O1): a closed
    // old name, a tombstone seen under it, or a removal still to be written
    // stops the move.
    if (meta.closedOldNames?.[old] !== undefined || meta.oldNameTombstones?.[old] !== undefined) continue;
    if (Object.values(meta.retired ?? {}).some((binding) => bridgeIdOf(binding) === old)) continue;
    meta.entries[candidate.logicalId] = {
      hash: await movedHash(mark, known, candidate),
      entryRev: known.entryRev,
      updatedAt: known.updatedAt,
      deviceId: known.deviceId,
      binding: candidate.binding,
    };
    if (meta.imported[old]) meta.imported[candidate.logicalId] = true;
    carried = true;
  }
  return carried;
}

/**
 * The mark of a moved record under the current binding. The secret comes from
 * the slot, never from a mark (F67): when the slot holds what the old record
 * names, the same password under the current binding; when it holds another,
 * a mark that matches no pair, so the next export sees a change made here;
 * with an empty slot, the mark of no secret, so a password typed later is a
 * change (round nine). A record of a lost key is never moved
 * (`carryOldKnowledge`).
 */
async function movedHash(mark: SecretsMarker, known: { hash: string; binding: SecretBinding }, candidate: LocalSecretCandidate): Promise<string> {
  if (!candidate.secret) return pairMark(mark, candidate.binding, null);
  if (known.hash !== (await pairMark(mark, known.binding, candidate.secret))) return mark("plainva: changed on this device");
  return pairMark(mark, candidate.binding, candidate.secret);
}

/**
 * A record whose slot is a change made on this device: its revision, time and
 * device as they were, with a mark that matches no pair, so the next export
 * publishes the slot one revision above.
 */
async function changedHere(mark: SecretsMarker, record: SecretsPortMeta["entries"][string]): Promise<SecretsPortMeta["entries"][string]> {
  const { held: _held, heldRev, ...rest } = record;
  return { ...rest, entryRev: Math.max(record.entryRev, heldRev ?? 0), hash: await mark("plainva: changed on this device") };
}

/** A mark made with a key this device no longer has: what it knew is lost, not changed. */
const isLostMark = (mark: SecretsMarker, hash: string | undefined): boolean => !!hash && isSecretsMark(hash) && !mark.owns(hash);

/**
 * A record under an old name made with a lost key goes (round eleven): no
 * document restores a name this device never writes, and kept, it would wait
 * for ever. The device is as without a record for that name.
 */
function dropLostOldNames(meta: SecretsPortMeta, mark: SecretsMarker): void {
  for (const [id, entry] of Object.entries(meta.entries)) {
    if (entry.tombstone || !isBridgeSecretType(entry.binding.secretType) || !isLostMark(mark, entry.hash)) continue;
    delete meta.entries[id];
    delete meta.imported[id];
  }
}

/** The name a device up to 0.8.7 gave this binding's password (the old type, the user lower-cased). */
function bridgeIdOf(binding: SecretBinding): string | null {
  if (!isShareableSecretType(binding.secretType)) return null;
  return canonicalSecretId({ ...binding, secretType: bridgeSecretTypeOf(binding.secretType), user: binding.user.toLowerCase() });
}

/** An old name closed by "Remove account" opens again when that same account is here again (`closedOldNames`). */
function reopenOldNames(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[]): boolean {
  if (!meta.closedOldNames) return false;
  let reopened = false;
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType) || candidate.binding.user !== candidate.binding.user.toLowerCase()) continue;
    const old = canonicalSecretId({ ...candidate.binding, secretType: bridgeSecretTypeOf(candidate.binding.secretType) });
    if (meta.closedOldNames[old] === undefined) continue;
    delete meta.closedOldNames[old];
    reopened = true;
  }
  if (Object.keys(meta.closedOldNames).length === 0) delete meta.closedOldNames;
  return reopened;
}

/**
 * The mark of what an import decides from: the document (which carries the
 * passwords) and every account here with its slot. Kept as a mark of this
 * device's key (`secretsMark.ts`), like every other value of this file that is
 * made from a password.
 */
function settledKey(mark: SecretsMarker, bundle: SecretsBundle, candidates: readonly LocalSecretCandidate[]): Promise<string> {
  return mark(
    stableStringify({
      entries: bundle.entries,
      candidates: candidates.map((candidate) => [candidate.logicalId, candidate.slot, candidate.binding, candidate.secret]),
    }),
  );
}

export function createSecretsPort(host: SecretsPortHost): SecretsPort {
  const now = () => (host.now ? host.now() : new Date().toISOString());
  // One read of the key per port, not one per half of a round.
  let marker: Promise<SecretsMarker> | null = null;
  const markerFor = (read: SecretsPortMeta | null) => {
    marker ??= secretsMarker(host, holdsSecretsMarks(read)).catch((error) => {
      marker = null;
      throw error;
    });
    return marker;
  };

  // Records of a lost key the last export left waiting (`awaitsDocument`).
  let waiting = false;

  return {
    exportBundle: () => serialized(() => exportBundle()),
    importBundle: (bundle: SecretsBundle) => serialized(() => importBundle(bundle)),
    awaitsDocument: () => waiting,
  };

  async function exportBundle(): Promise<SecretsBundle> {
      const deviceId = await host.deviceId();
      const stamp = now();
      const read = await host.readMeta();
      const mark = await markerFor(read);
      // Written back only when this round changed it (round eight, F68).
      const asRead = read ? stableStringify(read) : null;
      const meta = cloneMeta(read);
      await sealSecretsMeta(meta, mark);
      dropLostOldNames(meta, mark);
      // The key of the marks was lost while marks of it are here (round nine):
      // said in the diagnostics, every round until the records are restored.
      const lostRecords = Object.values(meta.entries).filter((entry) => !entry.tombstone && !entry.held && isLostMark(mark, entry.hash)).length;
      waiting = lostRecords > 0;
      if (lostRecords > 0) logDiagnosticCounted("settings-sync", `secrets: ${lostRecords} record(s) made with a lost mark key, restored from the shared document`);
      // OAuth registrations may still be exposed by an older shell adapter,
      // but the shared port is the final policy boundary for every platform.
      const candidates = (await host.candidates()).filter((candidate) =>
        isShareableSecretType(candidate.binding.secretType)
      );
      await carryOldKnowledge(meta, candidates, mark);
      reopenOldNames(meta, candidates);
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
        const hash = await pairMark(mark, candidate.binding, candidate.secret);
        const previous: SecretsPortMeta["entries"][string] | undefined = meta.entries[candidate.logicalId];
        // What this device knew went with its key (round nine): nothing here is
        // taken as a change. The slot waits for the shared document, which
        // restores the record or holds the slot as a local conflict — until a
        // password is typed here again: a new revision over all it saw.
        const lost = !!previous && !previous.tombstone && isLostMark(mark, previous.hash);
        const typedAgain = lost && !!previous!.held && mark.owns(previous!.held!) && previous!.held !== hash;
        // A lost record, and a local conflict held from one, wait for an
        // import that reads the shared document (round twelve): an export
        // decides nothing about them, however often it runs.
        if (lost && !typedAgain) continue;
        // The revision only moves when the secret actually changed — otherwise
        // two devices would ping-pong revisions on every cycle.
        const changed = !previous || previous.tombstone || previous.hash !== hash;
        const entryRev = changed || !previous ? Math.max(previous?.entryRev ?? 0, previous?.heldRev ?? 0) + 1 : previous.entryRev;
        const updatedAt = changed || !previous ? stamp : previous.updatedAt;
        entries[candidate.logicalId] = {
          entryRev,
          updatedAt,
          deviceId: changed || !previous ? deviceId : previous.deviceId,
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
      // What "Remove account" took out here is tombstoned whatever the lists
      // say — it is known, not inferred (`retireSecret`).
      // An account in lower case had ONE name until the current types (its
      // old name was its name): what removed it here also closes its old name
      // here, so a value a device on 0.8.7 writes under it later reaches no
      // other account ("Alice" beside a removed "alice"). Remembered on this
      // device only (`closedOldNames`), never written, and only until the
      // same account is here again (`reopenOldNames`).
      const closeOldName = (binding: SecretBinding) => {
        if (!isShareableSecretType(binding.secretType) || binding.user !== binding.user.toLowerCase()) return;
        const old = canonicalSecretId({ ...binding, secretType: bridgeSecretTypeOf(binding.secretType) });
        meta.closedOldNames = { ...(meta.closedOldNames ?? {}), [old]: stamp };
      };
      const tombstone = (id: string, removed?: SecretBinding) => {
        let previous = meta.entries[id];
        // Removed before any export of this version moved the record to the
        // account's current name: what this device knew under its old name
        // is what it knew about this account (round twelve, as on main) —
        // unless another account here still goes by that old name.
        const old = !previous && removed ? bridgeIdOf(removed) : null;
        const known = old ? meta.entries[old] : undefined;
        if (known && !known.tombstone && !known.alias && isBridgeSecretType(known.binding.secretType) && !candidates.some((candidate) => bridgeIdOf(candidate.binding) === old)) {
          previous = { ...known, binding: removed! };
        }
        if (!previous || previous.tombstone || currentIds.has(id)) return;
        if (!isShareableSecretType(previous.binding.secretType)) return;
        const entryRev = previous.entryRev + 1;
        entries[id] = { entryRev, updatedAt: stamp, deviceId, binding: previous.binding, tombstone: true };
        meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt: stamp, deviceId, tombstone: true };
        closeOldName(previous.binding);
      };
      for (const [id, removed] of Object.entries(meta.retired ?? {})) {
        delete meta.retired![id];
        if (knownIds.has(id)) continue;
        tombstone(id, removed);
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
          // A tombstone known already goes out as it is, with the device that
          // wrote it (round eleven): taking it as this device's flipped its
          // device against the document every round, and wrote every round.
          const by = previous.tombstone ? previous.deviceId : deviceId;
          entries[id] = { entryRev, updatedAt, deviceId: by, binding: previous.binding, tombstone: true };
          meta.entries[id] = { ...previous, hash: "", entryRev, updatedAt, deviceId: by, tombstone: true };
          if (!previous.tombstone) closeOldName(previous.binding);
        }
      } else {
        // Re-publish what we still know unchanged, so this cycle neither deletes
        // nor resurrects anything while the device is still coming up.
        for (const [id, previous] of Object.entries(meta.entries)) {
          if (currentIds.has(id) || entries[id]) continue;
          // An entry of an old type is never written, not as a tombstone either.
          if (!isShareableSecretType(previous.binding.secretType)) continue;
          if (previous.tombstone) {
            entries[id] = { entryRev: previous.entryRev, updatedAt: previous.updatedAt, deviceId: previous.deviceId, binding: previous.binding, tombstone: true };
          }
        }
      }

      if (stableStringify(meta) !== asRead) await host.writeMeta(meta);
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
      const mark = await markerFor(originalMeta);
      const meta = cloneMeta(originalMeta);
      const sealed = await sealSecretsMeta(meta, mark);
      dropLostOldNames(meta, mark);
      const candidates = await host.candidates();
      const key = await settledKey(mark, bundle, candidates);
      if (meta.settled === key && !sealed) return { ...emptyImportResult(), settled: true };
      const byId = new Map(candidates.map((candidate) => [candidate.logicalId, candidate]));
      const operations: Array<{
        logicalId: string;
        entry: SecretEntry;
        candidate: LocalSecretCandidate;
        viaOldName: boolean;
      }> = [];
      const result = emptyImportResult();
      await carryOldKnowledge(meta, candidates, mark);
      reopenOldNames(meta, candidates);
      const closedOldName = (id: string) => !!meta.oldNameTombstones?.[id] || !!meta.closedOldNames?.[id];
      // What this device knew under each old name when the round began. An
      // entry under an old name that carries the password the device already
      // knew there is no news (round nine): a device back on 0.8.7 publishes
      // it again with its own time, and that time must not cover a newer
      // password in the current place.
      const before = cloneMeta(meta);
      const knownUnderOldName = async (id: string, entry: SecretEntry): Promise<boolean> => {
        const known = before.entries[id];
        // The same password at no later revision: a device back on 0.8.7
        // publishing it again. A later revision with that password is a real
        // change back to it on 0.8.7 (round eleven) and is news.
        return (
          !!known && !known.tombstone && !entry.tombstone && mark.owns(known.hash) &&
          entry.entryRev <= known.entryRev && known.hash === (await entryHash(mark, entry))
        );
      };

      const rememberEntry = async (logicalId: string, entry: SecretEntry, alias = false) => {
        meta.entries[logicalId] = {
          hash: await entryHash(mark, entry),
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: entry.binding,
          tombstone: entry.tombstone,
          ...(alias ? { alias: true } : {}),
        };
      };

      // A password read under the account's old name holds under its current
      // name with the version of the entry it came from — never as a change
      // made here (round eight, R1): no way makes an older password newer. A
      // new revision, time and device come only from a password typed on this
      // device; a newer entry seen later, in either place, wins.
      const recordCurrent = async (candidate: LocalSecretCandidate, entry: SecretEntry) => {
        const hash = await pairMark(mark, candidate.binding, entry.secret);
        const existing = meta.entries[candidate.logicalId];
        if (existing && !existing.tombstone && existing.hash === hash) return;
        meta.entries[candidate.logicalId] = {
          hash,
          entryRev: entry.entryRev,
          updatedAt: entry.updatedAt,
          deviceId: entry.deviceId,
          binding: candidate.binding,
        };
      };

      const rememberOldNameTombstone = (logicalId: string, entry: SecretEntry) => {
        if (meta.oldNameTombstones?.[logicalId] === entry.updatedAt) return;
        meta.oldNameTombstones = { ...(meta.oldNameTombstones ?? {}), [logicalId]: entry.updatedAt };
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
          }
          result.legacyEntries.push(logicalId);
          recordImportResult(result, logicalId, "rejected", "legacy-secret-type");
          continue;
        }
        const bridged = isBridgeSecretType(entry.binding.secretType);
        if (!isShareableSecretType(entry.binding.secretType) && !bridged) {
          recordImportResult(result, logicalId, "rejected", "unsupported-secret-type");
          continue;
        }

        const previous: SecretsPortMeta["entries"][string] | undefined = meta.entries[logicalId];
        // A record of a lost key: its version still orders, its mark compares
        // nothing (round nine).
        const lost = !!previous && !previous.tombstone && isLostMark(mark, previous.hash);
        // An older entry cannot restore it. The revision is knowledge no key
        // holds (round twelve): kept, and the slot is what this device has
        // over it, as if typed here — the next export publishes it above.
        if (lost && compareEntryVersion(entry, previous!) < 0 && byId.has(logicalId)) {
          meta.entries[logicalId] = await changedHere(mark, previous!);
          recordImportResult(result, logicalId, "stale", "older-entry");
          continue;
        }
        const order = previous ? compareEntryVersion(entry, previous) : 1;
        if (previous) {
          if (order < 0) {
            recordImportResult(result, logicalId, "stale", "older-entry");
            continue;
          }
          if (order === 0 && lost && bridged) {
            recordImportResult(result, logicalId, "unchanged", "already-current");
            continue;
          }
          if (order === 0 && !lost) {
            const hash = await entryHash(mark, entry);
            // An empty slot here has the mark of no secret: the entry it came
            // with is the same entry, the slot simply holds nothing.
            const same =
              previous.hash === hash ||
              (!previous.tombstone && !entry.tombstone && previous.hash === (await pairMark(mark, previous.binding, null)));
            if (same && Boolean(previous.tombstone) === Boolean(entry.tombstone)) {
              recordImportResult(result, logicalId, "unchanged", "already-current");
            } else {
              recordImportResult(result, logicalId, "rejected", "version-collision");
            }
            continue;
          }
        }

        // The type of a local account this entry may speak for: its own, or —
        // for an entry of a client up to 0.8.7 — the current one of that kind.
        const localType = bridged ? currentSecretTypeOf(entry.binding.secretType as Parameters<typeof currentSecretTypeOf>[0]) : entry.binding.secretType;
        const sameType = (item: LocalSecretCandidate) => item.binding.secretType === localType;
        // An id match is never sufficient by itself: type and endpoint binding
        // must still agree. Family alone may differ because it is a catalog
        // label rather than a credential destination.
        const direct = bridged ? undefined : byId.get(logicalId);
        const exactCandidate = bridged
          ? undefined
          : (direct && sameType(direct) && bindingMatchesExceptFamily(entry.binding, direct.binding) ? direct : undefined) ??
            candidates.find((item) => sameType(item) && bindingMatches(entry.binding, item.binding)) ??
            candidates.find((item) => sameType(item) && bindingMatchesExceptFamily(entry.binding, item.binding));
        // An entry of a client up to 0.8.7 carries the user lower-cased,
        // whatever its spelling was. It reaches the account it names when
        // exactly one account here could be meant — never one of two that
        // differ only in case. Whether an entry is old is said by its type,
        // its place in the document, never by the spelling of its user: an
        // old client keeps the type of every entry it writes back, and a
        // current one never writes an old type (review 2026-11-18, round six).
        const foldMatches = bridged
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
        const legacyCandidate = foldMatches.length === 1 ? foldMatches[0] : undefined;
        // ...and only as its old name, one way (`oldNameId`): never a
        // tombstone, never after a tombstone for that name was seen here, and
        // only when it is newer than the current entry of that account. On a
        // tie the current entry stands.
        if (legacyCandidate) {
          const exact = bundle.entries[legacyCandidate.logicalId];
          const retiredName = meta.entries[logicalId]?.tombstone === true || closedOldName(logicalId);
          if (entry.tombstone) rememberOldNameTombstone(logicalId, entry);
          if (entry.tombstone || retiredName || (exact && !(entry.updatedAt > exact.updatedAt))) {
            recordImportResult(result, logicalId, "unchanged", exact ? "superseded-by-exact-entry" : "old-name-not-taken");
            continue;
          }
          if (exact && (await knownUnderOldName(logicalId, entry))) {
            recordImportResult(result, logicalId, "unchanged", "already-current");
            continue;
          }
        }
        // The current entry of an account whose old name carries a NEWER
        // password (a device up to 0.8.7 changed it): that one is read.
        const oldName = exactCandidate ? oldNameId(exactCandidate, candidates) : null;
        const oldEntry = oldName ? bundle.entries[oldName] : undefined;
        if (
          oldEntry && isBridgeSecretType(oldEntry.binding.secretType) && !oldEntry.tombstone &&
          meta.entries[oldName!]?.tombstone !== true && !closedOldName(oldName!) &&
          oldEntry.updatedAt > entry.updatedAt &&
          !(await knownUnderOldName(oldName!, oldEntry))
        ) {
          recordImportResult(result, logicalId, "unchanged", "superseded-by-later-entry");
          continue;
        }
        const candidate = exactCandidate ?? legacyCandidate;
        const viaOldName = !!candidate && candidate.logicalId !== logicalId && !exactCandidate;
        // The old name and the exact one of one account share one record of having been imported.
        const pairImported = !!meta.imported[logicalId] || (!!candidate && !!meta.imported[candidate.logicalId]);

        if (!candidate && entry.tombstone) {
          await rememberEntry(logicalId, entry);
          delete meta.imported[logicalId];
          recordImportResult(result, logicalId, "unchanged", "tombstone-no-local-secret");
          continue;
        }
        if (!candidate) {
          // An entry of a client up to 0.8.7 beside the current one of the
          // same account waits with it, not as a second account.
          const waitsWithCurrent =
            bridged &&
            Object.values(bundle.entries).some(
              (other) => other.binding.secretType === localType && bindingMatchesExceptFamily(other.binding, entry.binding, "fold"),
            );
          if (!waitsWithCurrent) result.unknownAccounts.push(logicalId);
          recordImportResult(
            result,
            logicalId,
            "rejected",
            direct ? "binding-mismatch" : "unknown-account",
          );
          continue;
        }

        // Knowledge lost with the key (round nine): restored from the document
        // where the slot holds what it says; held as a local conflict where it
        // holds something else, unless the entry is newer and this device took
        // its password through the sync (then it follows, as always).
        if (lost && !entry.tombstone && candidate.logicalId === logicalId) {
          if (candidate.secret && stableStringify(candidate.secret) === stableStringify(entry.secret)) {
            await rememberEntry(logicalId, entry);
            recordImportResult(result, logicalId, "unchanged", "already-current");
            continue;
          }
          // The document holds the very version this device knew, and the slot
          // holds something else: the password changed here (round eleven).
          if (candidate.secret && order === 0 && !previous!.held) {
            meta.entries[logicalId] = await changedHere(mark, previous!);
            recordImportResult(result, logicalId, "unchanged", "already-current");
            continue;
          }
          if (candidate.secret && !(pairImported && order > 0)) {
            const held = await pairMark(mark, candidate.binding, candidate.secret);
            const heldRev = Math.max(previous!.heldRev ?? 0, entry.entryRev);
            if (previous!.held !== held || previous!.heldRev !== heldRev) meta.entries[logicalId] = { ...previous!, held, heldRev };
            recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
            continue;
          }
          if (!candidate.secret && order === 0) {
            meta.entries[logicalId] = { hash: await pairMark(mark, candidate.binding, null), entryRev: entry.entryRev, updatedAt: entry.updatedAt, deviceId: entry.deviceId, binding: candidate.binding };
            recordImportResult(result, logicalId, "unchanged", "already-current");
            continue;
          }
        }

        if (entry.tombstone && !pairImported) {
          await rememberEntry(logicalId, entry);
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
          await rememberEntry(logicalId, entry, viaOldName);
          if (viaOldName) await recordCurrent(candidate, entry);
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
          await rememberEntry(logicalId, entry, viaOldName);
          if (viaOldName && !entry.tombstone) await recordCurrent(candidate, entry);
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

      // Settled when nothing is left open: no slot failed, no account is
      // waiting, no retired entry asks to be reported again.
      const open = result.errors.length > 0 || result.unknownAccounts.length > 0 || result.legacyEntries.length > 0;
      // Taken against the slots as they are now: what this import wrote is the
      // state the next round finds.
      const settled = open ? undefined : successfulSlots.size > 0 ? await settledKey(mark, bundle, await host.candidates()) : key;
      if (meta.settled !== settled) {
        if (settled) meta.settled = settled;
        else delete meta.settled;
      }
      // Every record of a lost key ends with an import that read the document
      // (round twelve), and keeps its revision and its mark of having been
      // received — knowledge no key holds; only the mark goes:
      //  - no account here: there is no slot to compare, the mark of no secret;
      //  - the document has nothing for it, or nothing as new: the slot is what
      //    this device has over it, as if typed here;
      //  - the document has something as new that did not restore it: a local
      //    conflict, held as above.
      for (const [id, record] of Object.entries(meta.entries)) {
        if (record.tombstone || record.held || !isLostMark(mark, record.hash) || isBridgeSecretType(record.binding.secretType)) continue;
        const candidate = byId.get(id);
        const entry = bundle.entries[id];
        if (!candidate) {
          meta.entries[id] = { ...record, hash: await pairMark(mark, record.binding, null) };
        } else if (!entry || compareEntryVersion(entry, record) < 0) {
          meta.entries[id] = await changedHere(mark, record);
        } else {
          meta.entries[id] = { ...record, held: await pairMark(mark, candidate.binding, candidate.secret), heldRev: Math.max(record.heldRev ?? 0, entry.entryRev) };
        }
      }
      // A round that changes nothing writes nothing (round eleven, F68):
      // compared, not assumed.
      if (stableStringify(meta) === stableStringify(originalMeta)) return result;

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
