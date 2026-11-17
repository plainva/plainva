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

async function send(accountId: string, op: PimWriteOp, attempt?: string) {
  const bus = await getWindowBus();
  const res = attempt === undefined ? await bus.request("pim-write", { accountId, op }) : await bus.request("pim-write", { accountId, op }, { attempt });
  if ("conflict" in res) {
    // PimConflictError cannot survive JSON; the caller's `instanceof` check is
    // what decides between "re-pull and reopen" and "show an error". The etag
    // the owner read back travels as a value (R2).
    throw new PimConflictError(undefined, res.currentEtag);
  }
  return res;
}

/**
 * A target whose writes are executed by the owner. Reads are refused on
 * purpose (see above) — the views in an aux window read the cache, never a
 * provider.
 */
/** The remote targets, by what `withWriteAttempt` needs to make one that names its action. */
const remoteAccounts = new WeakMap<IPimTarget, string>();

/**
 * The target for one action of the person — the event a form created — which
 * names it in the create it sends (`RequestOptions.attempt`, A15): pressing
 * "Try again" after "it may still land" is that action again, and the central
 * window does not create the event twice. A new form is a new action, however
 * alike its event. Updates, deletions and answers set a state and repeat
 * harmlessly; a target of the central window itself is given back as it is.
 */
export function withWriteAttempt(target: IPimTarget | null, attempt: string): IPimTarget | null {
  const id = target ? remoteAccounts.get(target) : undefined;
  if (!target || id === undefined) return target;
  return {
    ...target,
    async createEvent(calendarId: string, draft: PimEventDraft) {
      const res = await send(id, { kind: "createEvent", calendarId, draft }, attempt);
      return { uid: res.uid ?? "", etag: res.etag, href: res.href };
    },
  } as IPimTarget;
}

export function createRemotePimTarget(account: PimAccountRow): IPimTarget {
  const id = account.id;
  const target = {
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
      const res = await send(id, { kind: "deleteEvent", ref });
      return { etag: res.etag };
    },
    async respondToEvent(ref: PimEventRef, response: "accepted" | "declined" | "tentative") {
      const res = await send(id, { kind: "respondToEvent", ref, response });
      return { etag: res.etag };
    },
  } as IPimTarget;
  remoteAccounts.set(target, id);
  return target;
}

/**
 * The PIM runtime of an auxiliary window: the real cache on this window's own
 * database connection, remote targets, and a "refresh" that asks the owner's
 * worker rather than starting a second one. `start`/`stop` are no-ops — a
 * background poller per window would multiply provider traffic by the number
 * of open windows and write the same cache from several sides.
 */
export function createClientPimRuntime(db: IDatabaseAdapter): PimRuntime {
  let active = true;
  return {
    cache: new PimCacheRepository(db),
    buildTarget: async (account: PimAccountRow) => createRemotePimTarget(account),
    worker: {
      start: () => {},
      stop: () => {},
      triggerImmediate: async (opts = {}) => {
        const bus = await getWindowBus();
        if (!active) return;
        // A write from this window is one the owner's running cycle cannot
        // answer either (issue 119): the flag travels with the request.
        await bus.request("pim-refresh", { afterWrite: opts.afterWrite === true });
      },
    },
    stop: () => { active = false; },
    isActive: () => active,
  };
}
