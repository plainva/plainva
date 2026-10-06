import { Fragment, useMemo, type ReactNode } from "react";
import { parseInlineMarkdown } from "../lib/inlineMarkdown";
import { renderInlineNodes, type InlineReactHandlers } from "../lib/inlineReact";
import { parseAnswer, type AnswerBlock } from "./answerBlocks";

/**
 * An AI answer as the reader sees it (P1a). Untrusted text: blocks and inline
 * nodes become React elements, never HTML; an image is a link that loads
 * nothing; a web address opens only through `onOpenUrl`, which the shell
 * routes through its confirmation. `urlNote` marks an address the model
 * composed itself (plan KI-Harness P4): it is the one that could carry
 * something from the conversation with it.
 */
export interface AiAnswerProps extends InlineReactHandlers {
  text: string;
}

function inline(text: string, key: string, handlers: InlineReactHandlers): ReactNode {
  return <Fragment key={key}>{renderInlineNodes(parseInlineMarkdown(text), key, handlers, "pv-ai-link")}</Fragment>;
}

function lines(text: string, key: string, handlers: InlineReactHandlers): ReactNode[] {
  return text.split("\n").flatMap((line, i) => (i === 0 ? [inline(line, `${key}-${i}`, handlers)] : [<br key={`${key}-br-${i}`} />, inline(line, `${key}-${i}`, handlers)]));
}

function block(b: AnswerBlock, key: string, handlers: InlineReactHandlers): ReactNode {
  switch (b.kind) {
    case "paragraph":
      return <p key={key}>{lines(b.text, key, handlers)}</p>;
    case "heading":
      // Headings inside an answer stay small: the answer is part of a conversation, not a document.
      return (
        <p key={key} className="pv-ai-heading" role="heading" aria-level={Math.min(6, b.level + 2)}>
          {inline(b.text, key, handlers)}
        </p>
      );
    case "list": {
      const items = b.items.map((item, i) => (
        <li key={`${key}-${i}`} className={item.depth ? "pv-ai-li--nested" : undefined} data-depth={item.depth || undefined}>
          {item.task ? <span className={`pv-ai-box${item.task === "done" ? " is-done" : ""}`} aria-hidden="true" /> : null}
          {lines(item.text, `${key}-${i}`, handlers)}
        </li>
      ));
      return b.ordered ? (
        <ol key={key} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "quote":
      return <blockquote key={key}>{b.blocks.map((inner, i) => block(inner, `${key}-${i}`, handlers))}</blockquote>;
    case "code":
      return (
        <pre key={key} className="pv-ai-code" data-lang={b.lang || undefined}>
          <code>{b.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} />;
    case "table":
      return (
        <div key={key} className="pv-ai-table">
          <table>
            <thead>
              <tr>
                {b.header.map((cell, i) => (
                  <th key={i}>{inline(cell, `${key}-h${i}`, handlers)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell, `${key}-${r}-${c}`, handlers)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function AiAnswer({ text, onOpenNote, onOpenUrl, urlNote }: AiAnswerProps) {
  const blocks = useMemo(() => parseAnswer(text), [text]);
  const handlers = { onOpenNote, onOpenUrl, urlNote };
  return <div className="pv-ai-answer">{blocks.map((b, i) => block(b, `b${i}`, handlers))}</div>;
}
