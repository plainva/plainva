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
 * One shared meaning of "absent from the profile".
 *
 * These are domain defaults, not UI placeholders. Both shells must resolve an
 * absent field to these values and must omit an equal value on export. Keeping
 * the table here prevents a sparse desktop document and a default-filled phone
 * document from taking turns publishing the same effective state.
 */
export const PROFILE_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  dailyNotesFolder: "",
  dailyNotesFormat: "YYYY-MM-DD",
  dailyNoteTemplate: "",
  dailyNoteType: "Daily Note",
  templateFolder: "Templates",
  attachmentFolder: "Attachments",
  inboxFolder: "Inbox",
  defaultNoteType: "Note",
  taskDatabase: "",
  folderTemplates: Object.freeze([]),
  typeTemplates: Object.freeze([]),
  extendedDatabases: true,
  meetingFolder: "Meetings",
  calendarOverlays: Object.freeze([]),
  mailFolder: "Mail",
  mailRemoteImages: false,
  syncIntervalSeconds: 15,
  defaultCalendar: "",
  backupSnapshotIntervalSeconds: 120,
  backupMaxCountPerFile: 100,
  backupMaxAgeDays: 90,
  backupZipEnabled: true,
  backupZipKeep: 7,
  pimAccounts: Object.freeze([]),
  pimSelections: Object.freeze({
    calendars: Object.freeze([]),
    taskLists: Object.freeze([]),
  }),
  mailAccounts: Object.freeze([]),
  cloudAccounts: Object.freeze([]),
  bookmarks: Object.freeze([]),
});

/**
 * Recursively sorts object keys while preserving array order. Array order is
 * user data for bookmarks and rule priority; account-set sorting is handled by
 * the account projection, not guessed generically here.
 */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

const ACCOUNT_SET_FIELDS = new Set(["pimAccounts", "mailAccounts", "cloudAccounts"]);

function canonicalRecordKey(value: unknown, primary: readonly string[]): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return [
    ...primary.map((key) => (typeof record[key] === "string" ? record[key] : "")),
    JSON.stringify(record),
  ].join("\u0000");
}

function sortedRecords(values: unknown[], primary: readonly string[]): unknown[] {
  return [...values].sort((a, b) => canonicalRecordKey(a, primary).localeCompare(canonicalRecordKey(b, primary)));
}

/** Only true set-like profile arrays are sorted; bookmarks and rule priority stay semantic. */
function canonicalFieldValue(logical: string, value: unknown): unknown {
  const normalized = canonicalValue(value);
  if (ACCOUNT_SET_FIELDS.has(logical) && Array.isArray(normalized)) {
    return sortedRecords(normalized, ["id"]);
  }
  if (logical === "pimSelections" && normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const selections = normalized as Record<string, unknown>;
    return {
      ...selections,
      ...(Array.isArray(selections.calendars)
        ? { calendars: sortedRecords(selections.calendars, ["accountId", "id"]) }
        : {}),
      ...(Array.isArray(selections.taskLists)
        ? { taskLists: sortedRecords(selections.taskLists, ["accountId", "id"]) }
        : {}),
    };
  }
  return normalized;
}

/** Returns a detached default so callers cannot mutate the shared table. */
export function profileDefault<T = unknown>(logical: string): T | undefined {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, logical)) return undefined;
  return canonicalValue(PROFILE_DEFAULTS[logical]) as T;
}

/**
 * Produces the one sparse profile projection used before comparison/export and
 * after validation/import. Known defaults and known null/undefined optionals
 * are absent; future fields are retained and all object keys are deterministic.
 */
export function canonicalizeProfileValues(values: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (value === undefined) continue;
    if ((value === null) && Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, key)) continue;
    const normalized = canonicalFieldValue(key, value);
    const fallback = profileDefault(key);
    if (fallback !== undefined && JSON.stringify(normalized) === JSON.stringify(fallback)) continue;
    canonical[key] = normalized;
  }
  return canonical;
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
  { logical: "meetingFolder", scope: "vault", kind: "vaultPath", area: "calendar", desktop: "store", mobile: "meetingFolder" },
  // Which database views the calendar shows (S18). A vault field on purpose:
  // the calendar of one vault should look the same on both machines, and a
  // per-device list would quietly give the phone a different calendar.
  { logical: "calendarOverlays", scope: "vault", kind: "json", area: "calendar", desktop: "store", mobile: "own" },

  // Personal working preferences.
  { logical: "mailFolder", scope: "member", kind: "vaultPath", area: "mail", desktop: "store", mobile: "mailFolder" },
  { logical: "mailRemoteImages", scope: "member", kind: "boolean", area: "mail", desktop: "store", mobile: "mailRemoteImages" },
  { logical: "syncIntervalSeconds", scope: "member", kind: "number", area: "sync", desktop: "store", mobile: "syncIntervalSeconds", min: 5 },
  { logical: "defaultCalendar", scope: "member", kind: "text", area: "calendar", desktop: "store", mobile: "defaultCalendar" },

  // Backup retention.
  { logical: "backupSnapshotIntervalSeconds", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupIntervalSeconds", min: 0 },
  { logical: "backupMaxCountPerFile", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupMaxPerFile", min: 0 },
  { logical: "backupMaxAgeDays", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupMaxAgeDays", min: 0 },
  // S36: the phone gained the scheduled archive, so these two carry now. It
  // writes into its own documents directory rather than a chosen folder — a
  // phone has no directory picker — but the cadence, the naming and the
  // retention are the shared ones.
  { logical: "backupZipEnabled", scope: "member", kind: "boolean", area: "backup", desktop: "store", mobile: "backupZipEnabled" },
  { logical: "backupZipKeep", scope: "member", kind: "number", area: "backup", desktop: "store", mobile: "backupZipKeep", min: 1 },

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
  // The phone's own bar, since S10 the model's fifth (redesign E2). It travels
  // in BOTH directions, which is the point: a bar arranged on the big screen is
  // the one the phone shows. Assembled by each port rather than read through
  // the generic binding — it is `kind: "json"`, and the phone's importer only
  // knows the scalar kinds.
  { logical: "barLayoutMobileBar", scope: "member", kind: "json", area: "layout", desktop: "store", mobile: "own" },

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
