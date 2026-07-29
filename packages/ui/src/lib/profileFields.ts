/**
 * The one catalog of syncable settings (sync-transparency plan P1, step S9).
 *
 * Until now each shell carried its own list: the desktop a registry of 22 store
 * keys, the phone a hand-written literal in its export and a second one in its
 * apply. Nothing tied them together, so a field added on one side simply never
 * arrived on the other — which is exactly what the 2026-07-28 finding looked
 * like from the outside ("iOS and other desktops receive things, Android does
 * not"). A shared catalog does not by itself close a gap, but it makes every
 * gap a declared, testable fact instead of an omission nobody can see.
 *
 * Deliberately free of platform types: this module knows the LOGICAL field
 * names that travel in the profile document and what kind of value each one
 * carries. Which store key or settings property holds it stays with the shell —
 * the desktop key embeds an absolute vault path, the phone has a per-vault
 * settings object, and neither belongs in shared code.
 */

/**
 * Who a setting belongs to. `vault` is a convention of the ARCHIVE and sensibly
 * the same for everyone working in it; `member` is personal and would otherwise
 * be overwritten every time a second person syncs. Without an encrypted
 * workspace there is no member and everything behaves as before — one person on
 * several devices, where "personal" and "shared" are the same thing.
 */
export type ProfileScope = "vault" | "member";

/**
 * What kind of value a field carries. `vaultPath` is a vault-RELATIVE folder or
 * file path: it may travel, but an absolute path never may (it would point into
 * another machine's file system), which is why it is its own kind.
 */
export type ProfileFieldKind = "vaultPath" | "text" | "boolean" | "number" | "json";

/** Grouping for the "this travels / this stays here" table. */
export type ProfileFieldArea = "content" | "backup" | "sync" | "mail" | "calendar" | "layout" | "accounts";

export interface ProfileFieldDef {
  /** Device-independent name inside the profile document. */
  logical: string;
  scope: ProfileScope;
  kind: ProfileFieldKind;
  area: ProfileFieldArea;
  /**
   * How the desktop supplies the value: `store` = a per-vault settings key,
   * `own` = its own source (accounts, bookmarks) that the port assembles, or
   * `null` when the desktop has no counterpart. Symmetrical to `mobile` on
   * purpose — a gap can point either way, and the one that pointed from the
   * phone to the desktop is how this whole finding started.
   */
  desktop: "store" | "own" | null;
  /** Why this field has no desktop counterpart (required when `desktop` is null). */
  desktopGap?: string;
  /**
   * The phone's per-vault settings property, `own` for its own source, or
   * `null` when the field does not travel on mobile yet. A `null` REQUIRES
   * `mobileGap` — an undocumented gap is the failure mode this catalog exists
   * to prevent.
   */
  mobile: string | "own" | null;
  /** Why this field has no mobile counterpart (yet). */
  mobileGap?: string;
  /** Lower bound for `number` fields, applied when importing. */
  min?: number;
}

/**
 * Every logical field the profile document can carry. Order is irrelevant (the
 * document is key-sorted for hashing); it is grouped by area for reading.
 */
