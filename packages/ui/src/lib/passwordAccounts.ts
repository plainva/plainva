import { trimEndChars } from "@plainva/core";
import {
  CONFIRMED_ACCESS_KEY,
  carriesConfirmedAccess,
  confirmedAccessOf,
  overlayConfirmedAccess,
  withOwnConfirmedAccess,
  withoutOwnConfirmedAccess,
  type ConfirmedAccess,
  type PimAccountRow,
} from "@plainva/core";
import type { CloudAccountRecord } from "./cloudAccounts.js";

/**
 * What makes two accesses with a password (WebDAV, CalDAV, Nextcloud) the same
 * account (GitHub issue 174, Fehlerliste C13, C14; decided 2026-11-16, the user rule
 * after review the same day).
 *
 * A sign-in with a password carries no identity a provider vouches for, so
 * nothing ever matched one: every successful connect added a second calendar
 * row beside the first, and a second device that spelled the address a little
 * differently got a row of its own without a password.
 *
 * Merged is only what is PROVEN to be one account — untidy is acceptable, wrong
 * is not, because a merge moves a password onto the other row:
 *
 * A row is reached through one or more ACCESSES: its own address and user,
 * and the access each device confirmed for it (`confirmedAccess`, recorded on
 * connect and on every successful fetch, one entry per device — one Nextcloud
 * can be the public name on one device and the LAN address on another). Two
 * rows are one account when one access of each is, and two accesses are:
 *
 * 1. When both carry the principal the server confirmed: the same principal is
 *    the same account, another is another. The server decides, so "Anna" and
 *    "anna" are one account on a Nextcloud, which signs in without regard to
 *    case, and two on Radicale or Baïkal, which do not.
 * 2. Otherwise the address and the user: the user exactly as typed (only
 *    trimmed), the address normalized as below.
 *
 * Folded together in the address, because they cannot name two servers:
 * - scheme and host in any case, a default port written out (443 for https,
 *   80 for http), slashes at the end;
 * - the DAV endpoint of Nextcloud and ownCloud, `/remote.php/…` in any of its
 *   spellings (`dav`, `dav/`, `dav/files/<user>/…`, `dav/calendars/<user>/`,
 *   `caldav`, `webdav`): the account is the installation, not the endpoint a
 *   service of it was connected to — the files and the calendar of one
 *   Nextcloud are one account.
 *
 * Kept apart, because they may be two servers: another scheme (`http` and
 * `https` can be served by different hosts behind one name), another port, and
 * another path before the endpoint (`/nextcloud` beside the root), the path in
 * its case. An address that cannot be read — no scheme, not http(s), a user or
 * password inside it, a query — has no identity: such an access is never
 * merged, which is the old behaviour, untidy but never wrong.
 *
 * The settings sync names a password by its own rule (`canonicalSecretId`):
 * the user exactly, the path in full. It never joins two servers this rule
 * keeps apart (`passwordAccounts.test.ts` pins that).
 */
export function passwordAccountIdentity(url: unknown, user: unknown): string | null {
  if (typeof user !== "string") return null;
  const name = user.trim();
  if (!name) return null;
  const address = normalizedAddress(url, true);
  return address === null ? null : `${address}\u0000${name}`;
}

/** The principal the server confirmed, normalized like an address but with its path intact; null when unusable. */
export function confirmedPrincipalKey(principal: unknown): string | null {
  return normalizedAddress(principal, false);
}

