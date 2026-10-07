import { Fragment } from "react";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "../lib/iconSizes";
import type { SuggestedProperty } from "../lib/propertySuggestion";
import { wordDiff } from "../lib/wordDiff";

/**
 * The before/after of a suggestion on one line (K5): struck words in the
 * deletion tone, new words in the insertion tone, untouched words plain.
 * Shared by the desktop card and the phone's sheet so both read the same.
 */
export function SuggestionDiff({ quote, replacement, deletesLabel }: { quote: string; replacement: string; deletesLabel: string }) {
  const segments = wordDiff(quote, replacement);
  return (
    <p className="pv-comment-card__diff" data-testid="comment-diff">
      {segments.map((segment, index) =>
        segment.kind === "same" ? <Fragment key={index}>{segment.text}</Fragment>
        : segment.kind === "del" ? <del key={index}>{segment.text}</del>
        : <ins key={index}>{segment.text}</ins>,
      )}
      {replacement.length === 0 && <em className="pv-comment-card__diff-note"> {deletesLabel}</em>}
    </p>
  );
}

/**
 * A property's before and after on one line — its name in front, what it said
 * struck out, what it would say inserted. The line of a suggestion's card, and
 * of the sheet a database's cell opens (plan KI-Harness P5-4): the same
 * proposal reads the same wherever it is decided.
 */
export function PropertyDiffLine({ view }: { view: Pick<SuggestedProperty, "key" | "before" | "after" | "removed"> }) {
  const { t } = useTranslation();
  return (
    <p className="pv-comment-card__diff" data-testid="comment-diff" data-property={view.key}>
      <span className="pv-comment-card__prop">{view.key}</span>
      {view.before && <del>{view.before}</del>}
      {view.before && view.after && " "}
      {view.after && <ins>{view.after}</ins>}
      {view.removed && <em className="pv-comment-card__diff-note"> {t("comments.suggestionPropertyRemoves")}</em>}
    </p>
  );
}

/**
 * A proposed value of a property (plan KI-Harness P5-3), as both shells'
 * cards show it — one block, so the column and the sheet cannot say
 * different things about the same suggestion:
 *
 * - a small label that says what this is: "Property", or "New property"
 *   where the note has none of that name;
 * - the same line as a passage's before and after, with the property's name
 *   in front: what it said struck out, what it would say inserted — a round
 *   that changes text and properties reads as one;
 * - and, only while the suggestion waits (`open`), the sentence that it no
 *   longer fits, where accepting would find no place for it.
 */
export function PropertySuggestionDiff({ view, open }: { view: SuggestedProperty; open: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="pv-comment-card__property" data-testid="comment-property" data-property={view.key}>
      <span className="pv-comment-card__proplabel" data-testid="comment-property-label">
        <Hash size={ICON.meta} aria-hidden="true" />
        {t(view.added ? "comments.suggestionPropertyNew" : "comments.suggestionProperty")}
      </span>
      <PropertyDiffLine view={view} />
      {open && view.stale && (
        <span className="pv-comment-card__state" data-testid="comment-property-stale">
          {t("comments.suggestionPropertyChanged", { key: view.key })}
        </span>
      )}
    </div>
  );
}
