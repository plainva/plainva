import { deleteFrontmatterPath, readFrontmatterPath, trimEndChars } from "@plainva/core";

/**
 * Keys a note took over from its template (open-items plan 3.136 no. 1,
 * decision E2).
 *
 * A template carries two keys for itself: `plainva.tasks: false` keeps the
 * template's own example tasks out of the tasks view, `plainva.templateFor`
 * says which databases it is the template of. Until 0.8.5 a note made from a
 * template by hand took both over — every daily note from such a template, in
 * the Journal and Tour vaults every one opened that way — and its tasks were
 * missing from the tasks view without a word. Since 0.8.6 a new note does not
 * take them over (`templateAsNewNote`).
 *
 * Which of the notes carry them as a leftover and which were hidden on purpose
 * (the eye in the tasks view writes the same `plainva.tasks: false`) cannot be
 * told from the note. So nothing is cleaned up silently: both shells show the
 * notes outside the template folder in the tasks view, the person picks, and
 * only the picked ones lose the keys.
 */
export interface TemplateKeyNote {
  path: string;
  title: string;
  /** `plainva.tasks: false`: the note's tasks are kept out of the tasks view. */
  hidesTasks: boolean;
  /** `plainva.templateFor`: a template's assignment, without effect in a note. */
  templateFor: boolean;
}

/** The notes that are not themselves in the template folder (`""`: none is set). */
export function templateKeyNotesOutside(notes: readonly TemplateKeyNote[], templateFolder: string): TemplateKeyNote[] {
  const base = trimEndChars(templateFolder.trim(), "/");
  if (!base) return [...notes];
  const lower = base.toLowerCase();
  return notes.filter((note) => {
    const path = note.path.toLowerCase();
    return path !== lower && !path.startsWith(`${lower}/`);
  });
}

/**
 * The note without the two keys: `plainva.templateFor` goes, and
 * `plainva.tasks` where it is `false`. Each entry goes where it stands and
 * nothing else of the note changes (`deleteFrontmatterPath`); an empty
 * `plainva:` goes with its last entry.
 */
export function withoutTemplateKeys(raw: string): string {
  let next = raw;
  if (readFrontmatterPath(next, ["plainva", "tasks"]) === false) next = deleteFrontmatterPath(next, ["plainva", "tasks"]);
  if (readFrontmatterPath(next, ["plainva", "templateFor"]) !== undefined) next = deleteFrontmatterPath(next, ["plainva", "templateFor"]);
  return next;
}

/** What the notice was hidden for: the set of notes, so a new one brings it back. */
export const templateKeysSignature = (notes: readonly TemplateKeyNote[]): string => notes.map((note) => note.path).join("\n");

const hiddenKey = (vault: string) => `plainva.templateKeysHidden.${vault}`;

/** The set the notice was hidden for in this vault, on this device; "" where none. */
export function readHiddenTemplateKeys(vault: string | null): string {
  if (!vault) return "";
  try {
    return localStorage.getItem(hiddenKey(vault)) ?? "";
  } catch {
    return "";
  }
}

export function writeHiddenTemplateKeys(vault: string | null, signature: string): void {
  if (!vault) return;
  try {
    localStorage.setItem(hiddenKey(vault), signature);
  } catch {
    // Without storage the notice only stays hidden until the view opens again.
  }
}
