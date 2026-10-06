import { useSyncExternalStore } from "react";

/**
 * Spell checking: one switch, one rule (plan Befunde 2026-10-06, E3).
 *
 * Plainva draws no squiggles and ships no dictionaries. What checks the text is
 * the platform: the WebView with the system's languages on Windows and macOS,
 * the keyboard and the system's checker on a phone. All the app decides is
 * WHERE the platform may check, and it says so with the `spellcheck` attribute.
 *
 * Until now that was decided field by field and nobody had decided it as a
 * whole: the note editor and the mail composer were off (CodeMirror's default,
 * kept on 2026-07-16 so that no squiggles appear under Markdown syntax), the
 * journal and task capture fields were explicitly on, and every other field
 * was whatever the WebView does when nobody says anything. This module is the
 * one place that decides now:
 *
 *  1. The document root carries `spellcheck="false"` (both shells' index.html).
 *     The attribute inherits, so a field nobody classified is OFF - on every
 *     platform, whatever its WebView would do by default.
 *  2. A field that holds PROSE follows the device switch: on when the switch is
 *     on, off when it is off. Prose means running text a person writes - a
 *     note, a table cell, a mail, a comment, a journal entry, a task.
 *  3. Everything else stays off whatever the switch says: code, keys,
 *     passwords, recovery phrases, search fields, file and property names,
 *     addresses (URL, e-mail), numbers. A checker has nothing to say about
 *     those, and a red line under a recovery phrase invites "correcting" it.
 *
 * The switch is device-local and off by default: dictionaries and languages
 * belong to the device, not to the vault, so it is not part of the synced
 * settings profile. Each shell stores it its own way and reports it here.
 *
 * Who reads the rule:
 *  - React fields through `useSpellcheck(purpose)`; the `TextArea`,
 *    `GrowingField` and `TextInput` primitives do, so a field built on them
 *    never sets the attribute itself.
 *  - DOM builders outside React (the Markdown table's cell editor) through
 *    `spellcheckAttr(purpose)`.
 *  - The editor and compose sessions through `subscribeSpellcheck`: they swap
 *    one compartment, so an open editor follows the switch without being
 *    rebuilt and keeps its caret, scroll position and undo history.
 *  - The desktop's right-click handler through `wantsSystemTextMenu`.
 */

/**
 * What a field is for. Only `"prose"` is ever checked; the other names exist so
 * that a call site states its reason instead of a bare `false`.
 */
export type WritingPurpose =
  | "prose"
  /** Code, markup, queries, formulas, a text file with a grammar. */
  | "code"
  /** Passwords, keys, tokens, recovery phrases, verification codes. */
  | "secret"
  /** A search or filter field: what is typed is a pattern, not a sentence. */
  | "search"
  /** File, folder, property, tag and account names. */
  | "name"
  /** URLs, e-mail addresses, host names, lists of them. */
  | "address"
  /** Numbers, dates, durations. */
  | "number";

let enabled = false;
const listeners = new Set<() => void>();

/** Is the device switch on? */
export function isSpellcheckOn(): boolean {
  return enabled;
}

/**
 * Reports the device switch (the shell's settings service calls this on start
 * and on every change). Open editors and mounted fields follow at once.
 */
export function setSpellcheckOn(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` whenever the switch changes; returns the unsubscribe. */
export function subscribeSpellcheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** THE rule: a field is checked when it holds prose and the switch is on. */
export function spellcheckFor(purpose: WritingPurpose, on: boolean = enabled): boolean {
  return on && purpose === "prose";
}

/** The attribute value for a DOM builder outside React. */
export function spellcheckAttr(purpose: WritingPurpose, on: boolean = enabled): "true" | "false" {
  return spellcheckFor(purpose, on) ? "true" : "false";
}

/** The rule for a React field; re-renders the field when the switch changes. */
export function useSpellcheck(purpose: WritingPurpose): boolean {
  const on = useSyncExternalStore(subscribeSpellcheck, isSpellcheckOn, isSpellcheckOn);
  return spellcheckFor(purpose, on);
}

/**
 * Should a right-click in this editable field show the SYSTEM's menu?
 *
 * The correction suggestions exist only there - no WebView hands them to
 * JavaScript - so squiggles under the app's own Cut/Copy/Paste menu would be
 * half a feature. While the switch is on, a field the rule marks as checked
 * therefore gets the system's menu (which carries cut, copy and paste as
 * well). The question is asked of the attribute the field actually carries,
 * so the menu and the squiggles can never disagree: a code or secret field
 * says `false` and keeps Plainva's menu, an unclassified field inherits the
 * root's `false`.
 *
 * `field` is the editable element itself (an input, a textarea, a
 * contenteditable host), not the node that was clicked - inside a note the
 * click may land on a code span that is exempt from checking, and the menu of
 * one editor must not change from word to word.
 */
export function wantsSystemTextMenu(field: Element | null): boolean {
  if (!enabled || !field) return false;
  return field.closest("[spellcheck]")?.getAttribute("spellcheck") === "true";
}

/** Test hook: back to the default (off) with no listeners. */
export function resetSpellcheckForTests(): void {
  enabled = false;
  listeners.clear();
}
