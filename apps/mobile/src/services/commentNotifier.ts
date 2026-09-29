import { LocalNotifications } from "@capacitor/local-notifications";
import {
  buildCommentOverview,
  commentNotificationText,
  drawCommentNotificationBaseline,
  requestCommentJump,
  requestCommentOverviewFocus,
  runCommentNotificationCycle,
  toast,
  type CommentLockState,
  type CommentNotificationCycle,
  type CommentNotificationLevel,
  type CommentNotificationNote,
  type CommentNotificationPlan,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { applyVaultSettings, getVaultSettings } from "./mobileSettings";

/**
 * Telling you on the phone that somebody wrote something (Stufe F, F3).
 *
 * The judgement is `planCommentNotifications`, shared with the desktop - this
 * file is only the phone's half: when it can look, how the message is worded,
 * and where a tap lands.
 *
 * WHEN is the honest part and the reason for the parity entry. A phone runs no
 * timer in the background, so there is no moment between cycles at which it
 * could notice anything. It looks when a sideband cycle finishes and when the
 * app returns to the foreground - the same platform limit the PIM refresh hit.
 * Closing it would mean a push service, and a push service means a foreign
 * server learning when who commented on which note.
 */

/** Action type id registered with the OS; the button hangs off it. */
const ACTION_COMMENT = "plainva-comment";
/** Notification id, fixed: one message per cycle REPLACES the last one rather
 *  than stacking a second unread badge for the same thing. */
const NOTIFICATION_ID = 774_001;

/**
 * How the shell hands over what only it can read — for the vault it has open.
 *
 * The answers carry the vault's id, and the cycle reads and writes that vault's
 * settings and ledger by the id rather than "whichever vault is active": a
 * cycle that was still running when the phone switched vaults would otherwise
 * have written one vault's remarks into the other's ledger (plan Befunde
 * 24.09., E7).
 */
export interface MobileCommentNotifierDeps {
  vaultId: string;
  /**
   * Can the vault's remarks be read in full right now? Locked: the cycle reads
   * nothing, writes nothing and says nothing (E7, `runCommentNotificationCycle`).
   */
  lockState(): Promise<CommentLockState>;
  listNotes(): Promise<CommentNotificationNote[]>;
  listNames(): Promise<ReadonlyMap<string, string>>;
  identity(): Promise<{ memberId: string | null; deviceId: string | null }>;
  /** Opens the note with the sheet open and the card highlighted (§6). */
  openComment(target: { path: string; commentId: string }): void;
  openOverview(): void;
}

let deps: MobileCommentNotifierDeps | null = null;
let initialised = false;

export function setMobileCommentNotifierDeps(next: MobileCommentNotifierDeps): void {
  deps = next;
}

/**
 * Unregisters these answers — only these: on a vault switch the old hook's
 * cleanup and the new hook's registration race, and the old one must not take
 * the new one's answers with it.
 */
export function releaseMobileCommentNotifierDeps(released: MobileCommentNotifierDeps): void {
  if (deps === released) deps = null;
}

/**
 * What a tapped notification should do, parked until the shell can act.
 *
 * A notification can arrive while the app is cold: the OS starts the process
 * and no vault is open yet. Parking rather than acting is not a nicety - acting
 * at once would reach a vault that does not exist. Same shape as the reminder
 * scheduler's intent next door, for the same reason.
 */
export interface CommentIntent {
  path: string;
  commentId: string | null;
  /** A gathered notification: the ids it announced, for the overview's "new" (C30). */
  newIds?: string[];
}

let pendingIntent: CommentIntent | null = null;

/** Takes the parked intent, if any. */
export function takeCommentIntent(): CommentIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

/**
 * Registers the action type with translated buttons.
 *
 * This must NOT run at module top level, and that is not a style preference:
 * `i18n.t` returns the KEY until the language file has loaded, importing a
 * module happens long before `await i18nReady` in the boot sequence, and
 * Android keeps a registered action type for the life of the process. That is
 * the whole of the 2026-08-22 finding ("the button is called
 * reminders.actionDone"), and this file would have reproduced it exactly.
 * Called once from the boot sequence AFTER i18n is ready, and again on every
 * language change.
 */
async function registerActionTypes(): Promise<void> {
  await LocalNotifications.registerActionTypes({
    types: [{ id: ACTION_COMMENT, actions: [{ id: "open", title: i18n.t("commentNotify.actionOpen") }] }],
  }).catch(() => {});
}

/**
 * Wires the notifier up: action type, tap listener, cycle and foreground hooks.
 *
 * Deliberately the only way anything here starts - importing this module must
 * have no visible effect. `commentNotifierInit.test.ts` reads the source and
 * fails if a top-level `void …` call comes back, because that is the shape that
 * produced an untranslated button once already.
 *
 * Idempotent: a second call is a no-op, so a re-entered boot path cannot stack
 * listeners.
 */
export function initMobileCommentNotifier(): void {
  if (initialised) return;
  initialised = true;

  void registerActionTypes();
  i18n.on("languageChanged", () => {
    void registerActionTypes();
  });

  void LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const extra = (event.notification.extra ?? {}) as Partial<CommentIntent>;
    // A single remark names its note; a gathered one carries what it announced.
    // Before C30 the gathered tap carried nothing and therefore did nothing.
    if (!extra.path && !extra.newIds) return;
    pendingIntent = { path: extra.path ?? "", commentId: extra.commentId ?? null, newIds: extra.newIds };
    applyIntent();
  });

  window.addEventListener("plainva-comments-synced", () => {
    void runMobileCommentNotifications().catch((error) => {
      // A failed notification must never take a sync cycle down with it.
      console.warn("[commentNotifier] cycle failed", error);
    });
  });
}

