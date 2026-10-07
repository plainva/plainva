/**
 * Writing (plan KI-Harness P5, ADR 0019 §2): what an assistant's wish to
 * change the vault becomes. It never changes it. A change to a note that is
 * there becomes a suggestion on that note — its text (`edits`) or one of its
 * properties (`properties`) —, something that is not there yet becomes a
 * draft (`drafts`), and whatever cannot be reviewed part by part becomes a
 * plan the user confirms. `authors` is who such a write is signed with.
 *
 * Everything here is rules without a vault: what a passage is, where an
 * entry of the properties begins and ends, what a draft has to look like when
 * it is read from disk. Laying a suggestion on a note, keeping the drafts and
 * carrying a plan out is packages/ui/src/ai.
 */
export * from "./authors.js";
export * from "./edits.js";
export * from "./properties.js";
export * from "./drafts.js";
