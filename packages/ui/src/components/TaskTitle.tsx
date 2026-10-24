import { useMemo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { parseInlineMarkdown, type InlineLinkHandlers, type InlineNode } from "../lib/inlineMarkdown";
import { wikiLinkLabel } from "../lib/taskTitle";

/**
 * The title of a task in a task list (TestFlight wish of 2026-10-24, E3) —
 * the planner in both shells, the phone's "All" and Today, the desktop's "All".
 *
 * The title is Markdown. Links read as their text in the look of a link — a
 * wiki link as its alias or the note's name (`wikiLinkLabel`), in the
 * wiki-link style the device chose (`.pv-wiki-link`) — and a press on one opens
 * the note; a press anywhere else on the row still opens the task: the row
 * leaves a press that started on a link alone (`Row` with `controls`, the
 * phone's hold gesture likewise). Without `links` a link is only drawn.
 *
 * A link is read from the note the task stands in (`notePath`), as the editor
 * reads it there: of two notes with one name, the one beside it comes first.
 */
export interface TaskTitleProps {
  /** The title as Markdown — `taskDisplayText` of a checkbox, the name of a database entry. */
  text: string;
  /** The note the task stands in. */
  notePath: string;
  links?: InlineLinkHandlers;
}

export function TaskTitle({ text, notePath, links }: TaskTitleProps) {
  const nodes = useMemo(() => parseInlineMarkdown(text), [text]);
  const link = (key: string, label: string, className: string, open: ((newTab: boolean) => void) | undefined): ReactNode => {
    if (!open) return <span key={key} className={className}>{label}</span>;
    const activate = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      open(e.ctrlKey || e.metaKey);
    };
    return (
      <a
        key={key}
        className={className}
        role="link"
        tabIndex={0}
        data-testid="task-title-link"
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === "Enter") activate(e);
        }}
      >
        {label}
      </a>
    );
  };
  const render = (list: readonly InlineNode[], prefix: string): ReactNode[] =>
    list.map((n, i) => {
      const key = `${prefix}${i}`;
      switch (n.kind) {
        case "text":
          return <span key={key}>{n.text}</span>;
        case "code":
          return <code key={key}>{n.text}</code>;
        case "br":
          return <span key={key}> </span>;
        case "checkbox":
          return <span key={key}>{n.checked ? "☑" : "☐"}</span>;
        case "strong":
          return <strong key={key}>{render(n.children, `${key}.`)}</strong>;
        case "em":
          return <em key={key}>{render(n.children, `${key}.`)}</em>;
        case "strongEm":
          return (
            <strong key={key}>
              <em>{render(n.children, `${key}.`)}</em>
            </strong>
          );
        case "strike":
          return <s key={key}>{render(n.children, `${key}.`)}</s>;
        case "highlight":
          return <mark key={key}>{render(n.children, `${key}.`)}</mark>;
        case "wikiLink": {
          const open = links?.onOpenNote;
          // The anchor keeps its mark; the link rule reads it from the text.
          const target = n.target + (n.anchor ?? "");
          return link(key, wikiLinkLabel(n), "pv-wiki-link", open ? (newTab) => open(target, newTab, "wiki", notePath) : undefined);
        }
        case "link": {
          if (n.external) {
            const open = links?.onOpenUrl;
            return link(key, n.label, "pv-web-link", open ? () => open(n.href) : undefined);
          }
          // A Markdown link into the vault is a link to a note.
          const open = links?.onOpenNote;
          return link(key, n.label, "pv-wiki-link", open ? (newTab) => open(n.written, newTab, "markdown", notePath) : undefined);
        }
        case "url": {
          const open = links?.onOpenUrl;
          return link(key, n.href, "pv-web-link", open ? () => open(n.href) : undefined);
        }
        default:
          return null;
      }
    });
  return <span className="pv-task-title">{render(nodes, "")}</span>;
}