/**
 * Acts on a parked intent if the shell is ready for it.
 *
 * Called both when the tap arrives and when the shell registers itself, because
 * either can come first.
 */
export function applyIntent(): void {
  const current = deps;
  if (!current || !pendingIntent) return;
  const intent = takeCommentIntent();
  if (!intent) return;
  if (intent.commentId) {
    requestCommentJump({ path: intent.path, commentId: intent.commentId });
    current.openComment({ path: intent.path, commentId: intent.commentId });
  } else {
    requestCommentOverviewFocus(intent.newIds ?? []);
    current.openOverview();
  }
}

/** The shared cycle, wired to this vault's own settings record. */
function cycleFor(current: MobileCommentNotifierDeps): CommentNotificationCycle {
  const vaultId = current.vaultId;
  return {
    // A question about a lock that cannot be answered is answered with the lock.
    lockState: () => current.lockState().catch((): CommentLockState => "locked"),
    settings: async () => {
      const settings = await getVaultSettings(vaultId);
      return {
        enabled: settings.commentNotifyEnabled,
        level: settings.commentNotifyLevel as CommentNotificationLevel,
        preview: settings.commentNotifyPreview,
        mutedPaths: settings.commentNotifyMuted,
      };
    },
    listNotes: () => current.listNotes(),
    readSeen: async () => new Set((await getVaultSettings(vaultId)).commentNotifySeen),
    writeSeen: (ids) => applyVaultSettings(vaultId, { commentNotifySeen: ids }),
    names: () => current.listNames(),
    identity: () => current.identity(),
    announce: (plan, { preview, names }) => announce(plan, preview, names),
  };
}

/** Marks everything present as seen (FB3), for the moment of switching on. A locked vault draws none. */
export async function drawMobileCommentBaseline(): Promise<void> {
  const current = deps;
  if (!current) return;
  await drawCommentNotificationBaseline(cycleFor(current));
}

/**
 * One cycle for the open vault. Returns the plan, for the test.
 *
 * Called after a sideband cycle and on every return to the foreground - the two
 * moments a phone has. On the way back the workspace runtime may still be
 * loading; the shared cycle then does nothing at all instead of pruning the
 * ledger to an empty list.
 */
export async function runMobileCommentNotifications(): Promise<CommentNotificationPlan | null> {
  const current = deps;
  if (!current) return null;
  return runCommentNotificationCycle(cycleFor(current));
}

async function announce(
  plan: CommentNotificationPlan,
  preview: boolean,
  names: ReadonlyMap<string, string>,
): Promise<void> {
  if (plan.kind === "none") return;
  // One rule for what a lock screen may show, shared with the desktop: two
  // copies would drift, and the drift would only ever surface on somebody's
  // lock screen. A locked vault never gets here: the cycle asked the lock
  // right before this call.
  const text = commentNotificationText({ plan, preview, names, t: i18n.t.bind(i18n) });
  if (!text) return;
  const { title, body } = text;
  const extra: CommentIntent | null =
    plan.kind === "single"
      ? { path: plan.notice.path, commentId: plan.notice.commentId }
      : plan.kind === "bundle"
        ? { path: "", commentId: null, newIds: [...plan.seen] }
        : null;

  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      const asked = await LocalNotifications.requestPermissions();
      if (asked.display !== "granted") return;
    }
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIFICATION_ID,
          title,
          body,
          actionTypeId: ACTION_COMMENT,
          // No `schedule`: this fires now. The remark already arrived.
          extra: extra ?? {},
        },
      ],
    });
  } catch (error) {
    console.warn("[commentNotifier] notification failed", error);
  }

  // The toast is for the case the app is already open - a system notification
  // for something on screen is noise, but silence would be worse.
  const open = () => {
    if (extra?.commentId) {
      requestCommentJump({ path: extra.path, commentId: extra.commentId });
      deps?.openComment({ path: extra.path, commentId: extra.commentId });
    } else {
      requestCommentOverviewFocus(extra?.newIds ?? []);
      deps?.openOverview();
    }
  };
  toast.info(`${title} · ${body}`, { label: i18n.t("commentNotify.actionOpen"), run: open });
}

/**
 * How many open threads name you, for a surface that wants a badge.
 *
 * Same computation the overview uses, so a count here can never disagree with
 * the list it summarises.
 */
export function countAddressed(
  notes: readonly CommentNotificationNote[],
  selfMemberId: string | null,
  names: ReadonlyMap<string, string>,
): number {
  return buildCommentOverview(notes, selfMemberId, names, { onlyAddressed: true })
    .reduce((sum, note) => sum + note.addressedCount, 0);
}
