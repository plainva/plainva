import { getMobileSettings } from "./mobileSettings";
import { vaultDefaults } from "./mobileSettingsScope";

/**
 * The `type` a new note gets on the phone — the ONE place that names it, and
 * the phone's twin of the desktop's `getConfiguredNoteType` and
 * `getConfiguredDailyNoteType` (finding 2026-10-09).
 *
 * The settings "type for new notes" and "type for daily notes" hold what a
 * person typed or what the settings sync brought: the text may be blank, and
 * it may carry blanks around the name. Both shells read it the same way — the
 * name without the blanks around it, and a setting with nothing in it is an
 * unset one, so the note gets the vault default (`Note`, `Daily Note`) instead
 * of an empty `type`.
 *
 * Every creation path asks here. Eleven places used to read the setting on
 * their own, one of them with a fallback of its own; through the other ten a
 * field that had been cleared wrote `type: ""`. The capture button and the
 * note made from a link did not read it at all and wrote `Note`: the type the
 * settings promise for "every newly created note" was missing from the two
 * most common ways to make one, and a "note type → template" rule for that
 * type never applied on capture. `newNote.test.ts` fails a shipped file that
 * reads a setting itself, or names the default type as a literal, again.
 *
 * The rule sits here, where the setting is read, and not where the settings
 * record is filled: that record has several ways in (the store, the settings
 * fields, the settings sync), and a reader that asks one function is what a
 * test can hold (ADR 0009, addendum 2026-10-21).
 */

/** What a stored "type for new notes" says. The settings field saves this, too. */
export function noteTypeOf(stored: string | null | undefined): string {
  return stored?.trim() || vaultDefaults().defaultNoteType;
}

/** What a stored "type for daily notes" says. The settings field saves this, too. */
export function dailyNoteTypeOf(stored: string | null | undefined): string {
  return stored?.trim() || vaultDefaults().dailyNoteType;
}

/** The `type` of a note created in the active vault. */
export function configuredNoteType(): string {
  return noteTypeOf(getMobileSettings().defaultNoteType);
}

/** The `type` of a daily note created in the active vault. */
export function configuredDailyNoteType(): string {
  return dailyNoteTypeOf(getMobileSettings().dailyNoteType);
}
