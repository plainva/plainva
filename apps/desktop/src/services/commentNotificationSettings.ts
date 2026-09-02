import type { ISettingsStore } from "@plainva/ui";
import type { CommentNotificationLevel } from "@plainva/ui";

/**
 * Per-vault settings for remark notifications (Stufe F, F2).
 *
 * Device-local on purpose, like the reminder settings next door and for the same
 * reason: a notification is a statement about THIS device. Carrying the level
 * through the settings profile would mean a phone silenced for the commute also
 * silences the desktop, which is the opposite of what somebody silencing a phone
 * wants.
 *
 * `seen` is the one entry that is not a preference but a ledger: which comment
 * ids this device has already accounted for. It is what makes "no catching up"
 * hold across restarts - without it, every launch would replay the backlog.
 */

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

export const commentNotifyLevelKey = (v: string) => `commentNotifyLevel_${b64(v)}`;
export const commentNotifyEnabledKey = (v: string) => `commentNotifyEnabled_${b64(v)}`;
export const commentNotifyPreviewKey = (v: string) => `commentNotifyPreview_${b64(v)}`;
export const commentNotifyMutedKey = (v: string) => `commentNotifyMuted_${b64(v)}`;
export const commentNotifySeenKey = (v: string) => `commentNotifySeen_${b64(v)}`;

export interface CommentNotificationSettings {
  enabled: boolean;
  level: CommentNotificationLevel;
  /** Whether the message may name the note, the person and the text (FB2). */
  preview: boolean;
  /** Vault-relative paths silenced individually. */
  mutedPaths: string[];
}

export const DEFAULT_COMMENT_NOTIFICATION_SETTINGS: CommentNotificationSettings = {
  // Off until somebody asks for it: switching it on is what draws the baseline
  // (FB3), and a notification nobody asked for is the second inbox this plan is
  // built to avoid.
  enabled: false,
  // FB1: level 1 is too quiet for a share, level 3 gets muted.
  level: "relevant",
  // FB2: without a preview the message is nearly worthless; the switch sits
  // right next to it for the environments where it is untenable.
  preview: true,
  mutedPaths: [],
};

const LEVELS: readonly CommentNotificationLevel[] = ["mentions", "relevant", "all"];

function asLevel(value: unknown): CommentNotificationLevel {
  return LEVELS.includes(value as CommentNotificationLevel)
    ? (value as CommentNotificationLevel)
    : DEFAULT_COMMENT_NOTIFICATION_SETTINGS.level;
}

function asPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export async function loadCommentNotificationSettings(
  store: ISettingsStore,
  vaultPath: string,
): Promise<CommentNotificationSettings> {
  const [enabled, level, preview, muted] = await Promise.all([
    store.get<boolean>(commentNotifyEnabledKey(vaultPath)),
    store.get<string>(commentNotifyLevelKey(vaultPath)),
    store.get<boolean>(commentNotifyPreviewKey(vaultPath)),
    store.get<string[]>(commentNotifyMutedKey(vaultPath)),
  ]);
  return {
    enabled: enabled ?? DEFAULT_COMMENT_NOTIFICATION_SETTINGS.enabled,
    level: asLevel(level),
    preview: preview ?? DEFAULT_COMMENT_NOTIFICATION_SETTINGS.preview,
    mutedPaths: asPaths(muted),
  };
}

export async function saveCommentNotificationSettings(
  store: ISettingsStore,
  vaultPath: string,
  settings: CommentNotificationSettings,
): Promise<void> {
  await store.set(commentNotifyEnabledKey(vaultPath), settings.enabled);
  await store.set(commentNotifyLevelKey(vaultPath), settings.level);
  await store.set(commentNotifyPreviewKey(vaultPath), settings.preview);
  await store.set(commentNotifyMutedKey(vaultPath), settings.mutedPaths);
  await store.save();
}

/** The ledger of ids this device has accounted for. */
export async function loadSeenComments(store: ISettingsStore, vaultPath: string): Promise<Set<string>> {
  const raw = await store.get<string[]>(commentNotifySeenKey(vaultPath));
  return new Set(asPaths(raw));
}

/**
 * Writes the ledger back, pruned to what still exists.
 *
 * Pruning is what bounds it: without it the list would keep every id a vault
 * ever held, and a vault holds as many comments as people wrote. Anything not
 * in `present` is gone from the bundle, so remembering it would only cost
 * space - it can never come back and be reported twice.
 */
export async function saveSeenComments(
  store: ISettingsStore,
  vaultPath: string,
  seen: ReadonlySet<string>,
  present: ReadonlySet<string>,
): Promise<void> {
  const kept = [...seen].filter((id) => present.has(id));
  await store.set(commentNotifySeenKey(vaultPath), kept);
  await store.save();
}

/** Silences one note, or lifts it. Muting is a state, not a hunt (§3, rule 4). */
export function toggleMutedPath(settings: CommentNotificationSettings, path: string): CommentNotificationSettings {
  const muted = new Set(settings.mutedPaths);
  if (muted.has(path)) muted.delete(path);
  else muted.add(path);
  return { ...settings, mutedPaths: [...muted].sort() };
}
