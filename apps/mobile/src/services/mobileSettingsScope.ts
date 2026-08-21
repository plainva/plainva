/**
 * Pure per-vault / app-wide partition logic for the mobile settings (package A
 * vault isolation, 2026-07-24). No platform/DOM imports, so it is unit-testable
 * in the node vitest env; mobileSettings.ts wires it to the real store.
 *
 * Fields listed here live in `mobile-vault-<id>` (one record per vault, like
 * the desktop's `*_<b64(path)>` keys); everything else in MobileSettings is
 * app-wide and stays in the global `mobile-settings` blob.
 */
import { profileDefault, type FolderTemplateRule, type TypeTemplateRule } from "@plainva/ui";

/** Lower bound for the sync cycle, identical to the desktop's constant (H2a). */
export const MIN_SYNC_INTERVAL_SECONDS = 5;

export interface VaultScopedSettings {
  dailyFolder: string;
  /** ＋-capture target when no folder is open (R3.6). */
  inboxFolder: string;
  /**
   * Where a photo or a picked file lands (S17). Empty = beside the note, which
   * is what both shells did before this setting existed.
   */
  attachmentFolder: string;
  /** Where "insert template" / "new from template" look for .md templates
   *  (R3.4; same default as the desktop's per-vault setting). */
  templateFolder: string;
  /** Template file name (inside templateFolder) seeding new daily notes;
   *  empty = plain skeleton. */
  dailyTemplate: string;
  /**
   * Folder → template and OKF type → template rules (plan Vorlagen-Engine
   * P4/P4b). Set on the desktop, applied here: the phone has no settings
   * surface for them yet, but a note created on the phone in a mapped folder
   * has to start from the same template it would on the desktop — otherwise
   * the same vault behaves differently depending on which device is at hand.
   */
  folderTemplates: FolderTemplateRule[];
  typeTemplates: TypeTemplateRule[];
  /**
   * Date format of a daily note's file name, in the desktop's spelling
   * (`YYYY-MM-DD`). The phone used to hard-code ISO, so a vault set to another
   * format got a SECOND daily note for the same day as soon as the phone
   * touched it — two files, same day, neither complete (S14).
   */
  dailyFormat: string;
  /**
   * OKF `type` written into new notes and new daily notes. Hard-coded before,
   * so the same vault ended up with notes of different types depending on which
   * device created them.
   */
  defaultNoteType: string;
  dailyNoteType: string;
  /**
   * The `.base` this vault designated as its task database (vault-relative
   * path; empty = none). The phone's tasks area shows its entries and promotes
   * checkboxes into it, exactly like the desktop (S22b).
   */
  taskDatabase: string;
  /** Snapshot retention (package G): min seconds between snapshots (0 = every
   *  write), max per file, max age in days (0 = unlimited). Applied to the
   *  active vault via updatePolicy. */
  backupIntervalSeconds: number;
  backupMaxPerFile: number;
  backupMaxAgeDays: number;
  /** Scheduled vault archive (S36): a daily ZIP into the app's documents
   *  directory, `backupZipKeep` of them retained. The desktop has had both
   *  since its backup package; the phone only had an on-demand export, so a
   *  vault that was never exported by hand had no archive at all. */
  backupZipEnabled: boolean;
  backupZipKeep: number;
  /** Announce appointments as system notifications (S10). Default OFF: the
   *  switch is what asks for the notification permission, and a permission
   *  prompt nobody triggered is one nobody can answer. S11 adds the lead time,
   *  the all-day rule, tasks and the per-calendar choice around it. */
  remindEvents: boolean;
  /** Minutes before the start, used when the appointment carries no reminder
   *  of its own — the appointment's own always wins (S11). */
  reminderLeadMinutes: number;
  /** All-day appointments have no useful "minutes before": midnight is not when
   *  anyone wants to hear about tomorrow. They get a day and a time instead —
   *  1 = the evening before, 0 = the morning of the day itself. */
  reminderAllDayLeadDays: number;
  reminderAllDayAtMinutes: number;
  /** Remind of tasks whose due date falls in the window. */
  remindTasks: boolean;
  /** Which calendars remind, as `accountId cal-id` keys. EMPTY MEANS ALL — a
   *  new calendar then reminds by default instead of falling silently through a
   *  list that was written before it existed. */
  reminderCalendars: string[];
  /** Database views shown in the calendar (S18b) — `path#view` keys. A VAULT
   *  field, mirroring the desktop's `calendarOverlays`: the calendar of one
   *  vault must look the same on both devices. */
  calendarOverlays: string[];
  /** Seconds between sync cycles (H2a) — was hard-coded to 30 in syncService.
   *  Per vault and syncable, mirroring the desktop's `syncIntervalSeconds`. */
  syncIntervalSeconds: number;
  /** Vault folder captured e-mails land in (mail G1) — same key and default
   *  as the desktop, so the setting travels with the settings sync. */
  mailFolder: string;
  /** Load remote images in mail bodies. Default OFF: a remote image is a
   *  tracking beacon. Mirrors the desktop's per-vault opt-in. */
  mailRemoteImages: boolean;
  /**
   * Group the message list into conversations (findings P9.3). Default OFF, so
   * an update never rearranges someone's mail; per vault and syncable with the
   * same meaning as the desktop's own switch, because a mailbox should not look
   * like two different things on two devices.
   */
  mailThreads: boolean;
  /** Snoozed messages (S22) — the same list the desktop profile carries. */
  mailSnoozed: unknown[];
  /**
   * Last mailbox the user was looking at: account id + folder name (device
   * report B1, 2026-07-26). Both were component state, so opening a message
   * unmounted the list and going back landed in the first account's inbox.
   *
   * Per vault and NOT part of the settings-sync profile (the profile port
   * names its fields explicitly): which folder this phone last had open is a
   * device fact, not a setting worth carrying to another device.
   */
  mailAccountId: string;
  mailMailbox: string;
  /**
   * Which navigator tab (files / tags / databases) this vault last showed —
   * per vault and NOT synced, for the same reason as the mailbox above: it is
   * where THIS phone was, not a setting worth carrying to another device.
   */
  navigatorTab: string;
  /**
   * Whether this vault has already been told that rows can be swiped (R1.1).
   *
   * The gesture was invisible: complete since S12 and announced by nothing —
   * no edge, no hint, no first run, no word in the manual. A gesture you only
   * find if you already know about it does not exist for most people, and the
   * maintainer who wrote the rule did not find it either.
   *
   * Per vault and device-local, like `navigatorTab` above: the phone teaches a
   * TOUCH gesture, so the fact that it has been taught belongs to the device
   * that has the touchscreen. A desktop has no equivalent to carry it to.
   */
  swipeHintSeen: boolean;
  /**
   * Where a meeting note lands, and which calendar a new event starts in
   * (S27). Both were declared mobile gaps in the profile catalogue; both are
   * settings of the vault and the person, not of a device, so they travel.
   */
  meetingFolder: string;
  defaultCalendar: string;
  /**
   * The name "Mark as reviewed" writes as `verified: human:<name>` (OKF 0.2,
   * plan P3b, D1). Per vault and DEVICE-LOCAL like `navigatorTab`: it is the
   * person at this phone, not a setting to carry to another device — so it
   * is deliberately absent from the profile catalogue.
   */
  verifierName: string;
}

