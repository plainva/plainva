import i18n from "../i18n";
import { errorText } from "./errorText";
import { reportVisible } from "../services/backgroundErrors";
import type { ISettingsStore } from "../platform/settings.js";

/**
 * Sign-ins "Remove account" could not delete, owed until they are gone
 * (maintainer, 2026-11-17).
 *
 * Removing an account takes the card out of the vault even when deleting its
 * sign-in fails — a keychain that refuses, a token store that is locked. The
 * sign-in stayed on the device, keyed by the card's id. A later connect of the
 * same account makes a new card and never found it, so it lingered unseen; and
 * if the same card came back through the settings of another device that had
 * not yet seen the removal, it came back signed in. After "Remove account" no
 * usable sign-in may remain on the device.
 *
 * So the deletion is OWED: written down per vault in this device's settings
 * (never in the synced profile — another device's sign-in is not this one's
 * to delete), tried again when the vault opens and before every new sign-in,
 * and forgotten once it succeeded. While it is owed the card counts as not
 * signed in here, whatever the slot still holds (`isSignInDeletionOwed`): the
 * owed deletion wins until somebody signs the card in again on this device
 * (`forgiveSignInDeletion`), and a sign-in written then is never deleted by
 * the old debt. A deletion that keeps failing is said again once per session,
 * not on every attempt.
 */

export interface OwedSignInDeletion {
  /** The card whose sign-in is owed; the shell knows its slot names (current and old). */
  cardId: string;
  /** When the removal first failed to delete it. */
  since: string;
}

export interface OwedSignInResources {
  /** This device's settings store. */
  store: ISettingsStore;
  /** The key the vault's list lives under; never a synced setting. */
  storeKey: string;
  /**
   * Deletes the card's sign-in in every name it has had, under the card's
   * credential lock and only while the deletion is still owed
   * (`isSignInDeletionOwed`) — a sign-in that forgave the debt under the same
   * lock is never taken. Throws when it cannot.
   */
  deleteSignIn(cardId: string): Promise<void>;
  /** Injectable for tests. */
  now?(): string;
}

/** Which debts have been said in this session, per list. */
const said = new Set<string>();

function valid(value: unknown): OwedSignInDeletion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is OwedSignInDeletion =>
    !!entry && typeof entry === "object" && typeof (entry as OwedSignInDeletion).cardId === "string" && !!(entry as OwedSignInDeletion).cardId
      && typeof (entry as OwedSignInDeletion).since === "string");
}

async function load(resources: OwedSignInResources): Promise<OwedSignInDeletion[]> {
  return valid(await resources.store.get<unknown>(resources.storeKey));
}

async function persist(resources: OwedSignInResources, list: OwedSignInDeletion[]): Promise<void> {
  if (list.length) await resources.store.set(resources.storeKey, list);
  else await resources.store.delete(resources.storeKey);
  await resources.store.save();
}

function say(resources: OwedSignInResources, cardId: string, error: unknown): void {
  const key = `${resources.storeKey}\u0000${cardId}`;
  if (said.has(key)) return;
  said.add(key);
  reportVisible("account:grant", error, i18n.t("errors.background.accountSignInKept", { reason: errorText(error) }));
}

/** Writes the card's deletion down as owed, and says once that the sign-in is still here. */
export async function oweSignInDeletion(resources: OwedSignInResources, cardId: string, error: unknown): Promise<void> {
  // A debt of a card already on the list is a new one: it takes the new
  // moment, so a retry that started before it cannot take it off.
  const since = resources.now ? resources.now() : new Date().toISOString();
  const list = (await load(resources)).filter((entry) => entry.cardId !== cardId);
  list.push({ cardId, since });
  await persist(resources, list);
  say(resources, cardId, error);
}

/** Whether the card's sign-in is owed a deletion here: then it is not signed in, whatever its slot holds. */
export async function isSignInDeletionOwed(resources: Pick<OwedSignInResources, "store" | "storeKey">, cardId: string): Promise<boolean> {
  // A list that cannot be read owes nothing: every sign-in of the device
  // would otherwise stop working with the settings store, for a rare case.
  try {
    return valid(await resources.store.get<unknown>(resources.storeKey)).some((entry) => entry.cardId === cardId);
  } catch {
    return false;
  }
}

/** A new sign-in of the card on this device: the old debt must not take it. */
export async function forgiveSignInDeletion(resources: OwedSignInResources, cardId: string): Promise<void> {
  const list = await load(resources);
  if (!list.some((entry) => entry.cardId === cardId)) return;
  await persist(resources, list.filter((entry) => entry.cardId !== cardId));
}

/**
 * Tries every owed deletion once more. One that succeeds is forgotten without
 * a word; one that fails stays and is said, once per session. Returns the
 * cards still owed.
 */
export async function settleOwedSignInDeletions(resources: OwedSignInResources): Promise<string[]> {
  const list = await load(resources);
  if (!list.length) return [];
  const left: OwedSignInDeletion[] = [];
  for (const entry of list) {
    try {
      await resources.deleteSignIn(entry.cardId);
    } catch (error) {
      left.push(entry);
      say(resources, entry.cardId, error);
    }
  }
  // Read again before writing: a sign-in that forgave a card meanwhile wins,
  // and a debt written meanwhile — the same card removed again while this ran
  // (review 2026-11-18) — is a new one: only the very entry that was deleted
  // here, card AND moment, is taken off.
  const now = await load(resources);
  const settled = (entry: OwedSignInDeletion) =>
    list.some((l) => l.cardId === entry.cardId && l.since === entry.since) && !left.some((l) => l.cardId === entry.cardId && l.since === entry.since);
  const still = now.filter((entry) => !settled(entry));
  if (still.length !== now.length) await persist(resources, still);
  return still.map((entry) => entry.cardId);
}

/** For tests: forget which debts were said this session. */
export function resetOwedSignInReports(): void {
  said.clear();
}
