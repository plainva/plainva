import { Fragment } from "react";
import { parseCommentMentions } from "../lib/commentMentions";
import { parseInlineMarkdown } from "../lib/inlineMarkdown";
import { renderInlineNodes } from "../lib/inlineReact";

/**
 * The text of a remark, with `@Name` lifted out and links made clickable (K4).
 *
 * Shared by the desktop column and the phone's sheet. Two things are derived
 * here on every render and never stored: the mentions (from the member list,
 * so a renamed member changes what the card shows) and the inline Markdown
 * (a `[[wiki link]]`, a `[label](url)`, a bare URL, bold and code). The reply
 * that "turn into task" writes is exactly such a wiki link - before K4 it was
 * printed as raw brackets, so the way to the task was a sentence to read, not
 * a thing to click.
 *
 * A link stops the click at itself: the card around it selects on click, and
 * following a link is not selecting the card.
 */
export interface CommentBodyProps {
  body: string;
  names: ReadonlyMap<string, string>;
  /** Wiki target (or vault path) of a link the reader tapped. */
  onOpenNote?: (target: string) => void;
  /** External http(s) URL the reader tapped. */
  onOpenUrl?: (url: string) => void;
}

export function CommentBody({ body, names, onOpenNote, onOpenUrl }: CommentBodyProps) {
  const handlers = { onOpenNote, onOpenUrl };
  return (
    <span className="pv-comment-card__body">
      {parseCommentMentions(body, names).map((segment, index) =>
        segment.kind === "mention" ? (
          <span key={index} className="pv-comment-card__mention" data-tip={segment.memberId}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{renderInlineNodes(parseInlineMarkdown(segment.text), String(index), handlers, "pv-comment-card__link")}</Fragment>
        ),
      )}
    </span>
  );
}
