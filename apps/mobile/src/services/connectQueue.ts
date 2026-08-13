import { FAMILY_SERVICES, type CloudProviderFamily, type CloudServiceId } from "@plainva/ui";
import { getPlatformServices } from "@plainva/ui";
import { listVaults } from "./vaultRegistry";
import { listPimAccounts } from "./pim/pimService";
import { listMobileMailAccounts } from "./mail/mailRuntime";

/**
 * The list of services still to connect for one account (S0b1).
 *
 * The phone signs each service in on its OWN screen — that was a deliberate
 * call when the connect wizard was built, and it stands: a files connection is
 * a vault container, a calendar is an account row, a mailbox is a mailbox. What
 * was missing is the thread between them. Today the service picker is a
 * single choice, so connecting Google's files, calendar and mail means walking
 * the whole path three times and re-picking Google every time.
 *
 * The thread cannot live in the navigation stack, and that is the reason this
 * module exists rather than a `services[]` field on the nav entry. TWO things
 * tear the stack apart mid-run:
 *
 *  - **The browser round trip.** OAuth leaves the app; the phone may kill it.
 *    The OAuth transaction already survives that by persisting itself, and this
 *    follows the same pattern.
 *  - **The vault switch.** Connecting FILES calls `switchVault`, and the
 *    handler in App.tsx resets the whole navigation (`initialNavState`).
 *
 * Reordering to dodge the second one is not an option: the files service
 * CREATES the vault container on mobile, and calendar/mail bind to the ACTIVE
 * vault. Put them first and one account's three services end up in two
 * different vaults. So files goes first and the reset gets survived.
 *
 * The pure functions below hold the rules and are tested without a store; only
 * the four `…Queue` functions touch persistence.
 */

/** Same order the desktop wizard runs, and the order the vault switch demands. */
export const SERVICE_ORDER: readonly CloudServiceId[] = ["files", "calendar", "mail"] as const;

export interface ConnectQueue {
  family: CloudProviderFamily;
  /** Still to do, in SERVICE_ORDER. */
  pending: CloudServiceId[];
  /** Connected during this run — the progress view reads this. */
  done: CloudServiceId[];
  /**
   * How many accounts each service had when the run started.
   *
   * The run advances on the same events the screens already fire when their
   * lists change — and those fire for deletes and edits too. Counting is what
   * separates "the sign-in landed" from "something moved": only a list that
   * GREW past its starting size means a service is connected. It is persisted
   * with the queue on purpose, because the OAuth round trip may kill the app
   * between the start and the answer.
   */
  baseline: Partial<Record<CloudServiceId, number>>;
  /** Epoch ms; a queue older than the TTL is ignored and dropped. */
  createdAt: number;
}

const KEY = "mobileConnectQueue";
/**
 * Long enough for a consent screen plus a password lookup, short enough that an
 * abandoned run cannot resurface days later and send someone into a form they
 * never asked for.
 */
export const QUEUE_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Rules (pure)
// ---------------------------------------------------------------------------

/**
 * Builds a queue from a family and the ticked services, dropping anything the
 * family cannot carry. The filter is not politeness: `FAMILY_SERVICES` is the
 * shared matrix, and letting an impossible service into the queue would park
 * the run on a form that can never succeed.
 */
export function buildQueue(
  family: CloudProviderFamily,
  services: readonly CloudServiceId[],
  now: number,
  baseline: Partial<Record<CloudServiceId, number>> = {},
): ConnectQueue | null {
  const carried = FAMILY_SERVICES[family];
  const pending = SERVICE_ORDER.filter((s) => services.includes(s) && carried.includes(s));
  return pending.length > 0 ? { family, pending, done: [], baseline, createdAt: now } : null;
}

/**
 * Whether a changed account list means the service in front of the queue is
 * connected. Anything that is not growth past the starting count — a delete, an
 * edit, a reload — leaves the run where it is.
 */
export function countsAsConnected(queue: ConnectQueue | null, service: CloudServiceId, count: number): boolean {
  if (!queue || queue.pending[0] !== service) return false;
  return count > (queue.baseline[service] ?? 0);
}

/** The service to open next, or null when the run is finished. */
export function nextService(queue: ConnectQueue | null): CloudServiceId | null {
  return queue?.pending[0] ?? null;
}

/**
 * Every service the run covers — done and still pending. The consent that runs
 * first has to be widened for the WHOLE run, not for what is left of it.
 */