function normalizedAddress(url: unknown, foldEndpoint: boolean): string | null {
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.search) return null;
  // `URL` lower-cases scheme and host and drops a default port already.
  const pathname = foldEndpoint ? parsed.pathname.replace(/\/remote\.php(\/.*)?$/i, "") : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${trimEndChars(pathname, "/")}`;
}

/** What the rule reads of a calendar row. */
export interface PasswordRowLike {
  provider: string;
  config?: Record<string, unknown>;
}

/** One password access as the rule reads it. */
export interface PasswordAccess {
  url: unknown;
  user: unknown;
  principal?: unknown;
}

/** Whether two password accesses are proven to be the same account (the rule above). */
export function samePasswordAccount(a: PasswordAccess, b: PasswordAccess): boolean {
  const principalA = confirmedPrincipalKey(a.principal);
  const principalB = confirmedPrincipalKey(b.principal);
  if (principalA && principalB) return principalA === principalB;
  const identity = passwordAccountIdentity(a.url, a.user);
  return identity !== null && identity === passwordAccountIdentity(b.url, b.user);
}

/**
 * Every access a calendar row is reached through — its own address and user
 * first, then each device's confirmed one — or [] when it has none (OAuth,
 * device).
 */
export function pimPasswordAccesses(row: PasswordRowLike): PasswordAccess[] {
  if (row.provider !== "caldav") return [];
  const own: PasswordAccess = { url: row.config?.url, user: row.config?.user };
  return [own, ...Object.values(confirmedAccessOf(row.config)).map((access) => ({ ...access }))];
}

/** Whether a row has any access the rule can read. */
function hasReadableAccess(row: PasswordRowLike): boolean {
  return pimPasswordAccesses(row).some((access) => passwordAccountIdentity(access.url, access.user) || confirmedPrincipalKey(access.principal));
}

/** Whether two calendar rows are proven to be the same password account (one access of each is). */
export function samePimPasswordAccount(
  a: PasswordRowLike,
  b: PasswordRowLike,
): boolean {
  const accessesA = pimPasswordAccesses(a);
  const accessesB = pimPasswordAccesses(b);
  return accessesA.some((x) => accessesB.some((y) => samePasswordAccount(x, y)));
}

/** Whether a calendar row is reached through this access (a connect looking for its row). */
export function pimRowHasAccess(row: PasswordRowLike, access: PasswordAccess): boolean {
  return pimPasswordAccesses(row).some((x) => samePasswordAccount(x, access));
}

/**
 * The config of a row a fresh connect is adopted into: the row's own, with the
 * fresh connect's fields on top — and the confirmed accesses of both, the
 * fresh one's own entry winning. Spreading the fresh config over the row
 * dropped every other device's entry.
 */
export function adoptedPimConfig(target: Record<string, unknown> | undefined, fresh: Record<string, unknown> | undefined): Record<string, unknown> {
  const access = overlayConfirmedAccess(confirmedAccessOf(target), confirmedAccessOf(fresh));
  const out: Record<string, unknown> = { ...target, ...fresh };
  if (Object.keys(access).length || carriesConfirmedAccess(target) || carriesConfirmedAccess(fresh)) out[CONFIRMED_ACCESS_KEY] = access;
  else delete out[CONFIRMED_ACCESS_KEY];
  return out;
}

/**
 * For `updateAccountConfigValue(…, CONFIRMED_ACCESS_KEY, …)` on "Sign out on
 * this device" (review 2026-11-18): this device's entry goes, every other
 * device's stays; no write when there is none.
 */
export function droppingOwnConfirmedAccess(deviceId: string | null | undefined): (current: unknown) => unknown {
  return (current) => {
    const map = confirmedAccessOf({ [CONFIRMED_ACCESS_KEY]: current });
    if (!deviceId || !map[deviceId]) return undefined;
    return withoutOwnConfirmedAccess(map, deviceId);
  };
}

/** This device's confirmed access as a config fragment for a fresh row: `{ confirmedAccess: { [device]: access } }`. */
export function ownConfirmedAccessConfig(deviceId: string | null | undefined, access: ConfirmedAccess | undefined): Record<string, unknown> {
  if (!deviceId || !access) return {};
  return { [CONFIRMED_ACCESS_KEY]: withOwnConfirmedAccess({}, deviceId, access) };
}

/**
 * The address-and-user key of a calendar row (rule 2 alone), or null. A key for
 * sorting and for a comparison with a file access, which has no principal;
 * whether two ROWS are one account is `samePimPasswordAccount`.
 */
export function pimPasswordIdentity(row: PasswordRowLike): string | null {
  if (row.provider !== "caldav") return null;
  return passwordAccountIdentity(row.config?.url, row.config?.user);
}

/**
 * Among calendar rows of one password account, the one a fresh connect is
 * ADOPTED INTO (`accountToAdoptInto`): the row the card being connected
 * already binds, when it is one of them (`prefer`; both shells pass it, see
 * `adoptPreferenceForCard`), else the lowest id — deterministic, so two
 * devices reading the same list reach the same answer.
 */
export function passwordRowToAdoptInto<T extends { id: string; provider: string; config?: Record<string, unknown> }>(
  rows: readonly T[],
  fresh: { id: string; provider: string; config?: Record<string, unknown> },
  prefer?: string,
): T | null {
  if (fresh.provider !== "caldav") return null;
  const matches = rows.filter((row) => row.id !== fresh.id && samePimPasswordAccount(row, fresh));
  if (matches.length === 0) return null;
  return matches.find((row) => row.id === prefer)
    ?? [...matches].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/**
 * The row a connect started from a card should prefer to adopt into: the
 * calendar row that card binds. One answer for both shells, so a reconnect at
 * a card lands in that card's row on the desktop and on the phone alike.
 */
export function adoptPreferenceForCard(cards: readonly CloudAccountRecord[], cardId: string | null | undefined): string | undefined {
  if (!cardId) return undefined;
  return cards.find((card) => card.id === cardId)?.services.calendar?.pimAccountId;
}

/** Groups calendar rows into password accounts (`samePimPasswordAccount`), keeping rows without one out. */
export function passwordAccountGroups<T extends PasswordRowLike & { id: string }>(rows: readonly T[]): T[][] {
  const access = rows.filter(hasReadableAccess);
  const parent = access.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < access.length; i++) {
    for (let j = i + 1; j < access.length; j++) {
      if (samePimPasswordAccount(access[i], access[j])) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  access.forEach((row, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), row]));
  return [...groups.values()];
}

/** What the plan needs to know about a calendar row beyond the row itself. */
export interface PasswordRowFacts {
  /** Whether this device holds a sign-in for the row. A slot that could not be read counts as held. */
  hasCredentials: boolean;
  /** Whether the row holds anything of its own here: calendars or task lists it fetched. */
  hasCachedData: boolean;
}

/**
 * Which duplicate calendar rows may go without asking anybody (decided
 * 2026-11-16): only a row that carries nothing — no sign-in on this device,
 * nothing it fetched, and no card that binds it to anything but its calendar —
 * and only beside another row of the same password identity, which stays.
 *
 * Such a row is what issue 174 left behind: the settings of another device brought
 * the account under a spelling this device did not recognize, and it sat there
 * as a card that "cannot connect". Removing it loses nothing: the account it
 * names is here under the row that stays, and the next import of the other
 * device's settings finds that row by the same identity.
 *
 * Everything else stays as it is: two rows that each have a sign-in, or one
 * with calendars, a task list or a card with other services, go through the
 * guided repair, where a person picks what survives. When every row of a group
 * is empty, the one a card with the most services binds stays (then the lowest
 * id), so one is always left.
 */
export function planEmptyPasswordDuplicates(
  rows: readonly Pick<PimAccountRow, "id" | "provider" | "config">[],
  cards: readonly CloudAccountRecord[],
  facts: (rowId: string) => PasswordRowFacts,
): string[] {
  const cardsOf = (rowId: string) => cards.filter((card) => card.services.calendar?.pimAccountId === rowId);
  const servicesOf = (card: CloudAccountRecord) =>
    (card.services.files ? 1 : 0) + (card.services.calendar ? 1 : 0) + (card.services.mail ? 1 : 0);
  const empty = (rowId: string) => {
    const known = facts(rowId);
    if (known.hasCredentials || known.hasCachedData) return false;
    return cardsOf(rowId).every((card) => !card.services.files && !card.services.mail);
  };
  const removed: string[] = [];
  for (const group of passwordAccountGroups(rows)) {
    const ids = group.map((row) => row.id);
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const removable = sorted.filter(empty);
    if (removable.length === 0) continue;
    let keep: string | undefined = sorted.find((id) => !removable.includes(id));
    if (!keep) {
      const weight = (id: string) => Math.max(0, ...cardsOf(id).map(servicesOf));
      keep = [...removable].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))[0];
    }
    removed.push(...removable.filter((id) => id !== keep));
  }
  return removed.sort();
}

/** What removing empty duplicates needs from a shell: its calendar cache, its cards and its sign-ins. */
export interface EmptyPasswordDuplicatePorts {
  listAccounts(): Promise<PimAccountRow[]>;
  listCalendars(accountId: string): Promise<readonly unknown[]>;
  listTaskLists(accountId: string): Promise<readonly unknown[]>;
  deleteAccount(accountId: string): Promise<void>;
  listCards(): Promise<CloudAccountRecord[]>;
  /** Whether a sign-in is stored for the row. Throwing counts as "yes". */
  hasCredentials(accountId: string): Promise<boolean>;
}

/**
 * Removes the rows `planEmptyPasswordDuplicates` names, on this device only.
 *
 * Deliberately no deletion mark for the settings sync: the row names an account
 * another device holds with its sign-in, and a deletion mark would take it
 * from there. Each row is checked once more right before it goes, so a connect
 * that signed it in meanwhile keeps it; the shells run this in the same lane
 * as a calendar connect, which closes the rest of that window.
 */
export async function removeEmptyPasswordDuplicates(ports: EmptyPasswordDuplicatePorts): Promise<string[]> {
  const rows = await ports.listAccounts();
  const candidates = rows.filter((row) => row.provider === "caldav");
  if (candidates.length < 2) return [];
  const facts = new Map<string, PasswordRowFacts>();
  for (const row of candidates) facts.set(row.id, await rowFacts(ports, row.id));
  const plan = planEmptyPasswordDuplicates(candidates, await ports.listCards(), (id) => facts.get(id) ?? { hasCredentials: true, hasCachedData: true });
  const removed: string[] = [];
  for (const id of plan) {
    const now = await rowFacts(ports, id);
    if (now.hasCredentials || now.hasCachedData) continue;
    await ports.deleteAccount(id);
    removed.push(id);
  }
  return removed;
}

async function rowFacts(ports: EmptyPasswordDuplicatePorts, id: string): Promise<PasswordRowFacts> {
  const hasCredentials = await ports.hasCredentials(id).catch(() => true);
  const calendars = await ports.listCalendars(id).catch(() => null);
  const lists = await ports.listTaskLists(id).catch(() => null);
  return { hasCredentials, hasCachedData: !calendars || !lists || calendars.length > 0 || lists.length > 0 };
}
