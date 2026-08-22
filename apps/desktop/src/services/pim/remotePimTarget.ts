import {
  PimCacheRepository,
  PimConflictError,
  type IDatabaseAdapter,
  type IPimTarget,
  type PimAccountRow,
  type PimEventDraft,
  type PimEventRef,
} from "@plainva/core";
import { getWindowBus } from "../windowBus";
import type { PimWriteOp } from "../windowBus";
import type { PimRuntime } from "./pimRuntime";

/**
 * The calendar half of an auxiliary window (multi-window P2).
 *
 * An aux window READS the PIM cache from the index database like every other
 * table — the rows are already there, and a second reader is free. What it
 * must not do is talk to the provider: since cloud accounts stage B one refresh
 * token serves files, calendar and mail of an account, so two windows renewing
 * it at the same moment do not break one service, they invalidate the account.
 * Every provider round trip therefore happens in the central window.
 *
 * The seam is the target itself. `CalendarView` keeps calling `createEvent`,
 * `updateEvent`, `deleteEvent` and `respondToEvent` on what `buildTarget`
 * hands it; in an aux window that object forwards each call over the bus. The
 * shared write RULES (a move is create-then-delete, a moved remote means
 * re-pull, a written event shows at once) still run where the user clicked —
 * they are decisions, not I/O, and duplicating them in two places is exactly
 * what `eventWrite.ts` exists to prevent.
 */

/** Everything a target does that is NOT a calendar write, in an aux window. */
function unavailable(what: string): never {
  // Reached only if a view starts pulling from an auxiliary window. That would
  // be a second writer on the PIM cache tables, so it fails loudly rather than
  // returning something empty that looks like "the account has nothing".
  throw new Error(`${what} runs in the central window only`);
}

async function send(accountId: string, op: PimWriteOp) {
  const bus = await getWindowBus();
  const res = await bus.request("pim-write", { accountId, op });
  if ("conflict" in res) {
    // PimConflictError cannot survive JSON; the caller's `instanceof` check is
    // what decides between "re-pull and reopen" and "show an error".
    throw new PimConflictError();
  }
  return res;
}

/**
 * A target whose writes are executed by the owner. Reads are refused on
 * purpose (see above) — the views in an aux window read the cache, never a
 * provider.
 */
export function createRemotePimTarget(account: PimAccountRow): IPimTarget {
  const id = account.id;
  return {
    provider: account.provider,
    listCalendars: () => unavailable("listCalendars"),
    pullEvents: () => unavailable("pullEvents"),
    listTaskLists: () => unavailable("listTaskLists"),
    pullTasks: () => unavailable("pullTasks"),
    createTask: () => unavailable("createTask"),
    updateTask: () => unavailable("updateTask"),
    deleteTask: () => unavailable("deleteTask"),
    async createEvent(calendarId: string, draft: PimEventDraft) {
      const res = await send(id, { kind: "createEvent", calendarId, draft });
      return { uid: res.uid ?? "", etag: res.etag, href: res.href };
    },
    async updateEvent(ref: PimEventRef, draft: PimEventDraft) {
      const res = await send(id, { kind: "updateEvent", ref, draft });
      return { etag: res.etag };
    },
    async deleteEvent(ref: PimEventRef) {
      await send(id, { kind: "deleteEvent", ref });
    },
    async respondToEvent(ref: PimEventRef, response: "accepted" | "declined" | "tentative") {
      await send(id, { kind: "respondToEvent", ref, response });
    },
  } as IPimTarget;
}

/**
 * The PIM runtime of an auxiliary window: the real cache on this window's own
 * database connection, remote targets, and a "refresh" that asks the owner's
 * worker rather than starting a second one. `start`/`stop` are no-ops — a
 * background poller per window would multiply provider traffic by the number
 * of open windows and write the same cache from several sides.
 */
export function createClientPimRuntime(db: IDatabaseAdapter): PimRuntime {
  return {
    cache: new PimCacheRepository(db),
    buildTarget: async (account: PimAccountRow) => createRemotePimTarget(account),
    worker: {
      start: () => {},
      stop: () => {},
      triggerImmediate: async () => {
        const bus = await getWindowBus();
        await bus.request("pim-refresh", {});
      },
    },
    stop: () => {},
  };
}
