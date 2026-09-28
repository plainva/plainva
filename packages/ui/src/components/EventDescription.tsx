import React, { Fragment, useMemo } from "react";
import { Link2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, type ButtonSize } from "./ui/Button";
import { ICON } from "../lib/iconSizes";
import {
  meetingJoinOf,
  parseEventDescription,
  type EventDescInline,
  type EventLinkView,
} from "../pim/eventDescription";

/**
 * The description of a calendar event, as both previews show it (plan Befunde
 * 24.09., E25; pattern: `CommentBody`).
 *
 * The text is rendered as React elements from the linear parser in
 * `pim/eventDescription.ts` — never as HTML. A link is a small chip that shows
 * the HOST it leads to; its click goes to `onOpenUrl` with the original
 * address. The desktop used to render the description through
 * `markdownToHtml` into `dangerouslySetInnerHTML`, where a click never reached
 * the app's URL opener and the chip text was a page of percent-encoding; the
 * phone showed the raw Markdown in a paragraph nobody could tap.
 *
 * A Microsoft Safe Link shows its target's host plus a line saying it goes
 * through Safe Links — and opens the Safe Link itself, so the organisation's
 * check still runs.
 */
export interface EventDescriptionProps {
  text: string;
  /** Opens an http(s) address in the system browser. */
  onOpenUrl: (url: string) => void;
  className?: string;
  "data-testid"?: string;
}

function LinkChip({ link, label, onOpenUrl }: { link: EventLinkView; label: string | null; onOpenUrl: (url: string) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <a
        className="pv-evtdesc__link"
        href={link.href}
        data-tip={link.tip}
        // The href is there for the context menu and assistive technology; the
        // click itself belongs to the shell's opener (a WebView would navigate
        // itself away otherwise).
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenUrl(link.href);
        }}
      >
        <Link2 size={ICON.meta} aria-hidden />
        {label ? (
          <>
            <span className="pv-evtdesc__label">{label}</span>
            <span className="pv-evtdesc__host">{link.host}</span>
          </>
        ) : (
          <span className="pv-evtdesc__label">{link.host}</span>
        )}
      </a>
      {link.viaSafeLinks ? (
        <span className="pv-evtdesc__via">{t("pim.viaSafeLinks", { defaultValue: "über Microsoft Safe Links" })}</span>
      ) : null}
    </>
  );
}

function renderInline(nodes: EventDescInline[], key: string, onOpenUrl: (url: string) => void): React.ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}-${index}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={k}>{node.text}</Fragment>;
      case "code":
        return <code key={k}>{node.text}</code>;
      case "strong":
        return <strong key={k}>{renderInline(node.children, k, onOpenUrl)}</strong>;
      case "em":
        return <em key={k}>{renderInline(node.children, k, onOpenUrl)}</em>;
      case "link":
        return <LinkChip key={k} link={node.link} label={node.label} onOpenUrl={onOpenUrl} />;
      default:
        return null;
    }
  });
}

export function EventDescription({ text, onOpenUrl, className, "data-testid": testId }: EventDescriptionProps) {
  const blocks = useMemo(() => parseEventDescription(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <div className={className ? `pv-evtdesc ${className}` : "pv-evtdesc"} data-testid={testId}>
      {blocks.map((block, index) => {
        const key = String(index);
        if (block.kind === "h") return <p key={key} className="pv-evtdesc__head">{renderInline(block.inline, key, onOpenUrl)}</p>;
        if (block.kind === "ul") {
          return (
            <ul key={key}>
              {block.items.map((item, i) => (
                <li key={i}>{renderInline(item, `${key}-${i}`, onOpenUrl)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {renderInline(line, `${key}-${i}`, onOpenUrl)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * "Join" for an online meeting (E25): the provider's own join link
 * (`meetingUrl`), which was synced and cached but shown nowhere. Named after
 * the service when the link's host says which one it is ("Join · Teams").
 * Renders nothing for an event without an http(s) join link.
 */
export function EventJoinButton({
  meetingUrl,
  onOpenUrl,
  className,
  size = "sm",
}: {
  meetingUrl?: string | null;
  onOpenUrl: (url: string) => void;
  className?: string;
  /** The phone takes the touch size; the desktop window the compact one. */
  size?: ButtonSize;
}) {
  const { t } = useTranslation();
  const join = meetingJoinOf(meetingUrl);
  if (!join) return null;
  return (
    <Button
      variant="primary"
      size={size}
      className={className ? `pv-evtjoin ${className}` : "pv-evtjoin"}
      icon={<Video size={ICON.ui} />}
      onClick={() => onOpenUrl(join.href)}
      data-testid="event-join"
    >
      {join.service
        ? t("pim.joinVia", { defaultValue: "Teilnehmen · {{service}}", service: join.service })
        : t("pim.join", { defaultValue: "Teilnehmen" })}
    </Button>
  );
}
