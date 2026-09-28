import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  commentNotificationText,
  drawCommentNotificationBaseline,
  requestCommentOverviewFocus,
  runCommentNotificationCycle,
  toast,
  type CommentLockState,
  type CommentNotificationCycle,
  type CommentNotificationNote,
  type CommentNotificationPlan,
  type NewCommentNotice,
} from "@plainva/ui";
import type { ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
import { reportTrayComments } from "./trayNext";
import { loadCommentNotificationSettings, loadSeenComments, saveSeenComments } from "./commentNotificationSettings";

/**
 * Telling somebody a remark arrived (Stufe F, F2).
 *
 * The judgement is not here - it is `planCommentNotifications`, shared with the
 * phone. This file is the desktop half: when to ask, how to word it, where a
 * click lands, and keeping the ledger that makes "no catching up" survive a
 * restart.
 *
 * WHEN it runs is the part worth stating plainly. There is no server, so the
 * only moment a device can learn of a remark is a sync cycle - the sideband
 * carries the comment bundle and then fires `plainva-comments-synced`. The
 * desktop worker runs continuously, so in practice this is "almost at once";
 * the phone cannot promise that, and F3 says so in its own words.
 */

/**
 * How the shell hands over what it alone can read — for ONE vault.
 *
 * Two vaults can run in one window (stage D), and the sideband cycle of each
 * fires the same event. The answers below come from the vault the shell shows,
 * so they carry its path: a cycle for another vault reads and writes nothing
 * here. Before this, the other vault's cycle wrote this vault's remarks into
 * the other vault's ledger (plan Befunde 24.09., E7).
 */
export interface CommentNotifierDeps {
  /** The vault these answers belong to. */
  vaultPath: string;
  /**
   * Can the vault's remarks be read in full right now? Locked: the cycle reads
   * nothing, writes nothing and says nothing (E7, `runCommentNotificationCycle`).
   */
  lockState(): Promise<CommentLockState>;
  /** Every note with comments, as the surface already lists them (D9). */
  listNotes(): Promise<CommentNotificationNote[]>;
  /** Display names by member id, for resolving `@Name`. */
  listNames(): Promise<ReadonlyMap<string, string>>;
  /** This device's identities. A plain vault has no member id. */
  identity(): Promise<{ memberId: string | null; deviceId: string | null }>;
  /** Notes this user wrote, where the shell can tell. */
  ownedPaths?(): Promise<ReadonlySet<string>>;
  /** Opens the note with the column open and the card highlighted (§6). */
  openComment(target: { path: string; commentId: string }): void;
  /** Opens the vault-wide overview, pre-filtered to what is new (§6). */
  openOverview(): void;
  /** Is a window in the foreground? Then the column is enough (FB5). */
  isForeground?(): boolean;
}

let deps: CommentNotifierDeps | null = null;
let permissionAsked = false;

/** Registered by the shell for the vault it shows, like the mail token resolver next door. */
export function setCommentNotifierDeps(next: CommentNotifierDeps): void {
  deps = next;
}

/**
 * Unregisters a vault's answers — only that vault's: on a vault switch the old
 * shell's cleanup and the new shell's registration race, and the old one must
 * not take the new one's answers with it.
 */
export function releaseCommentNotifierDeps(vaultPath: string): void {
  if (deps?.vaultPath === vaultPath) deps = null;
}

function depsFor(vaultPath: string): CommentNotifierDeps | null {
  const current = deps;
  return current && current.vaultPath === vaultPath ? current : null;
}

/** The shared cycle, wired to this vault's settings, ledger and tray line. */
function cycleFor(vaultPath: string, current: CommentNotifierDeps, store: ISettingsStore): CommentNotificationCycle {
  return {
    // A question about a lock that cannot be answered is answered with the lock.
    lockState: () => current.lockState().catch((): CommentLockState => "locked"),
    settings: () => loadCommentNotificationSettings(store, vaultPath),
    listNotes: () => current.listNotes(),
    readSeen: () => loadSeenComments(store, vaultPath),
    writeSeen: (ids) => {
      const kept = new Set(ids);
      return saveSeenComments(store, vaultPath, kept, kept);
    },
    names: () => current.listNames(),
    identity: () => current.identity(),
    ownedPaths: () => current.ownedPaths?.() ?? Promise.resolve(undefined),
    reportWaiting: (count) => reportTrayComments(vaultPath, count),
    announce: (plan, { preview, names }) => announce(plan, preview, { names, deps: current }),
  };
}

/**
 * One cycle's worth of work for one vault.
 *
 * The rule for when a cycle may look — never on a locked vault — is the shared
 * `runCommentNotificationCycle`; this file only says where this shell keeps
 * the settings and the ledger and how it shows a message.
 */
export async function runCommentNotifications(vaultPath: string): Promise<CommentNotificationPlan | null> {
  const current = depsFor(vaultPath);
  if (!current) return null;
  return runCommentNotificationCycle(cycleFor(vaultPath, current, await getSettingsStore()));
}

/**
 * Marks everything that exists right now as seen (FB3).
 *
 * Called the moment somebody switches notifications on: the instant of
 * switching on is the zero line, so what predates it is never announced. The
 * older material is not lost - it is in the overview, which is where a backlog
 * belongs. A locked vault draws no baseline; it could only list too little.
 */
export async function drawCommentBaseline(vaultPath: string): Promise<void> {
  const current = depsFor(vaultPath);
  if (!current) return;
  await drawCommentNotificationBaseline(cycleFor(vaultPath, current, await getSettingsStore()));
}

async function announce(
  plan: CommentNotificationPlan,
  preview: boolean,
  context: { names: ReadonlyMap<string, string>; deps: CommentNotifierDeps },
): Promise<void> {
  const { names, deps: current } = context;
  // The cycle asked the lock right before this call; a locked vault never gets here.
  const text = commentNotificationText({ plan, preview, names, t: i18n.t.bind(i18n) });
  if (!text) return;

  const target: NewCommentNotice | null = plan.kind === "single" ? plan.notice : null;
  // A gathered notification opens the overview on exactly what it announced
  // (C30): the ledger has already recorded these as seen, so the ids travel
  // with the click instead.
  const open = () => {
    if (target) {
      current.openComment({ path: target.path, commentId: target.commentId });
      return;
    }
    requestCommentOverviewFocus(plan.seen);
    current.openOverview();
  };

  // FB5: a system notification for something the user is looking at is noise.
  // The toast still appears - it belongs to the window that has focus.
  if (current.isForeground?.() ?? false) {
    toast.info(`${text.title} · ${text.body}`, { label: i18n.t("commentNotify.actionOpen"), run: open });
    return;
  }

  if (!(await isPermissionGranted())) {
    // Asked once per session, and only after notifications were switched on - a
    // permission prompt out of nowhere is one nobody can answer.
    if (permissionAsked) return;
    permissionAsked = true;
    if ((await requestPermission()) !== "granted") return;
  }
  try {
    sendNotification({ title: text.title, body: text.body });
  } catch (error) {
    console.warn("[commentNotifier] notification failed", error);
  }
  toast.info(`${text.title} · ${text.body}`, { label: i18n.t("commentNotify.actionOpen"), run: open });
}

/**
 * Listens for the end of a sideband cycle. Returns a disposer.
 *
 * The event carries the vault it belongs to, because two vaults can be open at
 * once and a notification for the other one would point at a note this window
 * cannot show.
 */
export function startCommentNotifier(): () => void {
  const onSynced = (event: Event) => {
    const detail = (event as CustomEvent<{ vaultPath?: string }>).detail;
    if (!detail?.vaultPath) return;
    void runCommentNotifications(detail.vaultPath).catch((error) => {
      // A failed notification must never take a sync cycle down with it.
      console.warn("[commentNotifier] cycle failed", error);
    });
  };
  window.addEventListener("plainva-comments-synced", onSynced);
  return () => window.removeEventListener("plainva-comments-synced", onSynced);
}
