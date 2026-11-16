import { trimEndChars } from "@plainva/core";
import type { PimAccountRow } from "@plainva/core";
import type { CloudAccountRecord } from "./cloudAccounts.js";

/**
 * What makes two accesses with a password (WebDAV, CalDAV, Nextcloud) the same
 * account: the server and the user, normalized (GitHub issue 174, Fehlerliste C13,
 * C14; decided 2026-11-16).
 *
 * A sign-in with a password carries no identity the provider vouches for, so
 * nothing ever matched one: every successful connect added a second calendar
 * row beside the first, and a second device that spelled the address a little
 * differently got a row of its own without a password. The address and the
 * user are what decide where a password is sent, so they are what names the
 * account.
 *
 * Folded together, because they cannot name two servers:
 * - scheme and host in any case, a default port written out (443 for https,
 *   80 for http), slashes at the end;
 * - the DAV endpoint of Nextcloud and ownCloud, `/remote.php/…` in any of its
 *   spellings (`dav`, `dav/`, `dav/files/<user>/…`, `dav/calendars/<user>/`,
 *   `caldav`, `webdav`): the account is the installation, not the endpoint a
 *   service of it was connected to — the files and the calendar of one
 *   Nextcloud are one account;
 * - the user in any case (Nextcloud signs in without regard to it, and the
 *   settings sync has always compared it so).
 *
 * Kept apart, because they may be two servers: another scheme (`http` and
 * `https` can be served by different hosts behind one name), another port, and
 * another path before the endpoint (`/nextcloud` beside the root), the path in
 * its case. An address that cannot be read — no scheme, not http(s), a user or
 * password inside it, a query — has no identity: such an access is never
 * merged, which is the old behaviour, untidy but never wrong.
 */
export function passwordAccountIdentity(url: unknown, user: unknown): string | null {
  if (typeof url !== "string" || typeof user !== "string") return null;
  const name = user.trim().toLowerCase();
  if (!name) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.search) return null;
  // `URL` lower-cases scheme and host and drops a default port already.
  const path = trimEndChars(parsed.pathname.replace(/\/remote\.php(\/.*)?$/i, ""), "/");
  return `${parsed.protocol}//${parsed.host}${path}\u0000${name}`;
}

/** The password identity of a calendar row, or null when it has none (OAuth, device, an unreadable address). */
export function pimPasswordIdentity(row: Pick<PimAccountRow, "provider" | "config">): string | null {
  if (row.provider !== "caldav") return null;
  return passwordAccountIdentity(row.config?.url, row.config?.user);
}

/**
 * Among calendar rows of one password identity, the one a fresh connect is
 * ADOPTED INTO (`accountToAdoptInto`): the row a card already binds for this
 * connect when it is one of them, else the lowest id — deterministic, so two
 * devices reading the same list reach the same answer.
 */
export function passwordRowToAdoptInto<T extends { id: string; provider: string; config?: Record<string, unknown> }>(
  rows: readonly T[],
  fresh: { id: string; provider: string; config?: Record<string, unknown> },
  prefer?: string,
): T | null {
  if (fresh.provider !== "caldav") return null;
  const identity = passwordAccountIdentity(fresh.config?.url, fresh.config?.user);
  if (!identity) return null;
  const matches = rows.filter((row) => row.id !== fresh.id && row.provider === "caldav"
    && passwordAccountIdentity(row.config?.url, row.config?.user) === identity);
  if (matches.length === 0) return null;
  return matches.find((row) => row.id === prefer)
    ?? [...matches].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
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
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const identity = pimPasswordIdentity(row);
    if (!identity) continue;
    groups.set(identity, [...(groups.get(identity) ?? []), row.id]);
  }
  const cardsOf = (rowId: string) => cards.filter((card) => card.services.calendar?.pimAccountId === rowId);
  const servicesOf = (card: CloudAccountRecord) =>
    (card.services.files ? 1 : 0) + (card.services.calendar ? 1 : 0) + (card.services.mail ? 1 : 0);
  const empty = (rowId: string) => {
    const known = facts(rowId);
    if (known.hasCredentials || known.hasCachedData) return false;
    return cardsOf(rowId).every((card) => !card.services.files && !card.services.mail);
  };
  const removed: string[] = [];
  for (const ids of groups.values()) {
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
  const candidates = rows.filter((row) => pimPasswordIdentity(row));
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
