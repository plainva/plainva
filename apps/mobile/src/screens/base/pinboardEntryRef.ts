import type { PinboardDraft, PinboardEntryChip } from "@plainva/ui";

/**
 * What the "New entry" page needs, carried through the nav stack as the
 * entry's path (plan Befunde 2026-09-24, E17): the draft the pinboard just
 * created and the database it belongs to. JSON, like the mail refs — a draft
 * path may hold any character.
 *
 * The reader is total: a malformed or outdated value yields null, and the page
 * then simply goes back, because a nav entry must never crash the shell.
 */
export interface PinboardEntryRef {
  draft: PinboardDraft;
  /** Vault path of the `.base` the entry was made in. */
  base: string;
}

export function serializePinboardEntryRef(ref: PinboardEntryRef): string {
  return JSON.stringify(ref);
}

const isChip = (c: unknown): c is PinboardEntryChip =>
  !!c && typeof c === "object" &&
  typeof (c as PinboardEntryChip).id === "string" &&
  ((c as PinboardEntryChip).kind === "tag" || (c as PinboardEntryChip).kind === "value") &&
  typeof (c as PinboardEntryChip).key === "string" &&
  typeof (c as PinboardEntryChip).value === "string";

export function parsePinboardEntryRef(path: string): PinboardEntryRef | null {
  try {
    const raw = JSON.parse(path) as { draft?: Partial<PinboardDraft>; base?: unknown };
    const d = raw?.draft;
    if (!d || typeof d.path !== "string" || !d.path || typeof d.stem !== "string" || typeof d.initial !== "string") return null;
    return {
      base: typeof raw.base === "string" ? raw.base : "",
      draft: {
        path: d.path,
        folder: typeof d.folder === "string" ? d.folder : "",
        stem: d.stem,
        initial: d.initial,
        caret: typeof d.caret === "number" ? d.caret : null,
        chips: Array.isArray(d.chips) ? d.chips.filter(isChip) : [],
      },
    };
  } catch {
    return null;
  }
}
