import { EFFECT_DECLINED } from "../orchestrator.js";
import type { NoteEditProblem } from "./edits.js";
import { LINK_CHECK_LIMITS } from "./links.js";

/**
 * What a writing tool answers a model with (plan KI-Harness P5): Plainva's
 * own sentences, in English because a model reads them, and fixed — nothing
 * of a note, of a path the model did not name itself, or of a rule is ever
 * part of one. The user reads what happened in their own language, from the
 * run's record; these are for the model alone.
 *
 * A note the rules keep from this recipient is answered exactly like a note
 * that is not there, here as for every read: `no-note`.
 */
export const WRITE_REFUSALS = {
  unavailable: "Plainva takes no changes from an assistant in this vault.",
  sealed: "This vault is an encrypted workspace. Nothing is proposed, drafted or planned in it.",
  "no-note": "No note is available at this path.",
  "not-a-note": "Plainva takes changes to Markdown notes only.",
  "edits-or-append": "Give either `edits` or `append`.",
  empty: "There is nothing to change: an edit needs a passage, and an addition needs text.",
  "not-found": "A passage is not in the text of the note. Quote it exactly as read_note returned it. A note's properties are changed with set_property.",
  ambiguous: "A passage, or the section, is in the note more than once. Quote more of it, or name the section by its whole chain.",
  overlap: "Two of the passages touch. Give them as one edit.",
  unchanged: "The note says this already.",
  "too-many": "Too many changes for one proposal. Change less at a time.",
  "too-long": "A passage or its replacement is too long.",
  "no-section": "There is no such section. get_outline lists the sections of a note.",
  restricted:
    "This conversation has read notes that are kept from the cloud or from the internet, and the place this would be written to is not. It would carry what they say to where their rule does not hold, so Plainva does not lay it down. The user can give that place the same rule first.",
  // An e-mail and an appointment leave the vault: there is no place whose rule they could take along.
  "restricted-out":
    "This conversation has read notes that are kept from the cloud or from the internet. An e-mail or an appointment would carry what they say out of the vault, so Plainva drafts neither from it. Give the user the text in your answer instead.",
  full: "Too many drafts wait for the user. They have to create or discard some of them first.",
  "no-mail": "No mail account is connected in this vault, so there is no e-mail to draft.",
  "no-calendar": "There is no calendar in this vault an appointment could be written to.",
  "bad-address": "A recipient or an invitee is no e-mail address. Give each as a plain address like name@example.org, one per entry.",
  "bad-time": "The day or a time cannot be read. Give the day as YYYY-MM-DD and times as HH:MM in 24 hours; an appointment ends after it begins.",
  "bad-property": "This is no property name, or no value a property can have: text, a number, true or false, or a list of those.",
  // Who made a note and who vouches for it is never an assistant's to write (ADR 0023).
  trust: "Plainva takes this property from no assistant: it says who made the note or who vouches for it.",
  reserved: "This property belongs to Plainva's own settings of the note and is not set this way.",
  unreadable: "The properties of this note cannot be read as they stand, so nothing was proposed.",
  // A suggestion is attached to the words around it; a file with nothing in it has none.
  "empty-note": "This note is empty, and a suggestion has to be attached to something that is there. Give the user the text in your answer instead.",
  "no-title": "A title is needed.",
  // A database the rules keep from this recipient is answered like one that is not there, as a note is.
  "no-base": "No database is available at this path. query_base reads a database by the path of its .base file.",
  "no-entry-folder": "This database has no folder for new entries yet. The user chooses one when they create its first entry in Plainva.",
  frontmatter: "Give the note's text without frontmatter.",
  "no-folder": "There is no such folder in the vault.",
  "bad-name": "This is no name a note can have.",
  exists: "A note of this name is there already.",
  "same-place": "The note is there already.",
  // The run's own words for a no: the step is shown as declined, like every question the user answered with no.
  declined: EFFECT_DECLINED,
  nobody: "Nobody is there to confirm this, so it was not done.",
  failed: "Plainva could not do it.",
} as const;

export type WriteRefusal = keyof typeof WRITE_REFUSALS;

/** The sentence for an edit that could not be applied; which edit, where one of them is the reason. */
export function editProblemSentence(problem: NoteEditProblem, edit?: number): string {
  const sentence = WRITE_REFUSALS[problem];
  return edit === undefined || problem === "unchanged" || problem === "too-many" ? sentence : `Edit ${edit + 1}: ${sentence}`;
}

const WAITS = "Nothing in the vault has changed.";

/**
 * What the source check found (plan P5-7): the notes a text links to that are not in the vault — or that this run
 * may not know of. The two read the same here, in the words a read uses for both ("not available"): a name is not
 * found out by trying it. Named back, so a model that made a note up can say so in its answer.
 */
function linksNowhere(told: readonly string[]): string {
  if (!told.length) return "";
  const named = told
    .slice(0, LINK_CHECK_LIMITS.named)
    .map((name) => `[[${name.slice(0, 120)}]]`)
    .join(", ");
  const more = told.length > LINK_CHECK_LIMITS.named ? ` and ${told.length - LINK_CHECK_LIMITS.named} more` : "";
  return ` Your text links to ${told.length === 1 ? "a note that is" : "notes that are"} not available here: ${named}${more}. The user is told about ${told.length === 1 ? "this link" : "these links"}.`;
}

/** What a tool says when it laid something down. Counts and the path the model named — never the text. */
export const WRITE_RESULTS = {
  // `told`: the linked names the source check found no note for, as the model may hear them (`LinkCheckResult.told`).
  proposed: (path: string, changes: number, defused: number, told: readonly string[] = []) =>
    `Proposed on ${path}: ${changes} change${changes === 1 ? "" : "s"}. ${WAITS} The user accepts or declines each change in Plainva.${defused ? " Web addresses you added were made inert: the user sees them as text." : ""}${linksNowhere(told)}`,
  drafted: (what: string, defused: number, told: readonly string[] = []) =>
    `Drafted: ${what}. ${WAITS} It exists once the user creates it from the draft in Plainva.${defused ? " Web addresses you added were made inert: the user sees them as text." : ""}${linksNowhere(told)}`,
  // An e-mail or an appointment: nothing is sent, nothing is saved — the draft opens in the app's own editor, and the rest is the user's.
  draftedOut: (what: string, where: "mail composer" | "event editor", unnamed: number, defused: number) =>
    `Drafted: ${what}. Nothing was sent or saved. The user opens the draft in Plainva's own ${where} and ${where === "mail composer" ? "sends" : "saves"} it there themselves.${
      unnamed ? ` ${unnamed === 1 ? "One address is" : `${unnamed} addresses are`} not from the user's own words: the draft tells the user to check ${unnamed === 1 ? "it" : "them"}.` : ""
    }${defused ? " Web addresses you added were made inert: the user sees them as text." : ""}`,
  // The property's name is the one the model gave; its value is never repeated.
  proposedProperty: (path: string, key: string, removed: boolean, defused: number) =>
    `Proposed on ${path}: ${removed ? `the property ${key} removed` : `a value for the property ${key}`}. ${WAITS} The user accepts or declines it in Plainva.${defused ? " Web addresses you added were made inert: the user sees them as text." : ""}`,
  ruleSet: (path: string, set: boolean) => (set ? `Done. The rule is written into ${path}.` : `Done. The rule is removed from ${path}.`),
  renamed: (path: string) => `Renamed. The note is now ${path}.`,
  moved: (path: string) => `Moved. The note is now ${path}.`,
  deleted: "The user deleted the note.",
} as const;
