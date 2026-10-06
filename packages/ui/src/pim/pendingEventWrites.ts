import { useEffect, useMemo, useSyncExternalStore } from "react";
import { sameStoredValue, type PimEventRow } from "@plainva/core";

/**
 * What the user just did to a calendar event, shown BEFORE the provider has
 * answered (issue 119).
 *
 * `eventWrite.ts` promised "a just-written event appears at once", but its row
 * only existed after the provider call had returned — and the phone threw even
 * that row away and waited for a whole sync cycle. Between the tap on Save and
 * the event on screen there was nothing at all, which is the moment a user
 * decides it did not work and enters it again.
 *
 * So a write has two lives here, and neither shell keeps its own copy of them:
 *
 *  - SENDING: the change is laid over the cached rows at once and marked
 *    `pending`. If the provider refuses, the overlay is dropped and the view is
 *    back where it was — the caller reports why.
 *  - SETTLED: the provider accepted it, but the cache does not know yet (the
 *    cycle that fetches it is still running, or one that started earlier is
 *    about to land and would take the event away again). The overlay stays
 *    until the cached rows agree with it, then it leaves on its own.
 *
 * The overlay is never written to the cache: the cache holds what the provider
 * said, and a cycle arriving mid-flight can neither duplicate an overlaid event
 * (it is matched by its ref once it has one) nor swallow it.
 */

export interface PendingEventRef {
  accountId: string;
  calendarId: string;
  uid: string;
}

export type PendingEventChange =
  | { kind: "create"; row: PimEventRow }
  | { kind: "update"; ref: PendingEventRef; patch: Partial<PimEventRow> }
  | { kind: "delete"; ref: PendingEventRef };

export type PendingEventWrite = PendingEventChange & {
  id: number;
  state: "sending" | "settled";
  /** Set when the provider accepted it; a settled overlay does not wait forever. */
  settledAt?: number;
};

/** A cached row as the views show it: `pending` while its write is on the way. */
export type ShownEventRow = PimEventRow & { pending?: true };

/** The uid of an event that has no provider id yet. Never sent anywhere. */
export const PENDING_EVENT_UID_PREFIX = "pending:";

export const isPendingEventUid = (uid: string): boolean => uid.startsWith(PENDING_EVENT_UID_PREFIX);

/**
 * How long a settled overlay waits for the cache to catch up. A provider that
 * accepted a write and then never lists it (a calendar hidden in between, an
 * account switched off) must not leave a ghost on screen.
 */
export const SETTLED_EVENT_WRITE_TTL_MS = 3 * 60_000;

const sameRef = (row: PendingEventRef, ref: PendingEventRef): boolean =>
  row.accountId === ref.accountId && row.calendarId === ref.calendarId && row.uid === ref.uid;

// An absent field and a null one are the same statement about a cached row.
const sameValue = (a: unknown, b: unknown): boolean => a === b || sameStoredValue(a ?? null, b ?? null);

/** True when the cached row already carries every field the patch set. */
function patchApplied(row: PimEventRow, patch: Partial<PimEventRow>): boolean {
  return (Object.keys(patch) as Array<keyof PimEventRow>).every((key) => sameValue(row[key], patch[key]));
}

/** The cached rows with every pending write laid over them. */
export function applyPendingEventWrites(rows: readonly PimEventRow[], writes: readonly PendingEventWrite[]): ShownEventRow[] {
  if (writes.length === 0) return rows as ShownEventRow[];
  let shown: ShownEventRow[] = rows.slice();
  for (const write of writes) {
    const sending = write.state === "sending";
    if (write.kind === "delete") {
      shown = shown.filter((row) => !sameRef(row, write.ref));
    } else if (write.kind === "update") {
      shown = shown.map((row) => (sameRef(row, write.ref) ? { ...row, ...write.patch, ...(sending ? { pending: true as const } : {}) } : row));
    } else if (!shown.some((row) => sameRef(row, write.row))) {
      // A settled create carries its real uid: once the cache lists that
      // event, the cached row is the one shown and this one steps aside.
      shown.push(sending ? { ...write.row, pending: true } : write.row);
    }
  }
  return shown;
}

