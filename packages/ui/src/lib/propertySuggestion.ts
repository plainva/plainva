import { placeProposedProperty, proposedPropertyOf, resolveCommentAnchor, type WorkspaceCommentRecord } from "@plainva/core";

/**
 * A suggestion that proposes the value of a property, as a card shows it
 * (plan KI-Harness P5-3): the property's name, what it said when the
 * suggestion was made, and what it would say.
 *
 * Underneath it is a suggestion like every other — a passage of the note, the
 * property's entry, with something to stand in its place —, so accepting,
 * declining, rounds, conflicts and the sync are the ones every suggestion
 * has. This only reads it back so the card can show a property instead of a
 * line of YAML.
 */
export interface PropertySuggestionView {
  key: string;
  /** The value when the suggestion was made, in words; "" where the property had none. */
  before: string;
  /** The value it would have, in words; "" where the suggestion removes the property. */
  after: string;
  removed: boolean;
  /** The note had no such property: the suggestion adds it. */
  added: boolean;
}

/** A property's value in words, as a card shows it: a list as its items, nothing as nothing. */
export function propertyValueWords(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(propertyValueWords).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A proposed property as a surface with the note at hand shows it: with whether the proposal still fits. */
export interface SuggestedProperty extends PropertySuggestionView {
  /**
   * Accepting would find no place for it: the entry the suggestion was made
   * against is gone or says something else by now, or the note has the
   * property the suggestion wanted to add. The card says so instead of
   * offering it as if nothing had happened.
   */
  stale: boolean;
}

/**
 * For the suggestions of ONE note: which of them propose a property, what
 * they propose, and whether that still fits the note as it is — by comment
 * id. Both shells ask this where they have the note's text (the editor, the
 * note screen) and hand the answer to their cards, so the column and the
 * sheet say the same about the same suggestion.
 *
 * Whether it fits is the answer accepting itself would get
 * (`placeProposedProperty`, which `planCommentDecision` asks): a card never
 * offers what the decision would refuse. A suggestion that says at its anchor
 * which property it means also keeps the property vocabulary every build has
 * (the key decides whether the property is there); what this adds is the
 * passage underneath — the property's entry —, because only the entry can
 * tell that the VALUE changed.
 */
export function suggestedProperties(noteText: string, comments: readonly WorkspaceCommentRecord[]): Map<string, SuggestedProperty> {
  const found = new Map<string, SuggestedProperty>();
  for (const comment of comments) {
    if (!comment.suggestion || !comment.anchor) continue;
    // Cheap first: most suggestions propose a passage, and reading that takes no look at the note.
    if (proposedPropertyOf(comment.anchor, comment.suggestion.replacement) === null) continue;
    const resolution = resolveCommentAnchor(noteText, comment.anchor);
    const place = placeProposedProperty(noteText, comment.anchor, comment.suggestion.replacement, resolution.status === "orphan" ? null : resolution);
    // No place as a property: a line that merely looks like an entry, in front of a rule drawn in the text.
    if (!place) continue;
    const { key, value, previous, removed, added } = place.property;
    found.set(comment.commentId, { key, before: propertyValueWords(previous), after: removed ? "" : propertyValueWords(value), removed, added, stale: !place.fits });
  }
  return found;
}
