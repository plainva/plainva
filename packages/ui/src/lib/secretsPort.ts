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
  /**
   * "Sign out on this device" took this slot's sign-in (`isSignedOutSlot`):
   * no password from another device signs it in again; only a sign-in here
   * does.
   */
  signedOutHere?: boolean;
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
       * A local conflict held after a lost key (round twelve): the mark of
       * the slot when the shared document had the same revision with another
       * password. The slot is neither overwritten nor published until the
       * document brings what it holds, or a newer entry it follows, or a
       * password is typed here.
       */
      held?: string;
      /**
       * The newest revision seen in the shared document while this device
       * could not tell its slot from what it knew: a password typed here later
       * goes out above it.
       */
      heldRev?: number;
      /**
       * Taken from the slot after the key of the marks was lost (round
       * twelve, the baseline): what this device holds is taken as unchanged
       * until an import has read the shared document. Until then the record
       * is not published; a slot that differs from it later is a change made
       * here.
       */
      sinceLoss?: true;
      /**
       * A baseline the document did not confirm when the loss ended: it had
       * nothing for the account, or only an older entry. What this device
       * holds goes out with the revision it knew, a moment before the time
       * it knew — so the real entry of that version, should any device still
       * have it, always wins over it — until the document brings the same
       * version (restored, or held) or a password is typed here.
       */
      unconfirmed?: true;
      /** This tombstone was written by "Remove account" on this device (`retireSecret`). */
      removal?: true;
      /**
       * A tombstone of another device remembered for an account still listed
       * here: the mark of what its slot held then (the tombstone takes
       * nothing from a listed slot). It tells a password typed in the save
       * that repairs the address from the one the sync left there (review
       * 2026-11-27, sixth round, rule R); `hash` stays empty.
       */
      slotMark?: string;
      /**
       * Carried to this name by a repair (`carryRepairedKnowledge`): this
       * device puts the entry here, though its version (and so its device)
       * is the one it had under the name before. Taken back like its own when
       * the account leaves with the settings profile, until this device takes
       * a newer password under that name or one is typed here.
       */
      moved?: true;
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
  retired?: Record<string, RetiredBinding>;
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
   * The names — current and old — "Remove account" tombstoned on this
   * device, and where each removal stands (`RemovalState`). The name opens
   * again when its account is on this device again.
   */
  removedIds?: Record<string, RemovalState>;
  /**
   * The name each slot of this device was last listed under, by slot
   * (`carryRepairedKnowledge`). A repaired address changes the name of an
   * account, not the history of its slot.
   */
  slotNames?: Record<string, string>;
  /**
   * The highest revision a slot knew under the names it had before a repair,
   * by its name now (`carryRepairedKnowledge`). What this device writes under
   * that name — a password typed here, a removal — goes above it, so it never
   * falls below a version another updated device carried over from the old
   * name. Dropped once the record under the name is at or above it.
   */
  floors?: Record<string, number>;
  /**
   * Set by the first export of a version that writes every removal as a note
   * (`retired`), once it compared the lists of every kind. A record without it
   * was last written by a version that told a removal by comparing lists —
   * 0.9.0 and the builds of `main` before this rule, which wrote no note for a
   * mailbox: the first export here does that comparison once for them, kind
   * by kind (`inferPendingRemovals`), so nothing that version would have
   * written in its next round stays unwritten across the update (review
   * 2026-11-26, fourth and fifth round). Said by the record itself, never by
   * a clock.
   */
  notesRemovals?: true;
  /** The kinds compared already while another one waits for a whole list (`inferPendingRemovals`); gone with `notesRemovals`. */
  comparedKinds?: SecretBinding["service"][];
  /**
   * The document, accounts and slots the last import took with nothing left
   * open, as a mark (`settledKey`). The same again is settled: nothing is
   * written and nothing reported (round seven).
   */
  settled?: string;
}

/**
 * A binding "Remove account" asked to be tombstoned, with the moment the device
 * registered that act — or (`withProfile`) an account the settings profile
 * took away because it was removed elsewhere (`noteSecretLeftWithProfile`).
 */
export type RetiredBinding = SecretBinding & { removedAt?: string; withProfile?: true };

/**
 * Where a removal this device wrote stands (`docs/engineering/Secrets_Removal_Rules.md`).
 * No decision compares two times: a writer writes one revision above all it
 * knows of a name, so the revision says what it had seen.
 *
 *  - The tombstone goes out one revision above all this device knew of the
 *    name at the act; a name it knew nothing of is only noted.
 *  - `confirmed`: a round of this device found its tombstone as the
 *    document's entry (or a tombstone above it).
 *  - A value at the revision of the tombstone won the tie of the merge: its
 *    writer had not seen the tombstone, and it is answered — one revision
 *    above it. So is a value above the tombstone before the removal is
 *    confirmed: the tombstone was not in the document when it was written.
 *    A value above a confirmed tombstone was written with it in view (the
 *    account was added again, or kept on purpose): the removal `yielded`.
 *  - A noted removal answers the first value it finds under the name, at
 *    whatever import finds it; it costs nothing while the document has none.
 *  - While its own tombstone is not confirmed, the port reads the document
 *    every round (`awaitsDocument`). The account on this device again ends a
 *    removal.
 */
export interface RemovalState {
  /** When this device registered the act (the tombstone's time; a tie-breaker of the merge only). */
  at: string;
  /** What the removed account was named by (no secret): an entry of the same account under another name is no account to wait for. */
  binding?: SecretBinding;
  confirmed?: true;
  yielded?: true;
}

/** What a shell must provide; everything else is decided above. */
export interface SecretsPortHost {
  deviceId(): Promise<string>;
  readMeta(): Promise<SecretsPortMeta | null>;
  writeMeta(meta: SecretsPortMeta): Promise<void>;
  /** The device's accounts, with the secret each currently holds. */
  candidates(): Promise<LocalSecretCandidate[]>;
  /**
   * Whether `candidates()` currently lists EVERY account of this kind on
   * this device.
   *
   * A calendar account list is served by a runtime that boots in parallel
   * with the sync worker (the phone), or is missing without that runtime (the
   * desktop), so a cycle can catch it empty. A removal that "Remove account"
   * asked for (`retireSecret`) waits for a list that is whole: an account still
   * listed is no removal. Mail accounts are read from the settings store and
   * are always whole. The port asks before and after it reads the list; the
   * list is whole only when both answers say so (review 2026-11-26, fifth
   * round, L2).
   */
  accountsReady?(service: SecretBinding["service"]): Promise<boolean>;
  readSlot(slot: string): Promise<unknown>;
  /** The key of the marks from the app process, for every window at once (`secretsMark.ts`). */
  ownedKey?(fresh: string, marksOnDevice: boolean): Promise<string>;
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
  ...(source?.removedIds ? { removedIds: Object.fromEntries(Object.entries(source.removedIds).map(([id, state]) => [id, { ...state }])) } : {}),
  ...(source?.slotNames ? { slotNames: { ...source.slotNames } } : {}),
  ...(source?.floors ? { floors: { ...source.floors } } : {}),
  ...(source?.notesRemovals ? { notesRemovals: true as const } : {}),
  ...(source?.comparedKinds ? { comparedKinds: [...source.comparedKinds] } : {}),
  ...(source?.settled ? { settled: source.settled } : {}),
});

