import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  commentBaseline,
  planCommentNotifications,
  toast,
  type CommentNotificationNote,
  type CommentNotificationPlan,
  type NewCommentNotice,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
import {
  loadCommentNotificationSettings,
  loadSeenComments,
  saveSeenComments,
  type CommentNotificationSettings,
} from "./commentNotificationSettings";

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

/** How the shell hands over what it alone can read. */
export interface CommentNotifierDeps {
  /** Every note with comments, as the surface already lists them (D9). */
  listNotes(vaultPath: string): Promise<CommentNotificationNote[]>;
  /** Display names by member id, for resolving `@Name`. */
  listNames(vaultPath: string): Promise<ReadonlyMap<string, string>>;
  /** This device's identities. A plain vault has no member id. */
  identity(vaultPath: string): Promise<{ memberId: string | null; deviceId: string | null }>;
  /** Notes this user wrote, where the shell can tell. */
  ownedPaths?(vaultPath: string): Promise<ReadonlySet<string>>;
  /** Is the vault currently locked? Then there is no preview to give (§5). */
  isLocked?(vaultPath: string): boolean;
  /** Opens the note with the column open and the card highlighted (§6). */
  openComment(target: { path: string; commentId: string }): void;
  /** Opens the vault-wide overview, pre-filtered to what is new (§6). */
  openOverview(): void;
  /** Is a window in the foreground? Then the column is enough (FB5). */
  isForeground?(): boolean;
}

let deps: CommentNotifierDeps | null = null;
let permissionAsked = false;

/** Registered once at startup, like the mail token resolver next door. */
export function setCommentNotifierDeps(next: CommentNotifierDeps | null): void {
  deps = next;
}

/**
 * The text of one message.
 *
 * Split out because it is the part with a rule in it, not because it is long:
 * with the preview off - or the vault locked - a notification must not leak the
 * note title, the person or a word of the text onto a lock screen (§5, FB2). A
 * locked vault reaching this point is not a bug: the comment came in sealed and
 * nothing here can open it.
 */
export function commentNotificationText(
  plan: CommentNotificationPlan,
  options: { preview: boolean; names: ReadonlyMap<string, string>; noteName: (path: string) => string },
): { title: string; body: string } | null {
  if (plan.kind === "none") return null;
  if (!options.preview) {
    return plan.kind === "single"
      ? { title: i18n.t("commentNotify.titleOne"), body: i18n.t("commentNotify.quiet") }
      : { title: i18n.t("commentNotify.titleMany", { count: plan.commentCount }), body: i18n.t("commentNotify.quiet") };
  }
  if (plan.kind === "single") {
    const notice = plan.notice;
    const author = options.names.get(notice.authorMemberId) ?? i18n.t("commentNotify.someone");
    const note = options.noteName(notice.path);
    const title =
      notice.source === "publication" && notice.publicationName
        ? i18n.t("commentNotify.titleGuest", { name: notice.publicationName })
        : i18n.t("commentNotify.titleOneNamed", { author, note });
    return { title, body: excerpt(notice.body) };
  }
  return {
    title: plan.catchUp
      ? i18n.t("commentNotify.titleCatchUp", { count: plan.commentCount })
      : i18n.t("commentNotify.titleMany", { count: plan.commentCount }),
    body: i18n.t("commentNotify.inNotes", { count: plan.noteCount }),
  };
}

const EXCERPT_CHARS = 120;

/** A lock-screen line, not a paragraph. Cut on a word where one is near. */
function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > EXCERPT_CHARS - 24 ? cut.slice(0, space) : cut}…`;
}

/**
 * One cycle's worth of work for one vault.
 *
 * Exported for the test: it takes the settings and the plan rather than reading
 * them, so the wording and the ledger can be checked without a notification
 * backend.
 */
export async function runCommentNotifications(vaultPath: string): Promise<CommentNotificationPlan | null> {
  const current = deps;
  if (!current) return null;
  const store = await getSettingsStore();
  const settings = await loadCommentNotificationSettings(store, vaultPath);
  const notes = await current.listNotes(vaultPath);
  const present = new Set(commentBaseline(notes));

  // Off: keep the ledger current anyway, so switching it ON draws the baseline
  // at THAT moment (FB3) instead of releasing everything that arrived while it
  // was off.
  if (!settings.enabled) {
    await saveSeenComments(store, vaultPath, present, present);
    return null;
  }

  const seen = await loadSeenComments(store, vaultPath);
  const [names, identity, owned] = await Promise.all([
    current.listNames(vaultPath),
    current.identity(vaultPath),
    current.ownedPaths?.(vaultPath) ?? Promise.resolve(undefined),
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

  for (const id of plan.seen) seen.add(id);
  await saveSeenComments(store, vaultPath, seen, present);
  if (plan.kind === "none") return plan;

  await announce(plan, settings, { names, vaultPath, deps: current });
  return plan;
}

/**
 * Marks everything that exists right now as seen (FB3).
 *
 * Called the moment somebody switches notifications on: the instant of
 * switching on is the zero line, so what predates it is never announced. The
 * older material is not lost - it is in the overview, which is where a backlog
 * belongs.
 */
export async function drawCommentBaseline(vaultPath: string): Promise<void> {
  const current = deps;
  if (!current) return;
  const store = await getSettingsStore();
  const notes = await current.listNotes(vaultPath);
  const present = new Set(commentBaseline(notes));
  await saveSeenComments(store, vaultPath, present, present);
}

async function announce(
  plan: CommentNotificationPlan,
  settings: CommentNotificationSettings,
  context: { names: ReadonlyMap<string, string>; vaultPath: string; deps: CommentNotifierDeps },
): Promise<void> {
  const { names, vaultPath, deps: current } = context;
  // A locked vault has nothing to preview - the records came in sealed (§5).
  const preview = settings.preview && !(current.isLocked?.(vaultPath) ?? false);
  const text = commentNotificationText(plan, { preview, names, noteName });
  if (!text) return;

  const target: NewCommentNotice | null = plan.kind === "single" ? plan.notice : null;
  const open = () => (target ? current.openComment({ path: target.path, commentId: target.commentId }) : current.openOverview());

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

/** The note's name as a person would say it, not its path. */
function noteName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
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