/** The writes that still have something to say, given what the cache holds now. */
export function unsettledEventWrites(rows: readonly PimEventRow[], writes: readonly PendingEventWrite[], now: number): PendingEventWrite[] {
  return writes.filter((write) => {
    if (write.state === "sending") return true;
    if (now - (write.settledAt ?? now) > SETTLED_EVENT_WRITE_TTL_MS) return false;
    if (write.kind === "create") return !rows.some((row) => sameRef(row, write.row));
    const cached = rows.find((row) => sameRef(row, write.ref));
    if (write.kind === "delete") return cached !== undefined;
    // An event that left the cache has nothing to patch any more.
    return cached !== undefined && !patchApplied(cached, write.patch);
  });
}

export class PendingEventWrites {
  private writes: readonly PendingEventWrite[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 1;

  /** Stable until something changes, so it can feed `useSyncExternalStore`. */
  snapshot = (): readonly PendingEventWrite[] => this.writes;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: readonly PendingEventWrite[]): void {
    this.writes = next;
    for (const listener of this.listeners) listener();
  }

  /** The id a create's placeholder row should carry as its uid. */
  reserve(): number {
    return this.nextId++;
  }

  begin(change: PendingEventChange, id: number = this.reserve()): number {
    this.set([...this.writes, { ...change, id, state: "sending" }]);
    return id;
  }

  /**
   * The provider answered. Without `after` the write itself stays as settled;
   * with it, those changes take its place — a create returns the row under its
   * real uid, a move becomes "there now, gone here", a conflict becomes nothing.
   */
  settle(id: number, after?: readonly PendingEventChange[], now: number = Date.now()): void {
    const current = this.writes.find((write) => write.id === id);
    if (!current) return;
    const replaced: PendingEventChange[] = after ? [...after] : [current];
    const settled = replaced.map((change, index): PendingEventWrite => ({ ...change, id: index === 0 ? id : this.reserve(), state: "settled", settledAt: now }));
    this.set(this.writes.flatMap((write) => (write.id === id ? settled : [write])));
  }

  /** The provider refused: the view goes back to what the cache says. */
  drop(id: number): void {
    if (this.writes.some((write) => write.id === id)) this.set(this.writes.filter((write) => write.id !== id));
  }

  /** Lets settled writes go once the cache agrees with them. */
  reconcile(rows: readonly PimEventRow[], now: number = Date.now()): void {
    const kept = unsettledEventWrites(rows, this.writes, now);
    if (kept.length !== this.writes.length) this.set(kept);
  }

  clear(): void {
    if (this.writes.length > 0) this.set([]);
  }
}

/** One overlay per app: the editor that writes and the views that show are different components. */
export const pendingEventWrites = new PendingEventWrites();

/** The placeholder a create shows until the provider has given the event its id. */
export function pendingEventRow(id: number, row: Omit<PimEventRow, "uid">): PimEventRow {
  return { ...row, uid: `${PENDING_EVENT_UID_PREFIX}${id}` } as PimEventRow;
}

/**
 * Runs a provider write with its change on screen from the first moment.
 *
 * `after` turns the provider's answer into what stays overlaid until the cache
 * catches up (see {@link PendingEventWrites.settle}); returning nothing keeps
 * the change itself. A rejected write drops the overlay and rethrows.
 */
export async function writeEventOptimistically<T>(
  store: PendingEventWrites,
  change: PendingEventChange,
  write: () => Promise<T>,
  after?: (result: T) => readonly PendingEventChange[] | undefined,
  id?: number,
): Promise<T> {
  const writeId = store.begin(change, id);
  try {
    const result = await write();
    store.settle(writeId, after?.(result));
    return result;
  } catch (error) {
    store.drop(writeId);
    throw error;
  }
}

/** The cached rows as a view should draw them, kept current while writes come and go. */
export function useShownEvents(rows: readonly PimEventRow[], store: PendingEventWrites = pendingEventWrites): ShownEventRow[] {
  const writes = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    store.reconcile(rows);
  }, [rows, writes, store]);
  return useMemo(() => applyPendingEventWrites(rows, writes), [rows, writes]);
}
