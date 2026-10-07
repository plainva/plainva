import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { LinkTarget } from "../lib/linkTarget";
import { attachMailLinks, mailTextSegments, type MailLinkEvents } from "./mailLinks";

/**
 * Where a link leads, as one line of text (plan Befunde 06.10., M1; pattern in
 * `Design_Language.md`, "Link target"). The desktop's bar at the foot of a
 * message and the phone's link sheet both draw THIS, so the two cannot word a
 * warning differently.
 *
 * The host is the emphasised part — it is what answers "where". A Safe Link
 * shows its real target and says it goes through Safe Links; a link whose
 * visible text names another host says so, and the caller paints the whole
 * line in the warning tone (`link.textHost !== null`).
 */
export function LinkTargetText({ link }: { link: LinkTarget }) {
  const { t } = useTranslation();
  return (
    <span className="pv-linktarget">
      <span className="pv-linktarget__url" data-testid="link-target-url">
        {link.textHost ? `${t("mail.linkLeadsTo", { defaultValue: "Führt zu:" })} ` : ""}
        {link.before}
        <b data-testid="link-target-host">{link.host}</b>
        {link.after}
      </span>
      {link.viaSafeLinks ? (
        <span className="pv-linktarget__note" data-testid="link-target-safelinks">
          {t("pim.viaSafeLinks", { defaultValue: "über Microsoft Safe Links" })}
        </span>
      ) : null}
      {link.textHost ? (
        <span className="pv-linktarget__note" data-testid="link-target-mismatch">
          {t("mail.linkTextDiffers", { defaultValue: "der Text nennt eine andere Adresse" })}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A plain-text mail body with its addresses as links (M1). The text is kept
 * character for character and rendered as elements — never as HTML — and the
 * links answer through the same wiring as the links of an HTML body
 * (`attachMailLinks`): the shell opens them, and is told which one is pointed
 * at or held.
 */
export function MailPlainText({
  text,
  events,
  className,
  "data-testid": testId,
}: {
  text: string;
  events: MailLinkEvents;
  className?: string;
  "data-testid"?: string;
}) {
  const segments = useMemo(() => mailTextSegments(text), [text]);
  const ref = useRef<HTMLPreElement>(null);
  // The listeners are attached once per body; they read the newest callbacks
  // through this ref, so a re-render of the shell does not re-wire them.
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });
  const holds = !!events.onHold;
  const points = !!events.onPoint;
  const holdMs = events.holdMs;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachMailLinks(el, {
      onOpen: (link) => latest.current.onOpen(link),
      onPoint: points ? (link) => latest.current.onPoint?.(link) : undefined,
      onHold: holds ? (link, at) => latest.current.onHold?.(link, at) : undefined,
      holdMs,
    });
  }, [holds, points, holdMs, segments]);

  return (
    <pre ref={ref} className={className} data-testid={testId}>
      {segments.map((segment, index) =>
        segment.kind === "link" ? (
          <a key={index} className="pv-maillink" href={segment.href} rel="noreferrer noopener">
            {segment.text}
          </a>
        ) : (
          segment.text
        )
      )}
    </pre>
  );
}
