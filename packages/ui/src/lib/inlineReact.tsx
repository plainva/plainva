import React, { Fragment } from "react";
import type { InlineNode } from "./inlineMarkdown";

/**
 * Inline Markdown nodes as React elements — the one React rendering of
 * `parseInlineMarkdown`, shared by the comment card and the AI answer.
 * Elements only, never HTML: a tag in the text stays text. A link stops the
 * click at itself (the surface around it may select on click), and an image
 * written as `![alt](url)` is a link, so nothing loads until a person clicks.
 */
export interface InlineReactHandlers {
  /** Wiki target (or vault path) of a link the reader clicked. */
  onOpenNote?: (target: string) => void;
  /** External http(s) URL the reader clicked. */
  onOpenUrl?: (url: string) => void;
  /**
   * A remark on an external address the reader should see before following
   * it: its tooltip, and a mark on the link. Null for none. The AI answer
   * marks addresses the model composed itself (plan KI-Harness P4).
   */
  urlNote?: (url: string) => string | null;
}

/** The class and tooltip of an external link: marked where the surface has a remark on its address. */
function noted(linkClass: string, note: string | null | undefined): { className: string; "data-tip"?: string } {
  return note ? { className: `${linkClass} ${linkClass}--noted`, "data-tip": note } : { className: linkClass };
}

export function renderInlineNodes(nodes: InlineNode[], keyPrefix: string, handlers: InlineReactHandlers, linkClass: string): React.ReactNode[] {
  const stop = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{node.text}</Fragment>;
      case "br":
        return <br key={key} />;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "strong":
        return <strong key={key}>{renderInlineNodes(node.children, key, handlers, linkClass)}</strong>;
      case "em":
        return <em key={key}>{renderInlineNodes(node.children, key, handlers, linkClass)}</em>;
      case "strongEm":
        return (
          <strong key={key}>
            <em>{renderInlineNodes(node.children, key, handlers, linkClass)}</em>
          </strong>
        );
      case "strike":
        return <s key={key}>{renderInlineNodes(node.children, key, handlers, linkClass)}</s>;
      case "highlight":
        return <mark key={key}>{renderInlineNodes(node.children, key, handlers, linkClass)}</mark>;
      case "wikiLink":
        return (
          <a
            key={key}
            href="#"
            className={linkClass}
            data-wiki-target={node.target}
            onClick={(event) => {
              stop(event);
              handlers.onOpenNote?.(node.target);
            }}
          >
            {node.display}
          </a>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            {...noted(linkClass, node.external ? handlers.urlNote?.(node.href) : null)}
            onClick={(event) => {
              stop(event);
              if (node.external) handlers.onOpenUrl?.(node.href);
              else handlers.onOpenNote?.(node.href);
            }}
          >
            {node.label}
          </a>
        );
      case "url":
        return (
          <a
            key={key}
            href={node.href}
            {...noted(linkClass, handlers.urlNote?.(node.href))}
            onClick={(event) => {
              stop(event);
              handlers.onOpenUrl?.(node.href);
            }}
          >
            {node.href}
          </a>
        );
      default:
        return null;
    }
  });
}