/**
 * "Remove account" takes this account out (review 2026-11-18): its entry is
 * tombstoned by the next export, under its name in the current type and —
 * when this device knows it and no other account here can mean it — under
 * the old name a device up to 0.8.7 holds it by. This act is the only source
 * of a tombstone (review 2026-11-25): an account that is merely gone from
 * this device (repaired, folded, taken away by the profile) writes none. An
 * account that comes back before the export keeps its entry.
 *
 * `remove` takes the account out of the device. It runs in the same line as
 * every export and import, right after the mark is stored, so no export can
 * find the mark while the account is still listed and drop it as "still
 * here" (review 2026-11-18, finding 1). It must not run a secrets round
 * itself.
 */
export async function retireSecret(
  host: Pick<SecretsPortHost, "readMeta" | "writeMeta">,
  binding: SecretBinding,
  remove?: () => Promise<void>,
  /** The moment of the act (injectable for tests): the tombstone carries it, not the time of the round that writes it. */
  at: string = new Date().toISOString(),
): Promise<void> {
  await serialized(async () => {
    const meta = cloneMeta(await host.readMeta());
    meta.retired = { ...(meta.retired ?? {}), [canonicalSecretId(binding)]: { ...binding, removedAt: at } };
    await host.writeMeta(meta);
    await remove?.();
  });
}

/**
 * The settings profile took this account away (it was removed elsewhere):
 * said by the profile import, never inferred from a missing row. Its next
 * export takes back what this device published for the account itself (above
 * a tombstone too) or carried there by a repair (`moved`), under the
 * account's name and every earlier address of the same user; what it only
 * received is its publisher's to take back.
 */
