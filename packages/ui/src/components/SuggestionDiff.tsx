import { Fragment } from "react";
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