export function runServices(queue: ConnectQueue): CloudServiceId[] {
  return SERVICE_ORDER.filter((s) => queue.done.includes(s) || queue.pending.includes(s));
}

/**
 * Moves one service from pending to done. Returns the new queue, or null when
 * nothing is left — the caller treats null as "the run is over".
 *
 * Completing a service that is not pending is a no-op rather than an error: a
 * screen may be reached directly (no queue) or re-entered after a cold start,
 * and neither is a reason to fail.
 */
export function withCompleted(queue: ConnectQueue | null, service: CloudServiceId): ConnectQueue | null {
  if (!queue || !queue.pending.includes(service)) return queue;
  const pending = queue.pending.filter((s) => s !== service);
  const done = [...queue.done, service];
  return pending.length > 0 ? { ...queue, pending, done } : null;
}

/** A queue past its TTL is dead — never resumed, always dropped. */
export function isExpired(queue: ConnectQueue, now: number): boolean {
  return now - queue.createdAt >= QUEUE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** In-memory copy so a same-session read never waits on the store. */
let current: ConnectQueue | null = null;

async function persist(queue: ConnectQueue | null): Promise<void> {
  current = queue;
  try {
    const store = await getPlatformServices().loadSettings();
    if (queue) await store.set(KEY, queue);
    else await store.delete(KEY);
    await store.save();
  } catch {
    /* the in-memory copy still serves this session */
  }
}

/** Starts a run; returns the first service to open, or null if there is none. */
export async function startConnectQueue(
  family: CloudProviderFamily,
  services: readonly CloudServiceId[],
): Promise<CloudServiceId | null> {
  const queue = buildQueue(family, services, Date.now(), await countAccounts());
  await persist(queue);
  return nextService(queue);
}

/**
 * How many accounts each service has right now. Read once when a run starts, so
 * "one more than before" is a question the run can answer later — including
 * after the app was killed mid-consent.
 */
export async function countAccounts(): Promise<Partial<Record<CloudServiceId, number>>> {
  const [vaults, pim, mail] = await Promise.all([
    listVaults().catch(() => []),
    listPimAccounts().catch(() => []),
    listMobileMailAccounts().catch(() => []),
  ]);
  return {
    // A files connection IS a vault container on mobile (M3.5 isolation), so
    // the registry is the list that grows.
    files: vaults.length,
    calendar: pim.length,
    mail: mail.length,
  };
}

/**
 * Called when one of the three account lists changed. Advances the run only if
 * the change is growth on the service the run is waiting for.
 *
 * `advanced: false` covers three different situations that all mean "do
 * nothing": there is no run, the run is waiting for another service, or the
 * list changed for some other reason. They are one answer on purpose — the
 * caller has the same job in all three. `next: null` WITH `advanced: true` is
 * the one that matters separately: that is the run finishing.
 */
export async function advanceOnAccountsChanged(
  service: CloudServiceId,
): Promise<{ advanced: boolean; next: CloudServiceId | null; queue: ConnectQueue | null }> {
  const queue = await loadConnectQueue();
  if (!queue || queue.pending[0] !== service) return { advanced: false, next: null, queue: null };
  const counts = await countAccounts();
  if (!countsAsConnected(queue, service, counts[service] ?? 0)) return { advanced: false, next: null, queue: null };
  return { advanced: true, next: await completeConnectService(service), queue };
}

/** The live queue, or null when there is none or it has expired. */
export async function loadConnectQueue(): Promise<ConnectQueue | null> {
  if (current) return isExpired(current, Date.now()) ? (await persist(null), null) : current;
  try {
    const store = await getPlatformServices().loadSettings();
    const stored = await store.get<ConnectQueue>(KEY);
    if (stored && Array.isArray(stored.pending) && typeof stored.createdAt === "number") {
      if (isExpired(stored, Date.now())) {
        await persist(null);
        return null;
      }
      current = stored;
      return stored;
    }
  } catch {
    /* fall through: no restorable run */
  }
  return null;
}

/**
 * Marks a service connected and returns the next one to open (null = done, and
 * the queue is cleared).
 */
export async function completeConnectService(service: CloudServiceId): Promise<CloudServiceId | null> {
  const queue = await loadConnectQueue();
  const next = withCompleted(queue, service);
  if (next !== queue) await persist(next);
  return nextService(next);
}

/** Abandons the run — used when the user backs out of the wizard. */
export async function clearConnectQueue(): Promise<void> {
  await persist(null);
}