export const VAULT_KEYS: readonly (keyof VaultScopedSettings)[] = [
  "dailyFolder",
  "inboxFolder",
  "attachmentFolder",
  "templateFolder",
  "dailyTemplate",
  "folderTemplates",
  "typeTemplates",
  "dailyFormat",
  "defaultNoteType",
  "dailyNoteType",
  "taskDatabase",
  "backupIntervalSeconds",
  "backupMaxPerFile",
  "backupMaxAgeDays",
  "backupZipEnabled",
  "backupZipKeep",
  "syncIntervalSeconds",
  "remindEvents",
  "reminderLeadMinutes",
  "reminderAllDayLeadDays",
  "reminderAllDayAtMinutes",
  "remindTasks",
  "reminderCalendars",
  "calendarOverlays",
  "mailFolder",
  "mailRemoteImages",
  "mailThreads",
  "mailSnoozed",
  "mailAccountId",
  "mailMailbox",
  "navigatorTab",
  "swipeHintSeen",
  "meetingFolder",
  "defaultCalendar",
  "verifierName",
];

/** Single source of the per-vault defaults (mobileSettings.DEFAULTS spreads these). */
export const VAULT_DEFAULTS: VaultScopedSettings = {
  dailyFolder: profileDefault<string>("dailyNotesFolder")!,
  inboxFolder: profileDefault<string>("inboxFolder")!,
  attachmentFolder: profileDefault<string>("attachmentFolder")!,
  templateFolder: profileDefault<string>("templateFolder")!,
  dailyTemplate: profileDefault<string>("dailyNoteTemplate")!,
  folderTemplates: profileDefault<FolderTemplateRule[]>("folderTemplates")!,
  typeTemplates: profileDefault<TypeTemplateRule[]>("typeTemplates")!,
  dailyFormat: profileDefault<string>("dailyNotesFormat")!,
  defaultNoteType: profileDefault<string>("defaultNoteType")!,
  dailyNoteType: profileDefault<string>("dailyNoteType")!,
  taskDatabase: profileDefault<string>("taskDatabase")!,
  backupIntervalSeconds: profileDefault<number>("backupSnapshotIntervalSeconds")!,
  backupMaxPerFile: profileDefault<number>("backupMaxCountPerFile")!,
  backupMaxAgeDays: profileDefault<number>("backupMaxAgeDays")!,
  backupZipEnabled: profileDefault<boolean>("backupZipEnabled")!,
  backupZipKeep: profileDefault<number>("backupZipKeep")!,
  syncIntervalSeconds: profileDefault<number>("syncIntervalSeconds")!,
  remindEvents: false,
  reminderLeadMinutes: 15,
  reminderAllDayLeadDays: 1,
  reminderAllDayAtMinutes: 19 * 60,
  remindTasks: false,
  reminderCalendars: [],
  calendarOverlays: [],
  mailFolder: profileDefault<string>("mailFolder")!,
  meetingFolder: profileDefault<string>("meetingFolder")!,
  defaultCalendar: profileDefault<string>("defaultCalendar")!,
  mailRemoteImages: profileDefault<boolean>("mailRemoteImages")!,
  mailThreads: false,
  mailSnoozed: [],
  mailAccountId: "",
  mailMailbox: "",
  navigatorTab: "files",
  swipeHintSeen: false,
  verifierName: "",
};

