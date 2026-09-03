import React, { Fragment } from "react";
import { parseCommentMentions } from "../lib/commentMentions";
import { parseInlineMarkdown, type InlineNode } from "../lib/inlineMarkdown";

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

function renderNodes(nodes: InlineNode[], keyPrefix: string, handlers: Pick<CommentBodyProps, "onOpenNote" | "onOpenUrl">): React.ReactNode[] {
  const stop = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); };
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case "text": return <Fragment key={key}>{node.text}</Fragment>;
      case "br": return <br key={key} />;
      case "code": return <code key={key}>{node.text}</code>;
      case "strong": return <strong key={key}>{renderNodes(node.children, key, handlers)}</strong>;
      case "em": return <em key={key}>{renderNodes(node.children, key, handlers)}</em>;
      case "strongEm": return <strong key={key}><em>{renderNodes(node.children, key, handlers)}</em></strong>;
      case "strike": return <s key={key}>{renderNodes(node.children, key, handlers)}</s>;
      case "highlight": return <mark key={key}>{renderNodes(node.children, key, handlers)}</mark>;
      case "wikiLink":
        return (
          <a
            key={key}
            href="#"
            className="pv-comment-card__link"
            data-wiki-target={node.target}
            onClick={(event) => { stop(event); handlers.onOpenNote?.(node.target); }}
          >
            {node.display}
          </a>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            className="pv-comment-card__link"
            onClick={(event) => { stop(event); if (node.external) handlers.onOpenUrl?.(node.href); else handlers.onOpenNote?.(node.href); }}
          >
            {node.label}
          </a>
        );
      case "url":
        return (
          <a key={key} href={node.href} className="pv-comment-card__link" onClick={(event) => { stop(event); handlers.onOpenUrl?.(node.href); }}>
            {node.href}
          </a>
        );
      default: return null;
    }
  });
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
          <Fragment key={index}>{renderNodes(parseInlineMarkdown(segment.text), String(index), handlers)}</Fragment>
        ),
      )}
    </span>
  );
}
