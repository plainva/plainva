import type { CommentStoreState } from "@plainva/core";
import {
  commentBaseline,
  planCommentNotifications,
  type CommentNotificationLevel,
  type CommentNotificationNote,
  type CommentNotificationPlan,
} from "./commentNotifications.js";
import { buildCommentOverview } from "./commentThreads.js";

/**
 * One notification cycle for one vault, the same in both shells (plan Befunde
 * 24.09., E7).
 *
 * What counts as new and relevant is `planCommentNotifications`. This is the
 * rule around it: WHEN a cycle may look at all. A locked vault lists no
 * remarks — its store answers with an empty list, not with an error — and a
 * cycle that took that empty list at its word pruned the seen-ledger to
 * nothing. After unlocking, every old, open remark was "new" again and was
 * announced with its preview, which is exactly the catching-up rule FB3
 * forbids. On the phone that happened on every return to the app while the
 * workspace runtime was still loading.
 *
 * So: locked means do not look, do not write, do not speak.
 *
 * - The lock is asked before anything is read. Locked: return at once — no
 *   list, no ledger, no tray line, no badge.
 * - It is asked again after the list was read and before the ledger is
 *   written: a vault that locked while its remarks were being listed may have
 *   listed too few, and a ledger must never shrink on a short list.
 * - And once more right before the notification: a lock that came in between
 *   silences the message (and with it the preview).
 *
 * The shell answers the lock question from what it knows (`commentLockState`)
 * and does the rest: where the settings and the ledger live, how a message is
 * shown.
 */

export type CommentLockState = "open" | "locked";

/**
 * Whether a vault's remarks can be read in full right now.
 *
 * `store` is what the vault's comment store says about itself — `locked`, or
 * an unlocked workspace whose older sideband history is still sealed
 * (`legacyLocked`); no store to ask counts as locked. `workspaceLocked` is the
 * shell's own answer about the encrypted workspace: a phase other than
 * `active`, or keys that are not in memory. An unanswerable question about a
 * lock is answered with the lock.
 */
export function commentLockState(
  store: Pick<CommentStoreState, "mode" | "legacyLocked"> | null,
  workspaceLocked: boolean,
): CommentLockState {
  if (!store || store.mode === "locked" || store.legacyLocked === true || workspaceLocked) return "locked";
  return "open";
}

export interface CommentNotificationCycleSettings {
  enabled: boolean;
  level: CommentNotificationLevel;
  preview: boolean;
  mutedPaths: readonly string[];
}

/** What one shell hands the cycle for one vault. */
export interface CommentNotificationCycle {
  /** Asked three times per cycle; see above. A shell that cannot tell answers `locked`. */
  lockState(): Promise<CommentLockState>;
  settings(): Promise<CommentNotificationCycleSettings>;
  listNotes(): Promise<CommentNotificationNote[]>;
  readSeen(): Promise<ReadonlySet<string>>;
  /** Stores the ledger. `ids` is already pruned to what exists. */
  writeSeen(ids: string[]): Promise<void>;
  names(): Promise<ReadonlyMap<string, string>>;
  identity(): Promise<{ memberId: string | null; deviceId: string | null }>;
  /** Notes this user wrote, where the shell can tell. */
  ownedPaths?(): Promise<ReadonlySet<string> | undefined>;
  /** How many open threads name this user — the desktop's tray line. */
  reportWaiting?(count: number): void;
  /** Shows the message. Only called for a plan with something in it, on an open vault. */
  announce(plan: Exclude<CommentNotificationPlan, { kind: "none" }>, context: { preview: boolean; names: ReadonlyMap<string, string> }): Promise<void>;
}

/**
 * One cycle. Returns the plan, or null when the cycle did nothing — notifications
 * off, or the vault locked.
 */
export async function runCommentNotificationCycle(cycle: CommentNotificationCycle): Promise<CommentNotificationPlan | null> {
  if ((await cycle.lockState()) === "locked") return null;

  const settings = await cycle.settings();
  const notes = await cycle.listNotes();
  const present = commentBaseline(notes);

  // Off: keep the ledger current anyway, so switching it ON draws the baseline
  // at THAT moment (FB3) instead of releasing everything that arrived while it
  // was off.
  if (!settings.enabled) {
    if ((await cycle.lockState()) === "locked") return null;
    await cycle.writeSeen(present);
    return null;
  }

  const [seen, names, identity, owned] = await Promise.all([
    cycle.readSeen(),
    cycle.names(),
    cycle.identity(),
    cycle.ownedPaths?.() ?? Promise.resolve(undefined),
  ]);
  const plan = planCommentNotifications({
    notes,
    seen,
    selfMemberId: identity.memberId,
    selfDeviceId: identity.deviceId,
    names,
    level: settings.level,
    mutedPaths: new Set(settings.mutedPaths),
    ownedPaths: owned,
  });

  // The list may be short if the vault locked while it was read.
  if ((await cycle.lockState()) === "locked") return null;
  // Pruned to what still exists, so the ledger stays bounded by the vault
  // rather than by everything it ever held.
  const presentSet = new Set(present);
  await cycle.writeSeen([...new Set([...seen, ...plan.seen])].filter((id) => presentSet.has(id)));

  // The tray counts what is WAITING, not what just arrived: a notification is
  // about a moment, the tray line about a state. Computed from the overview
  // the surface uses, so the two cannot disagree.
  cycle.reportWaiting?.(
    buildCommentOverview(notes, identity.memberId, names, { onlyAddressed: true }).reduce((sum, note) => sum + note.addressedCount, 0),
  );

  if (plan.kind === "none") return plan;
  if ((await cycle.lockState()) === "locked") return plan;
  await cycle.announce(plan, { preview: settings.preview, names });
  return plan;
}

/**
 * Marks everything that exists right now as seen (FB3) — the moment somebody
 * switches notifications on. A locked vault lists too little to draw a
 * baseline from, so it draws none; its next open cycle keeps the ledger
 * current again.
 */
export async function drawCommentNotificationBaseline(
  cycle: Pick<CommentNotificationCycle, "lockState" | "listNotes" | "writeSeen">,
): Promise<void> {
  if ((await cycle.lockState()) === "locked") return;
  const present = commentBaseline(await cycle.listNotes());
  if ((await cycle.lockState()) === "locked") return;
  await cycle.writeSeen(present);
}