/** Extracts the per-vault fields, filling any gap from the defaults. */
export function pickVault(src: Partial<VaultScopedSettings>): VaultScopedSettings {
  return {
    dailyFolder: src.dailyFolder ?? VAULT_DEFAULTS.dailyFolder,
    inboxFolder: src.inboxFolder ?? VAULT_DEFAULTS.inboxFolder,
    attachmentFolder: src.attachmentFolder ?? VAULT_DEFAULTS.attachmentFolder,
    templateFolder: src.templateFolder ?? VAULT_DEFAULTS.templateFolder,
    dailyTemplate: src.dailyTemplate ?? VAULT_DEFAULTS.dailyTemplate,
    folderTemplates: src.folderTemplates ?? VAULT_DEFAULTS.folderTemplates,
    typeTemplates: src.typeTemplates ?? VAULT_DEFAULTS.typeTemplates,
    dailyFormat: src.dailyFormat ?? VAULT_DEFAULTS.dailyFormat,
    defaultNoteType: src.defaultNoteType ?? VAULT_DEFAULTS.defaultNoteType,
    dailyNoteType: src.dailyNoteType ?? VAULT_DEFAULTS.dailyNoteType,
    taskDatabase: src.taskDatabase ?? VAULT_DEFAULTS.taskDatabase,
    backupIntervalSeconds: src.backupIntervalSeconds ?? VAULT_DEFAULTS.backupIntervalSeconds,
    backupMaxPerFile: src.backupMaxPerFile ?? VAULT_DEFAULTS.backupMaxPerFile,
    backupMaxAgeDays: src.backupMaxAgeDays ?? VAULT_DEFAULTS.backupMaxAgeDays,
    backupZipEnabled: src.backupZipEnabled ?? VAULT_DEFAULTS.backupZipEnabled,
    backupZipKeep: src.backupZipKeep ?? VAULT_DEFAULTS.backupZipKeep,
    syncIntervalSeconds: src.syncIntervalSeconds ?? VAULT_DEFAULTS.syncIntervalSeconds,
    remindEvents: src.remindEvents ?? VAULT_DEFAULTS.remindEvents,
    reminderLeadMinutes: src.reminderLeadMinutes ?? VAULT_DEFAULTS.reminderLeadMinutes,
    reminderAllDayLeadDays: src.reminderAllDayLeadDays ?? VAULT_DEFAULTS.reminderAllDayLeadDays,
    reminderAllDayAtMinutes: src.reminderAllDayAtMinutes ?? VAULT_DEFAULTS.reminderAllDayAtMinutes,
    remindTasks: src.remindTasks ?? VAULT_DEFAULTS.remindTasks,
    reminderCalendars: src.reminderCalendars ?? VAULT_DEFAULTS.reminderCalendars,
    calendarOverlays: src.calendarOverlays ?? VAULT_DEFAULTS.calendarOverlays,
    mailFolder: src.mailFolder ?? VAULT_DEFAULTS.mailFolder,
    meetingFolder: src.meetingFolder ?? VAULT_DEFAULTS.meetingFolder,
    defaultCalendar: src.defaultCalendar ?? VAULT_DEFAULTS.defaultCalendar,
    mailRemoteImages: src.mailRemoteImages ?? VAULT_DEFAULTS.mailRemoteImages,
    mailThreads: src.mailThreads ?? VAULT_DEFAULTS.mailThreads,
    mailSnoozed: Array.isArray(src.mailSnoozed) ? src.mailSnoozed : VAULT_DEFAULTS.mailSnoozed,
    mailAccountId: src.mailAccountId ?? VAULT_DEFAULTS.mailAccountId,
    mailMailbox: src.mailMailbox ?? VAULT_DEFAULTS.mailMailbox,
    navigatorTab: src.navigatorTab ?? VAULT_DEFAULTS.navigatorTab,
    swipeHintSeen: src.swipeHintSeen ?? VAULT_DEFAULTS.swipeHintSeen,
    verifierName: src.verifierName ?? VAULT_DEFAULTS.verifierName,
  };
}

/** The app-wide slice (everything that is NOT per vault) for the global blob. */
export function stripVaultKeys<T extends object>(src: T): Partial<T> {
  const out = { ...src } as Partial<T>;
  const rec = out as unknown as Record<string, unknown>;
  for (const k of VAULT_KEYS) delete rec[k];
  return out;
}

/**
 * One-time migration decision: which vault records to CREATE so that no vault
 * loses its folder/retention settings when the shared pre-package-A blob is
 * split. Every vault that has no record yet is seeded from the old shared
 * values (non-destructive — existing records are left untouched, and vaults
 * connected after migration simply get the defaults via pickVault).
 */
export function vaultRecordsToSeed(
  oldBlob: Partial<VaultScopedSettings> | null,
  vaultIds: string[],
  hasRecord: (id: string) => boolean,
): Array<{ id: string; record: VaultScopedSettings }> {
  const seed = pickVault(oldBlob ?? {});
  return vaultIds.filter((id) => !hasRecord(id)).map((id) => ({ id, record: { ...seed } }));
}