export async function noteSecretLeftWithProfile(host: Pick<SecretsPortHost, "readMeta" | "writeMeta">, binding: SecretBinding): Promise<void> {
  await serialized(async () => {
    const meta = cloneMeta(await host.readMeta());
    const id = canonicalSecretId(binding);
    if (meta.retired?.[id] && !meta.retired[id].withProfile) return;
    meta.retired = { ...(meta.retired ?? {}), [id]: { ...binding, withProfile: true } };
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

/**
 * Behind the sealing at start, in the same line (review of F57, round three,
 * O-C): the switch-over of the confirmed addresses runs here, so the home of
 * the key of the marks is decided before it reads a slot. `run` must not call
 * `serialized` itself.
 */
export function afterSecretsSeal<T>(run: () => Promise<T>): Promise<T> {
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
function oldNameId(candidate: LocalSecretCandidate, candidates: readonly LocalSecretCandidate[], ready: ListsReady): string | null {
  if (!isShareableSecretType(candidate.binding.secretType)) return null;
  // On a list that may not be whole the twin may be the one left out (sixth round, M4).
  if (!ready(candidate.binding.service)) return null;
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
 * A repair changes the name, not the history (review 2026-11-25, third and
 * fourth round; the table "A repair changes the name, not the history" in
 * `docs/engineering/Secrets_Removal_Rules.md`, one test per cell in
 * `apps/desktop/src/services/secretsRepairCells.test.ts`). An account whose
 * address was repaired — here, or by the settings profile — keeps its slot
 * under another name, and the slot keeps what it knew under the name it was
 * last listed under:
 *
 *  - Received or typed belongs to the slot: the mark of having come in
 *    through the sync is the one it had under the old name, whatever this
 *    device knows of the new one (nothing, a password, a tombstone of another
 *    device, its own removal).
 *  - Every revision it knew under the old name is a floor under the new one
 *    (`floors`): a password typed after the repair, or a removal, goes out
 *    above it.
 *  - The version of the entry it holds goes along only from a password whose
 *    record is settled (not of a lost key, not held, not waiting to be
 *    confirmed) and only where the new name holds no tombstone (the password
 *    goes out above that one) and no record with the slot's own password
 *    (that record keeps its version). Unchanged, the password then goes out
 *    under the new name with the version it had, so it never beats a newer
 *    one there.
 *
 * Nothing is carried from a name another account here still had before this
 * round (two rows, one name), from an alias, or between two kinds. Two
 * accounts of one user that move at once — A from a to c, B from b to a —
 * each carry their own: a is B's name now, but it was A's (review 2026-11-26,
 * fourth round, M2). What every slot carries is read as the record stood
 * before any of them moved. Without a note of its slot (a record written by
 * 0.9.0 or before) nothing is carried: the device behaves as those versions
 * did until its first round writes the note. A list that may not be whole
 * (`accountsReady`) carries nothing: an account it leaves out may still hold
 * the old name.
 */
async function carryRepairedKnowledge(
  meta: SecretsPortMeta,
  candidates: readonly LocalSecretCandidate[],
  mark: SecretsMarker,
  ready: ListsReady,
  doc: SecretsBundle | null,
): Promise<Set<string>> {
  const waits = new Set<string>();
  const before = { entries: { ...meta.entries }, imported: { ...meta.imported }, floors: { ...(meta.floors ?? {}) } };
  // A name another account here held already before this round — or one whose
  // slot this device has no note of — is that account's.
  const heldBy = (former: string, candidate: LocalSecretCandidate) =>
    candidates.some((other) => other !== candidate && other.logicalId === former && (meta.slotNames?.[other.slot] ?? former) === former);
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType) || !ready(candidate.binding.service)) continue;
    const id = candidate.logicalId;
    const former = meta.slotNames?.[candidate.slot];
    if (!former || former === id || heldBy(former, candidate)) continue;
    const known = before.entries[former];
    if (known && (known.alias || known.binding.secretType !== candidate.binding.secretType)) continue;
    // Received needs a proof (review 2026-11-27, seventh round): a mark this
    // device made with a key it still has, or the document itself. A record
    // of a lost key not rebuilt (`baselineAfterLoss` leaves a name whose slot
    // moved in the same gap) has neither on the device: the export waits for
    // the document (`waits`, the note of the slot stays), and the import
    // reads it — not typed only where the slot holds exactly the value the
    // document carries under the old name at the record's revision.
    const lost = !!known && !known.tombstone && isLostMark(mark, known.hash);
    if (lost && !doc) {
      waits.add(candidate.slot);
      continue;
    }
    // A password the slot holds other than the one the sync last left in it
    // was typed in the save that repaired it: typed here, as with no record
    // under the new name — whatever the state of the record under the old
    // name (review 2026-11-26/27, fifth to seventh round, rule R). Where this
    // device has nothing to compare with, it does as main did, which carried
    // nothing: typed here (`slotLeft`).
    let typedHere: boolean;
    if (lost) {
      const there = doc!.entries[former];
      // A tombstone carries no secret, so it proves nothing.
      const proven = !!there && there.entryRev === known.entryRev && stableStringify(there.secret) === stableStringify(candidate.secret);
      typedHere = !!candidate.secret && !proven;
    } else {
      const left = slotLeft(known);
      typedHere = !!known && !!candidate.secret && (left === null || left !== (await pairMark(mark, known.binding, candidate.secret)));
    }
    if (before.imported[former] && !typedHere) meta.imported[id] = true;
    else delete meta.imported[id];
    if (!known) continue;
    const floor = Math.max(known.entryRev, known.heldRev ?? 0, before.floors[former] ?? 0);
    if (floor > (meta.floors?.[id] ?? 0)) meta.floors = { ...(meta.floors ?? {}), [id]: floor };
    const here = before.entries[id];
    const slotMarkHere = candidate.secret ? await pairMark(mark, candidate.binding, candidate.secret) : null;
    const seen = Math.max(known.heldRev ?? 0, here?.entryRev ?? 0, here?.heldRev ?? 0);
    if (known.tombstone || lost || known.sinceLoss || known.held || known.unconfirmed) {
      // No version to carry: a password only received never goes out as a
      // new value above a newer one (seventh round, M1). It waits for the
      // document like a slot after a lost key (`sinceLoss`, at revision 0,
      // so any entry under the new name is newer): the import takes what the
      // document holds there, or — with nothing there — it goes out below
      // every entry (`unconfirmed`). Typed here, it goes out above the floor.
      if (meta.imported[id] && slotMarkHere && !here?.tombstone && here?.hash !== slotMarkHere) {
        meta.entries[id] = {
          hash: slotMarkHere,
          entryRev: 0,
          updatedAt: justBefore(here?.updatedAt ?? known.updatedAt),
          deviceId: here?.deviceId ?? known.deviceId,
          binding: candidate.binding,
          ...(seen > 0 ? { heldRev: seen } : {}),
          sinceLoss: true,
        };
      }
      continue;
    }
    if (here?.tombstone) continue;
    if (here && slotMarkHere && here.hash === slotMarkHere) continue;
    meta.entries[id] = {
      hash: await movedHash(mark, known, candidate),
      entryRev: known.entryRev,
      // A moment before its time: one device that wrote both names in one
      // round gave both entries one revision, time and device, and a repair
      // that makes them one name would leave two entries the merge cannot
      // order — each device would keep sending its own. Carried, the version
      // yields to any entry of that very version (fourth round).
      updatedAt: justBefore(known.updatedAt),
      deviceId: known.deviceId,
      binding: candidate.binding,
      ...(seen > 0 ? { heldRev: seen } : {}),
      moved: true,
    };
  }
  return waits;
}

/**
 * The mark of what the sync last left in the slot of a record (rule R): the
 * password it confirmed, sent or took in, the slot it holds back (`held` is
 * that same mark), the slot as it was at a lost key (`sinceLoss`,
 * `unconfirmed`) — all `hash` — or the slot a tombstone of another device
 * found (`slotMark`). A mark of a lost key not rebuilt yet matches nothing:
 * typed here, as with none. Null where the device has none: a tombstone
 * remembered by a build before this rule, or for no listed slot.
 */
function slotLeft(known: SecretsPortMeta["entries"][string] | undefined): string | null {
  if (!known) return null;
  return known.tombstone ? (known.slotMark ?? null) : known.hash;
}

/**
 * A carry of a repaired slot still to come (`carryRepairedKnowledge`): its
 * slot is noted under another name than it is listed under now. It waits for
 * a whole list of its kind.
 */
function carryWaits(meta: SecretsPortMeta, candidate: LocalSecretCandidate): boolean {
  const former = meta.slotNames?.[candidate.slot];
  return isShareableSecretType(candidate.binding.secretType) && !!former && former !== candidate.logicalId;
}

/**
 * What a carry that waits leaves when an import writes the slot under its new
 * name first (`carryWaits`): the floor of the old name, and the note of the
 * slot under the name it holds the document's password of now.
 */
function noteCarriedFloor(meta: SecretsPortMeta, candidate: LocalSecretCandidate): void {
  const former = meta.slotNames![candidate.slot]!;
  const known = meta.entries[former];
  const floor = known ? Math.max(known.entryRev, known.heldRev ?? 0, meta.floors?.[former] ?? 0) : (meta.floors?.[former] ?? 0);
  if (floor > (meta.floors?.[candidate.logicalId] ?? 0)) meta.floors = { ...(meta.floors ?? {}), [candidate.logicalId]: floor };
  meta.slotNames = { ...meta.slotNames, [candidate.slot]: candidate.logicalId };
}

/** The floor under a name (`floors`): what this device writes under it goes above it. */
function floorOf(meta: SecretsPortMeta, id: string): number {
  return meta.floors?.[id] ?? 0;
}

/**
 * Whether the list of a kind of account is whole now (`accountsReady`, asked
 * once a round). A list that may not be whole decides nothing: what it leaves
 * out is no account gone (review 2026-11-26, fourth round, S2).
 */
type ListsReady = ((service: SecretBinding["service"]) => boolean) & { all: boolean };
async function listsReady(host: Pick<SecretsPortHost, "accountsReady">, before?: ListsReady): Promise<ListsReady> {
  const answers = new Map<SecretBinding["service"], boolean>();
  for (const service of SECRET_SERVICES) answers.set(service, (!before || before(service)) && (host.accountsReady ? await host.accountsReady(service) : true));
  return Object.assign((service: SecretBinding["service"]) => answers.get(service) ?? true, { all: [...answers.values()].every(Boolean) });
}
const SECRET_SERVICES = ["calendar", "mail", "files"] as const;

/**
 * The candidates, read between two questions whether each list is whole
 * (`accountsReady`): a list counts as whole only when it was whole before it
 * was read and still is after (review 2026-11-26, fifth round, L2 — on the
 * phone the runtime that lists the calendars may come up, or start again,
 * while the list is read).
 */
async function readCandidates(host: Pick<SecretsPortHost, "accountsReady" | "candidates">): Promise<{ candidates: LocalSecretCandidate[]; ready: ListsReady }> {
  const before = await listsReady(host);
  const candidates = await host.candidates();
  return { candidates, ready: await listsReady(host, before) };
}

/**
 * The comparison of lists a version before `notesRemovals` ran in every
 * export, done once on its record, kind by kind (review 2026-11-26, fourth
 * and fifth round): it writes what that version would have written in its
 * next round and nothing else — the tombstone of an absence, as that version
 * wrote it (one revision above the record, this device, this round), the
 * record kept "received" (`imported`), no removal of this device's
 * (`removedIds`) and nothing taken back elsewhere. A conclusion from lists is
 * no act of the person: listed again, the account follows as before.
 *
 * Left out, as that version did: an account listed (signed out too), a
 * tombstone, an old name read for an account (`alias`), a record of an old
 * type, one a note already speaks for (`retired`), the same credential listed
 * under another spelling (folded). Nothing else: the conclusion departs from
 * that version only where this device can prove it (review 2026-11-27, sixth
 * round, rule U3), and lists and records alone cannot tell an address
 * repaired from an account removed with another one of that user connected
 * at another server. The one proof is a repair this version saw itself: the
 * slot of a listed account noted under the old name when the round began
 * (`slotNames` of `prior`, the record as read; a slot is noted only on a
 * whole list, in an import of this version before the kind was compared).
 * An address repaired on that version before the update gets the tombstone
 * of an absence that version wrote; the slot keeps its password, and listed
 * again under the old address the account follows as before (`U2`).
 *
 * A kind is compared once its list is whole (`ListsReady`); the others wait
 * (`comparedKinds`). Every kind waits while every list came back empty
 * though accounts were known (that version's guard). Returns the ids to
 * tombstone; `notesRemovals` is set once every kind was compared — at once on
 * a record of none (a new device).
 */
function inferPendingRemovals(
  meta: SecretsPortMeta,
  candidates: readonly LocalSecretCandidate[],
  knownIds: ReadonlySet<string>,
  ready: ListsReady,
  prior: Pick<SecretsPortMeta, "entries" | "slotNames"> | null,
): string[] {
  if (!prior) {
    meta.notesRemovals = true;
    return [];
  }
  if (candidates.length === 0 && Object.keys(meta.entries).length > 0) return [];
  const compared = new Set(meta.comparedKinds ?? []);
  const now = new Set(SECRET_SERVICES.filter((kind) => !compared.has(kind) && ready(kind)));
  const absent: string[] = [];
  for (const [id, previous] of Object.entries(meta.entries)) {
    if (!now.has(previous.binding.service)) continue;
    if (previous.tombstone || previous.alias || !isShareableSecretType(previous.binding.secretType) || knownIds.has(id) || meta.retired?.[id]) continue;
    const kept = candidates.some(
      (candidate) =>
        candidate.binding.secretType === previous.binding.secretType &&
        (bindingMatchesExceptFamily(previous.binding, candidate.binding, "fold") || prior.slotNames?.[candidate.slot] === id),
    );
    if (!kept) absent.push(id);
  }
  for (const kind of now) compared.add(kind);
  if (SECRET_SERVICES.every((kind) => compared.has(kind))) {
    meta.notesRemovals = true;
    delete meta.comparedKinds;
  } else {
    meta.comparedKinds = SECRET_SERVICES.filter((kind) => compared.has(kind));
  }
  return absent;
}

/**
 * Notes the name each slot is listed under now (`slotNames`); a note whose
 * slot and record are both gone goes, and a floor whose name is listed no
 * more and has no removal still to be written — but only after a round whose
 * lists were all whole: a slot a list leaves out for a round is still here
 * (`ListsReady`).
 */
function noteSlotNames(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[], ready: ListsReady, waits: ReadonlySet<string> = new Set()): void {
  const slots = new Set<string>();
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType)) continue;
    slots.add(candidate.slot);
    // Not on a list that may not be whole, nor for a carry that waits for the
    // document (`carryRepairedKnowledge`): the note waits with it.
    if (!ready(candidate.binding.service) || waits.has(candidate.slot)) continue;
    if (meta.slotNames?.[candidate.slot] !== candidate.logicalId) meta.slotNames = { ...(meta.slotNames ?? {}), [candidate.slot]: candidate.logicalId };
  }
  for (const [slot, id] of Object.entries(meta.slotNames ?? {})) {
    if (ready.all && !slots.has(slot) && !meta.entries[id]) delete meta.slotNames![slot];
  }
  if (meta.slotNames && Object.keys(meta.slotNames).length === 0) delete meta.slotNames;
  const names = new Set(candidates.map((candidate) => candidate.logicalId));
  for (const id of Object.keys(meta.floors ?? {})) {
    const record = meta.entries[id];
    // A removal still to be written under the name goes above its floor (`tombstone`).
    if ((ready.all && !names.has(id) && !meta.retired?.[id]) || (record && record.entryRev >= meta.floors![id])) delete meta.floors![id];
  }
  if (meta.floors && Object.keys(meta.floors).length === 0) delete meta.floors;
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
async function carryOldKnowledge(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[], mark: SecretsMarker, ready: ListsReady): Promise<boolean> {
  let carried = false;
  for (const candidate of candidates) {
    if (!isShareableSecretType(candidate.binding.secretType) || meta.entries[candidate.logicalId]) continue;
    const old = oldNameId(candidate, candidates, ready);
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
 * The baseline after a lost key (round twelve): every record made with a
 * key this device no longer has takes the mark of its slot as it is now —
 * or of no secret, where the account or its slot is not here on a list
 * that is whole (a record of a kind whose list may not be whole waits) —
 * keeping its revision, time, device and its mark of having been received,
 * which no key holds. Done in the run that finds the loss, export or import, offline
 * too. A local conflict held with the lost key is held again with the slot.
 * Records under an old name are left to `dropLostOldNames`.
 */
async function baselineAfterLoss(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[], mark: SecretsMarker, ready: ListsReady): Promise<boolean> {
  let changed = false;
  for (const [id, record] of Object.entries(meta.entries)) {
    if (record.tombstone || isBridgeSecretType(record.binding.secretType)) continue;
    const hashLost = isLostMark(mark, record.hash);
    const heldLost = !!record.held && isLostMark(mark, record.held);
    if (!hashLost && !heldLost) continue;
    const candidate = candidates.find((item) => item.logicalId === id);
    // Not listed on a list that may not be whole: its slot is unknown, not
    // empty — the record waits for a whole list (review 2026-11-26, fifth
    // round, L1).
    if (!candidate && !ready(record.binding.service)) continue;
    // A slot noted under the name whose address was repaired since, in the
    // same gap: what it holds now may be typed in that save, so it is no
    // proof of what the sync left (seventh round, S1). The record stays as
    // it is; the carry reads the document for it (`carryRepairedKnowledge`).
    if (!candidate && candidates.some((item) => meta.slotNames?.[item.slot] === id)) continue;
    const slot = candidate ? await pairMark(mark, candidate.binding, candidate.secret) : await pairMark(mark, record.binding, null);
    meta.entries[id] = { ...record, ...(hashLost ? { hash: slot } : {}), ...(heldLost ? { held: slot } : {}), sinceLoss: true };
    changed = true;
  }
  return changed;
}

/** A moment before a time: what an unconfirmed baseline goes out with (`unconfirmed`). */
function justBefore(time: string): string {
  const at = Date.parse(time);
  return Number.isFinite(at) ? new Date(at - 1).toISOString() : time;
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

/**
 * Whether a password may have come through the settings sync from another
 * device, not typed here (F57). The mark hangs at the password, not at the
 * address: any import mark of the same account — same service, the same type
 * under its name now or the one 0.8.7 gave it, the same user — counts,
 * whatever address it was taken under. A mailbox whose server was changed
 * after the import (on another device, through the profile) is still the
 * imported password (review of F57, rounds two and three, O-1, O-A). A mark
 * this cannot read is doubt, and doubt asks: it counts as imported.
 */
export function secretImportedFor(meta: SecretsPortMeta | null | undefined, binding: SecretBinding): boolean {
  if (!meta) return false;
  if (meta.imported[canonicalSecretId(binding)]) return true;
  const old = bridgeIdOf(binding);
  if (old && meta.imported[old]) return true;
  const types = new Set<string>([binding.secretType]);
  if (isShareableSecretType(binding.secretType)) types.add(bridgeSecretTypeOf(binding.secretType));
  const user = binding.user.trim().toLowerCase();
  for (const [id, on] of Object.entries(meta.imported)) {
    if (!on) continue;
    const parsed = /^s1:([^:]+):([^:]+):([^@]*)@/.exec(id);
    if (!parsed) return true;
    let marked: string;
    try {
      marked = decodeURIComponent(parsed[3]).trim().toLowerCase();
    } catch {
      return true;
    }
    if (parsed[1] === binding.service && types.has(parsed[2]) && marked === user) return true;
  }
  return false;
}

/** The name a device up to 0.8.7 gave this binding's password (the old type, the user lower-cased). */
function bridgeIdOf(binding: SecretBinding): string | null {
  if (!isShareableSecretType(binding.secretType)) return null;
  return canonicalSecretId({ ...binding, secretType: bridgeSecretTypeOf(binding.secretType), user: binding.user.toLowerCase() });
}

/** A tombstone of a removal of this device that it has not yet found in the document (`RemovalState`): the document is read for it. */
const openRemoval = (meta: SecretsPortMeta): boolean =>
  Object.entries(meta.removedIds ?? {}).some(([id, state]) => !state.confirmed && !state.yielded && meta.entries[id]?.tombstone === true && meta.entries[id].removal === true);

/** A name "Remove account" tombstoned here opens again when its account is here again (`removedIds`). */
function openRemovedIds(meta: SecretsPortMeta, candidates: readonly LocalSecretCandidate[]): void {
  if (!meta.removedIds) return;
  for (const candidate of candidates) {
    delete meta.removedIds[candidate.logicalId];
    const old = bridgeIdOf(candidate.binding);
    if (old) delete meta.removedIds[old];
  }
  if (Object.keys(meta.removedIds).length === 0) delete meta.removedIds;
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
      // OAuth registrations may still be exposed by an older shell adapter,
      // but the shared port is the final policy boundary for every platform.
      const listed = await readCandidates(host);
      const ready = listed.ready;
      const candidates = listed.candidates.filter((candidate) =>
        isShareableSecretType(candidate.binding.secretType)
      );
      await baselineAfterLoss(meta, candidates, mark, ready);
      // The key of the marks was lost while marks of it were here: said in
      // the diagnostics, every round until an import has read the document.
      // A held conflict does not wait; it ends with that import too.
      waiting = Object.values(meta.entries).some((entry) => entry.sinceLoss) || openRemoval(meta);
      const lostRecords = Object.values(meta.entries).filter((entry) => entry.sinceLoss && !entry.held).length;
      if (lostRecords > 0) logDiagnosticCounted("settings-sync", `secrets: ${lostRecords} record(s) made with a lost mark key, restored from the shared document`);
      const forDocument = await carryRepairedKnowledge(meta, candidates, mark, ready, null);
      if (forDocument.size > 0) waiting = true;
      await carryOldKnowledge(meta, candidates, mark, ready);
      noteSlotNames(meta, candidates, ready, forDocument);
      reopenOldNames(meta, candidates);
      const currentIds = new Set(candidates.filter((c) => c.secret).map((c) => c.logicalId));
      // Every account this device KNOWS, with or without a stored secret.
      const knownIds = new Set(candidates.map((c) => c.logicalId));
      const entries: Record<string, SecretEntry> = {};
      openRemovedIds(meta, candidates);
      /** A tombstone this device knows, as it knows it. */
      const republish = (id: string, previous: SecretsPortMeta["entries"][string]) => {
        entries[id] = { entryRev: previous.entryRev, updatedAt: previous.updatedAt, deviceId: previous.deviceId, binding: previous.binding, tombstone: true };
      };

      for (const candidate of candidates) {
        if (!candidate.secret) continue;
        const hash = await pairMark(mark, candidate.binding, candidate.secret);
        const previous: SecretsPortMeta["entries"][string] | undefined = meta.entries[candidate.logicalId];
        const live = !!previous && !previous.tombstone;
        // A local conflict held here is not published while the slot holds
        // it; and a slot as it was when the key was lost goes out only after
        // an import has read the document (round twelve), then with the
        // revision and time this device knew — never one above. A slot that
        // differs from either is a password typed here: a change, above all
        // this device knew and saw.
        if (live && previous!.held === hash) continue;
        if (live && !previous!.held && previous!.sinceLoss && previous!.hash === hash) continue;
        // The revision only moves when the secret actually changed — otherwise
        // two devices would ping-pong revisions on every cycle.
        const changed = !previous || previous.tombstone || !!previous.held || previous.hash !== hash;
        const entryRev = changed || !previous ? Math.max(previous?.entryRev ?? 0, previous?.heldRev ?? 0, floorOf(meta, candidate.logicalId)) + 1 : previous.entryRev;
        const updatedAt = changed || !previous ? stamp : previous.updatedAt;
        // An unconfirmed baseline goes out just below the version it knew.
        const below = !changed && !!previous?.unconfirmed;
        entries[candidate.logicalId] = {
          entryRev,
          updatedAt: below ? justBefore(updatedAt) : updatedAt,
          deviceId: changed || !previous || below ? deviceId : previous.deviceId,
          binding: candidate.binding,
          secret: candidate.secret,
        };
        // Above a tombstone this device found for an account still here, the
        // password goes out — as this device's entry, so its to take back.
        meta.entries[candidate.logicalId] = {
          // Unchanged, the record keeps what it knew besides (the revision seen).
          ...(changed || !previous ? {} : previous),
          hash,
          entryRev,
          updatedAt,
          deviceId: below ? previous!.deviceId : entries[candidate.logicalId].deviceId,
          binding: candidate.binding,
        };
      }

      // A tombstone deletes a credential on other devices, so only an act
      // writes one: "Remove account" on this device (`retireSecret`). An
      // account that is merely gone from this device — its address repaired,
      // folded into another, taken away by the settings profile — is no
      // removal: another device may still sign in with that very password
      // (review 2026-11-25; the comparison of lists that inferred one took
      // the password of every other device on a repaired address).
      //
      // An account in lower case had ONE name until the current types (its
      // old name was its name): what removed it here also closes its old name
      // here, so a value a device on 0.8.7 writes under it later reaches no
      // other account ("Alice" beside a removed "alice"). Remembered on this
      // device only (`closedOldNames`), and only until the same account is
      // here again (`reopenOldNames`).
      const closeOldName = (binding: SecretBinding) => {
        if (!isShareableSecretType(binding.secretType) || binding.user !== binding.user.toLowerCase()) return;
        const old = canonicalSecretId({ ...binding, secretType: bridgeSecretTypeOf(binding.secretType) });
        meta.closedOldNames = { ...(meta.closedOldNames ?? {}), [old]: stamp };
      };
      const noteRemoved = (id: string, at: string, binding: SecretBinding) => {
        meta.removedIds = { ...(meta.removedIds ?? {}), [id]: { at, binding: { ...binding } } };
      };
      const tombstone = (id: string, retired: RetiredBinding) => {
        const { removedAt, ...removed } = retired;
        // The moment of the act, not of this round (review 2026-11-25, second round).
        const at = removedAt ?? stamp;
        let previous = meta.entries[id];
        // Removed before any export of this version moved the record to the
        // account's current name: what this device knew under its old name
        // is what it knew about this account (round twelve, as on main) —
        // unless another account here still goes by that old name.
        const old = bridgeIdOf(removed);
        const oldFree = !!old && !candidates.some((candidate) => bridgeIdOf(candidate.binding) === old);
        const known = old ? meta.entries[old] : undefined;
        const knownOld = !!known && !known.tombstone && isBridgeSecretType(known.binding.secretType) && oldFree;
        if (!previous && knownOld && !known!.alias) previous = { ...known!, binding: removed };
        if (currentIds.has(id)) return;
        // Whatever this device knew of the name — a tombstone of its own
        // earlier removal (the account came back), or a password — the
        // tombstone goes out one revision above it; what the document holds
        // above that is answered by the import (`RemovalState`). A name this
        // device knows nothing of (it got the account through the profile
        // and removed it at once) is only noted: the import answers the first
        // value it finds under it, so a name nobody ever published gets no
        // tombstone.
        if (!previous) {
          if (isShareableSecretType(removed.secretType)) {
            noteRemoved(id, at, removed);
            closeOldName(removed);
          }
          return;
        }
        const binding = isShareableSecretType(previous.binding.secretType) ? previous.binding : removed;
        if (!isShareableSecretType(binding.secretType)) return;
        const entryRev = Math.max(previous.entryRev, previous.heldRev ?? 0, floorOf(meta, id)) + 1;
        entries[id] = { entryRev, updatedAt: at, deviceId, binding, tombstone: true };
        meta.entries[id] = { hash: "", entryRev, updatedAt: at, deviceId, binding, tombstone: true, removal: true };
        delete meta.imported[id];
        noteRemoved(id, at, binding);
        closeOldName(binding);
        // The old place too (review 2026-11-18, X1): no updated device writes
        // there any more, so the password of a removed account stayed in it
        // for good. Only a name this device knows for this account — its own
        // record from before the update, or one it read for it — and only
        // while no other account here can mean that name (the twin rule of
        // reading, `oldNameId`).
        if (knownOld) {
          const oldRev = known!.entryRev + 1;
          entries[old!] = { entryRev: oldRev, updatedAt: at, deviceId, binding: known!.binding, tombstone: true };
          const { alias: _alias, moved: _moved, ...rest } = known!;
          meta.entries[old!] = { ...rest, hash: "", entryRev: oldRev, updatedAt: at, deviceId, tombstone: true, removal: true };
          noteRemoved(old!, at, known!.binding);
        }
      };
      // The profile took the account away (removed elsewhere — said by the
      // profile import, never read from a list): what this device published
      // for it itself (above a tombstone too), or carried by a repair (`moved`), is taken back with
      // a tombstone one revision above it — under its name, and under every
      // earlier address of the same user that no account here has any more
      // (an address repaired before writes nothing under the old name, so its
      // password would stay for good). A password this device only took from
      // the sync is the publisher's to take back.
      const restore = (left: SecretBinding) => {
        for (const [id, previous] of Object.entries(meta.entries)) {
          if (previous.tombstone || knownIds.has(id) || !isShareableSecretType(previous.binding.secretType) || previous.binding.secretType !== left.secretType) continue;
          if (!bindingMatchesExceptFamily({ ...previous.binding, endpoint: left.endpoint }, left, "fold")) continue;
          if (!previous.moved && previous.deviceId !== deviceId) continue;
          const entryRev = previous.entryRev + 1;
          entries[id] = { entryRev, updatedAt: stamp, deviceId, binding: previous.binding, tombstone: true };
          const { moved: _moved, ...rest } = previous;
          meta.entries[id] = { ...rest, hash: "", entryRev, updatedAt: stamp, deviceId, tombstone: true };
        }
      };
      // The first export on a record of a version that told a removal by
      // comparing lists (`notesRemovals`) writes what that version would
      // have written in its next round: a mailbox removed on 0.9.0 wrote no
      // note, and the app may update before its next round (review
      // 2026-11-26, fourth round, S1). The tombstone of an absence, as that
      // version wrote it (fifth round, U2); not for a repaired address
      // (review 2026-11-25).
      if (!meta.notesRemovals) {
        for (const id of inferPendingRemovals(meta, candidates, knownIds, ready, read)) {
          const previous = meta.entries[id]!;
          const entryRev = previous.entryRev + 1;
          entries[id] = { entryRev, updatedAt: stamp, deviceId, binding: previous.binding, tombstone: true };
          const { moved: _moved, ...rest } = previous;
          meta.entries[id] = { ...rest, hash: "", entryRev, updatedAt: stamp, deviceId, tombstone: true };
          closeOldName(previous.binding);
        }
      }
      const takenBack: SecretBinding[] = [];
      for (const [id, removed] of Object.entries(meta.retired ?? {})) {
        // A list that may not be whole yet cannot say the account is gone.
        if (!ready(removed.service)) continue;
        delete meta.retired![id];
        if (knownIds.has(id)) {
          // Removed and added again before a round — or another account of
          // that user repaired onto the name: an account new here, its slot
          // holds nothing the sync left. Empty, it stays empty, as on 0.9.0;
          // a newer password from elsewhere still reaches it (seventh round,
          // H2: no removed account gets its password back).
          const here = candidates.find((candidate) => candidate.logicalId === id);
          const record = meta.entries[id];
          if (here && !here.secret && record && !record.tombstone) meta.entries[id] = { ...record, hash: await pairMark(mark, record.binding, null) };
          continue;
        }
        const { withProfile: _w, removedAt: _r, ...left } = removed;
        if (!removed.withProfile) tombstone(id, removed);
        takenBack.push(left);
      }
      // "Remove account" — or the profile's removal — also takes back what
      // this device published for the account under an earlier address; after
      // every removal of the round, so an earlier address removed in the same
      // round gets its own tombstone, not one above a taking back (review
      // 2026-11-27, sixth round, the comparison with 0.9.0).
      for (const left of takenBack) restore(left);
      if (meta.retired && Object.keys(meta.retired).length === 0) delete meta.retired;

      // Every tombstone this device knows goes out again as it is — the
      // shared document has it, and a device that left it out would import
      // every round. Of the old types only the ones "Remove account" wrote
      // here (`removal`); an entry of an old type is otherwise never written.
      for (const [id, previous] of Object.entries(meta.entries)) {
        if (!previous.tombstone || entries[id] || currentIds.has(id) || previous.alias) continue;
        if (!isShareableSecretType(previous.binding.secretType) && !(previous.removal && isBridgeSecretType(previous.binding.secretType))) continue;
        republish(id, previous);
      }

      // A removal written in this round is open: the document is read for it.
      // ...and so is a slot that waits for the document (`sinceLoss`, a carry without a version).
      waiting ||= openRemoval(meta) || Object.values(meta.entries).some((entry) => entry.sinceLoss);
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
      const { candidates, ready } = await readCandidates(host);
      await baselineAfterLoss(meta, candidates, mark, ready);
      const key = await settledKey(mark, bundle, candidates);
      const afterLoss = Object.values(meta.entries).some((entry) => entry.sinceLoss);
      if (meta.settled === key && !sealed && !afterLoss) return { ...emptyImportResult(), settled: true };
      const byId = new Map(candidates.map((candidate) => [candidate.logicalId, candidate]));
      const operations: Array<{
        logicalId: string;
        entry: SecretEntry;
        candidate: LocalSecretCandidate;
        viaOldName: boolean;
      }> = [];
      const result = emptyImportResult();
      // Something that waits for a whole list leaves the import open, so the
      // next import, on a whole list, is not skipped (`settledKey`; review
      // 2026-11-27, sixth round, rule L3): a carry of a repaired slot, or an
      // old name of a kind whose list may not be whole.
      let notWhole = candidates.some((candidate) => !ready(candidate.binding.service) && carryWaits(meta, candidate));
      await carryRepairedKnowledge(meta, candidates, mark, ready, bundle);
      await carryOldKnowledge(meta, candidates, mark, ready);
      noteSlotNames(meta, candidates, ready);
      reopenOldNames(meta, candidates);
      openRemovedIds(meta, candidates);
      const closedOldName = (id: string) => !!meta.oldNameTombstones?.[id] || !!meta.closedOldNames?.[id];
      // A tombstone this device knows under an old name stops values under
      // it — except its own one from "Remove account" once that account is
      // here again (`removedIds` opened): a value written there since is that
      // account's.
      const tombstonedName = (id: string) => meta.entries[id]?.tombstone === true && !(meta.entries[id].removal && !meta.removedIds?.[id]);
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
        // The slot as it was when the key was lost (`baselineAfterLoss`):
        // taken as unchanged, as on a device whose key is whole.
        const atLoss = !!previous && !previous.tombstone && !!(previous.sinceLoss || previous.unconfirmed) && !previous.held;
        const order = previous ? compareEntryVersion(entry, previous) : 1;
        // A removal this device wrote (`RemovalState`, the rules in
        // docs/engineering/Secrets_Removal_Rules.md): decided by revisions and
        // by whether this device has seen its tombstone in the document —
        // never by comparing two times.
        const removal = meta.removedIds?.[logicalId];
        if (removal && !removal.yielded) {
          const own = previous?.tombstone && previous.removal ? previous : undefined;
          if (!own && !previous && isShareableSecretType(entry.binding.secretType)) {
            // Only noted (this device knew nothing of the name): the first value gets the tombstone.
            if (entry.tombstone) {
              removal.confirmed = true;
            } else {
              meta.entries[logicalId] = { hash: "", entryRev: entry.entryRev + 1, updatedAt: removal.at, deviceId: await host.deviceId(), binding: entry.binding, tombstone: true, removal: true };
              recordImportResult(result, logicalId, "unchanged", "removed-here");
              continue;
            }
          } else if (own) {
            if (entry.tombstone ? order >= 0 : order === 0) {
              removal.confirmed = true;
            } else if (!entry.tombstone && order > 0) {
              // At the tombstone's revision (won the tie): written without it
              // in view. Above it: so too while the tombstone was never the
              // document's entry here; after that, written with it in view.
              if (entry.entryRev <= own.entryRev || !removal.confirmed) {
                meta.entries[logicalId] = { ...own, entryRev: entry.entryRev + 1 };
                recordImportResult(result, logicalId, "unchanged", "removed-here");
                continue;
              }
              removal.yielded = true;
            }
          }
        }
        if (previous) {
          if (order < 0) {
            recordImportResult(result, logicalId, "stale", "older-entry");
            continue;
          }
          if (order === 0) {
            const hash = await entryHash(mark, entry);
            // An empty slot here has the mark of no secret: the entry it came
            // with is the same entry, the slot simply holds nothing.
            const same =
              previous.hash === hash ||
              (!previous.tombstone && !entry.tombstone && previous.hash === (await pairMark(mark, previous.binding, null)));
            const emptyAtLoss = atLoss && !entry.tombstone && previous.hash === (await pairMark(mark, (byId.get(logicalId) ?? previous).binding, null));
            if (emptyAtLoss) {
              // An empty slot after a lost key (a device moved without its
              // keychain) takes the password of the version it knew.
            } else if (same && Boolean(previous.tombstone) === Boolean(entry.tombstone)) {
              // The document has the version this device knew, with what it holds: confirmed.
              if (previous.unconfirmed || previous.sinceLoss) {
                const { unconfirmed: _u, sinceLoss: _s, ...rest } = previous;
                meta.entries[logicalId] = rest;
              }
              // ...unless the slot of the account here was emptied outside
              // this port (the keychain entry deleted, "Stored access" of a
              // vault no longer listed, which is opened again later) and is
              // not signed out: the password in the document reaches every
              // device that has the account (review 2026-11-26, fourth round,
              // H1). It is read in below like any other.
              const here = byId.get(logicalId);
              const emptied = !entry.tombstone && !!here && !here.secret && !here.signedOutHere && previous.hash !== (await pairMark(mark, here.binding, null));
              if (!emptied) {
                recordImportResult(result, logicalId, "unchanged", "already-current");
                continue;
              }
            } else if (atLoss) {
              // The same version with another password than the slot holds
              // after a lost key: held here, neither overwritten nor
              // published (round twelve).
              meta.entries[logicalId] = { ...previous, held: previous.hash, heldRev: Math.max(previous.heldRev ?? 0, entry.entryRev) };
              recordImportResult(result, logicalId, "rejected", "local-secret-conflict");
              continue;
            } else {
              recordImportResult(result, logicalId, "rejected", "version-collision");
              continue;
            }
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
        // Which account an old name means — the one of two that differ only
        // in case, or none — is read from the whole list: on one that may not
        // be whole the other may be the one left out (review 2026-11-27,
        // sixth round, M4). Such an entry waits.
        const oldNameOf = exactCandidate ? bridgeIdOf(exactCandidate.binding) : null;
        if (!ready(entry.binding.service) && (bridged || (oldNameOf && bundle.entries[oldNameOf]))) {
          notWhole = true;
          recordImportResult(result, logicalId, "unchanged", "list-not-whole");
          continue;
        }
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
          const retiredName = tombstonedName(logicalId) || closedOldName(logicalId);
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
        const oldName = exactCandidate ? oldNameId(exactCandidate, candidates, ready) : null;
        const oldEntry = oldName ? bundle.entries[oldName] : undefined;
        if (
          oldEntry && isBridgeSecretType(oldEntry.binding.secretType) && !oldEntry.tombstone &&
          !tombstonedName(oldName!) && !closedOldName(oldName!) &&
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

        // An entry for no account listed here, of a kind whose list may not
        // be whole: nothing is decided from it — not remembered, not reported
        // as waiting — until a round whose list is (`ListsReady`).
        if (!candidate && !ready(entry.binding.service)) {
          notWhole = true;
          recordImportResult(result, logicalId, "unchanged", "list-not-whole");
          continue;
        }
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
          // Not waiting either: the password of an account that was on this
          // device and is gone (its record is here), or of an address an
          // account here no longer has — the same user, the same kind, on
          // another server. Since nothing infers a removal any more (review
          // 2026-11-25), a repaired address leaves its old entry in the
          // document; it is no account this device still has to receive.
          // It is read as soon as an account here has that address.
          const removedHere = Object.values(meta.removedIds ?? {}).some(
            (state) => !!state.binding && bindingMatchesExceptFamily({ ...entry.binding, endpoint: state.binding.endpoint }, state.binding, "fold"),
          );
          // …or of the same user and service as a password this device has a record of, under another address.
          const knownUser = Object.values(meta.entries).some(
            (record) => !record.alias && bindingMatchesExceptFamily({ ...entry.binding, endpoint: record.binding.endpoint }, record.binding, "fold"),
          );
          const elsewhereHere =
            !!previous ||
            removedHere ||
            knownUser ||
            candidates.some(
              (item) =>
                sameType(item) &&
                bindingMatchesExceptFamily({ ...entry.binding, endpoint: item.binding.endpoint }, item.binding, bridged ? "fold" : "exact"),
            );
          if (elsewhereHere && !direct) {
            recordImportResult(result, logicalId, "unchanged", "address-changed-here");
            continue;
          }
          if (!waitsWithCurrent) result.unknownAccounts.push(logicalId);
          recordImportResult(
            result,
            logicalId,
            "rejected",
            direct ? "binding-mismatch" : "unknown-account",
          );
          continue;
        }

        // A tombstone never empties the slot of an account that is still on
        // this device (review 2026-11-25). The account leaves a device with
        // the settings profile, which takes its slot along; a tombstone for
        // an account still here is another device's view — a device on 0.9.0
        // or 0.8.7 still writes one for an address it repaired, and applied,
        // it took a working password. It is remembered, and the password this
        // device holds goes out above it at its next export, as its own.
        if (entry.tombstone) {
          await rememberEntry(logicalId, entry);
          // What the slot holds now is what the sync left in it (rule R, `slotLeft`).
          meta.entries[logicalId] = { ...meta.entries[logicalId]!, slotMark: await pairMark(mark, entry.binding, candidate.secret) };
          recordImportResult(result, logicalId, "unchanged", candidate.secret ? "account-still-here" : "tombstone-no-local-secret");
          continue;
        }
        // Signed out on this device: a password from elsewhere does not sign
        // it in again. Seen, not taken — a sign-in here goes out above it.
        if (candidate.signedOutHere) {
          if (previous && !previous.tombstone && entry.entryRev > (previous.heldRev ?? 0)) {
            meta.entries[logicalId] = { ...meta.entries[logicalId]!, heldRev: entry.entryRev };
          }
          recordImportResult(result, logicalId, "unchanged", "signed-out-here");
          continue;
        }
        // A password typed here and never received through the sync is not
        // replaced from elsewhere; one that came through the sync follows.
        if (!entry.tombstone && candidate.secret && !pairImported) {
          if (stableStringify(candidate.secret) !== stableStringify(entry.secret)) {
            // Seen and not taken: a password typed here later goes out above
            // it — after a lost key, beside a held slot, or beside this
            // device's own password (round twelve; F73).
            if (previous && entry.entryRev > (previous.heldRev ?? 0)) {
              meta.entries[logicalId] = { ...meta.entries[logicalId]!, heldRev: entry.entryRev };
            }
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
          // Only values come here: a tombstone never empties a slot (above).
          await host.writeSlot(candidate.slot, candidate.apply(entry.secret!));
          // A carry that waits for a whole list takes nothing away the import
          // found under the new name since (seventh round, S2): the slot holds
          // the document's password of that name now. The floor of the old
          // name still goes along; the note follows the slot.
          if (!viaOldName && logicalId === candidate.logicalId && carryWaits(meta, candidate)) noteCarriedFloor(meta, candidate);
          meta.imported[logicalId] = true;
          // Read under its old name (`oldNameId`): the account's exact name was written with it.
          if (viaOldName) meta.imported[candidate.logicalId] = true;
          await rememberEntry(logicalId, entry, viaOldName);
          if (viaOldName) await recordCurrent(candidate, entry);
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
      const open = notWhole || result.errors.length > 0 || result.unknownAccounts.length > 0 || result.legacyEntries.length > 0;
      // Taken against the slots as they are now: what this import wrote is the
      // state the next round finds.
      const settled = open ? undefined : successfulSlots.size > 0 ? await settledKey(mark, bundle, await host.candidates()) : key;
      if (meta.settled !== settled) {
        if (settled) meta.settled = settled;
        else delete meta.settled;
      }
      // The loss ends with this import, which read the document (round
      // twelve): what is held stays held, an ordinary local conflict; a
      // baseline the document has nothing as new for is unconfirmed.
      for (const [id, record] of Object.entries(meta.entries)) {
        if (!record.sinceLoss) continue;
        const { sinceLoss: _ended, ...rest } = record;
        const entry = bundle.entries[id];
        const unconfirmed = !record.held && !record.tombstone && (!entry || compareEntryVersion(entry, record) < 0);
        meta.entries[id] = unconfirmed ? { ...rest, unconfirmed: true } : rest;
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