export const PROFILE_FIELDS: readonly ProfileFieldDef[] = [
  // Content and structure — conventions of the archive, hence vault scope.
  { logical: "dailyNotesFolder", scope: "vault", kind: "vaultPath", area: "content", desktop: "store", mobile: "dailyFolder" },
  { logical: "dailyNotesFormat", scope: "vault", kind: "text", area: "content", desktop: "store", mobile: "dailyFormat" },
  { logical: "dailyNoteTemplate", scope: "vault", kind: "vaultPath", area: "content", desktop: "store", mobile: "dailyTemplate" },
  { logical: "dailyNoteType", scope: "vault", kind: "text", area: "content", desktop: "store", mobile: "dailyNoteType" },
  { logical: "templateFolder", scope: "vault", kind: "vaultPath", area: "content", desktop: "store", mobile: "templateFolder" },
  { logical: "attachmentFolder", scope: "vault", kind: "vaultPath", area: "content", desktop: "store", mobile: "attachmentFolder" },
  { logical: "inboxFolder", scope: "vault", kind: "vaultPath", area: "content", desktop: "store", mobile: "inboxFolder" },
  { logical: "defaultNoteType", scope: "vault", kind: "text", area: "content", desktop: "store", mobile: "defaultNoteType" },
  { logical: "taskDatabase", scope: "vault", kind: "vaultPath", area: "content", desktop: "store", mobile: "taskDatabase" },
  // The phone carries these itself (like bookmarks): they are `json`, and its
  // importer only understands the scalar kinds. It has no settings surface to
  // AUTHOR rules yet — but it applies them, which is the point (P6).
  { logical: "folderTemplates", scope: "vault", kind: "json", area: "content", desktop: "store", mobile: "own" },
  { logical: "typeTemplates", scope: "vault", kind: "json", area: "content", desktop: "store", mobile: "own" },
  { logical: "extendedDatabases", scope: "vault", kind: "json", area: "content", desktop: "store", mobile: null,
    mobileGap: "extended databases are a desktop-only configuration surface" },
  { logical: "meetingFolder", scope: "vault", kind: "vaultPath", area: "calendar", desktop: "store", mobile: null,
    mobileGap: "meeting notes are created on the desktop; the phone has no entry point for them" },

  // Personal working preferences.
  { logical: "mailFolder", scope: "member", kind: "vaultPath", area: "mail", desktop: "store", mobile: "mailFolder" },
  { logical: "mailRemoteImages", scope: "member", kind: "boolean", area: "mail", desktop: "store", mobile: "mailRemoteImages" },
  { logical: "syncIntervalSeconds", scope: "member", kind: "number", area: "sync", desktop: "store", mobile: "syncIntervalSeconds", min: 5 },
  { logical: "defaultCalendar", scope: "member", kind: "text", area: "calendar", desktop: "store", mobile: null,
    mobileGap: "the phone has no default-calendar picker yet" },

  // Backup retention.
  { logical: "backupSnapshotIntervalSeconds", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupIntervalSeconds", min: 0 },
  { logical: "backupMaxCountPerFile", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupMaxPerFile", min: 0 },
  { logical: "backupMaxAgeDays", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupMaxAgeDays", min: 0 },
  { logical: "backupZipEnabled", scope: "member", kind: "boolean", area: "backup", desktop: "store", mobile: null,
    mobileGap: "the phone exports a vault as a ZIP on demand and has no scheduled archive" },
  { logical: "backupZipKeep", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: null, min: 1,
    mobileGap: "see backupZipEnabled — nothing to keep without a schedule" },

  // How the bars are arranged. Per vault and free of paths and identity, which
  // is why they qualify; the GLOBAL default beneath them stays device-local (it
  // is this device's starting point, not a shared setting).
  { logical: "barLayoutRibbon", scope: "member", kind: "json", area: "layout", desktop: "store", mobile: null,
    mobileGap: "the phone has a navigation bar instead of a ribbon; its arrangement is deliberately device-local" },
  { logical: "barLayoutLeftTabs", scope: "member", kind: "json", area: "layout", desktop: "store", mobile: null,
    mobileGap: "no left sidebar on the phone" },
  { logical: "barLayoutLeftSections", scope: "member", kind: "json", area: "layout", desktop: "store", mobile: null,
    mobileGap: "no left sidebar on the phone" },
  { logical: "barLayoutRightSections", scope: "member", kind: "json", area: "layout", desktop: "store", mobile: null,
    mobileGap: "the phone shows the same sections in a sheet, in a fixed order" },

  // Fields with their own source: the port assembles them rather than reading a
  // settings key. All personal — two people in one workspace have different
  // mailboxes, calendar selections and bookmarks.
  { logical: "pimAccounts", scope: "member", kind: "json", area: "accounts", desktop: "own", mobile: "own" },
  { logical: "pimSelections", scope: "member", kind: "json", area: "accounts", desktop: "own", mobile: "own" },
  { logical: "mailAccounts", scope: "member", kind: "json", area: "accounts", desktop: "own", mobile: "own" },
  { logical: "cloudAccounts", scope: "member", kind: "json", area: "accounts", desktop: "own", mobile: "own" },
  { logical: "bookmarks", scope: "member", kind: "json", area: "accounts", desktop: "own", mobile: "own" },
];

const BY_LOGICAL = new Map(PROFILE_FIELDS.map((f) => [f.logical, f]));

export function profileField(logical: string): ProfileFieldDef | undefined {
  return BY_LOGICAL.get(logical);
}

/**
 * Whether a logical field belongs to the signed-in member rather than the
 * vault. Fields nobody knows (the forward-compatibility bucket of a newer
 * Plainva) stay with the vault — guessing a scope for them would be worse than
 * keeping today's behaviour.
 */
export function isMemberProfileField(logical: string): boolean {
  return BY_LOGICAL.get(logical)?.scope === "member";
}

/** Fields a shell reads from and writes to its settings store. */
export function storeBackedFields(shell: "desktop" | "mobile"): ProfileFieldDef[] {
  return PROFILE_FIELDS.filter((f) => (shell === "desktop" ? f.desktop === "store" : typeof f.mobile === "string" && f.mobile !== "own"));
}

/**
 * The areas a shell actually carries, in reading order. The "this travels"
 * summary is generated from this rather than written by hand — a hand-written
 * list is how the two shells drifted apart in the first place, and a list that
 * promises more than the code delivers is worse than none.
 */
export function travellingAreas(shell: "desktop" | "mobile"): ProfileFieldArea[] {
  const order: ProfileFieldArea[] = ["accounts", "content", "calendar", "mail", "backup", "sync", "layout"];
  const carried = new Set(
    PROFILE_FIELDS.filter((f) => (shell === "desktop" ? f.desktop !== null : f.mobile !== null)).map((f) => f.area)
  );
  return order.filter((a) => carried.has(a));
}

/** i18n key of the human label for an area in the "what travels" summary. */
export function profileAreaKey(area: ProfileFieldArea): string {
  return `settingsSync.area_${area}`;
}
