import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "../../lib/iconSizes";
import { useStableHandler } from "../../lib/useStableHandler";
import { userGuideUrl } from "../../lib/docsLinks";
import { getPlatformServices, hasPlatformServices } from "../../platform/services";
import { Button } from "./Button";
import { cx } from "./cx";
import { useFixedPopover } from "./useFixedPopover";
import { useOutsidePress } from "./useOutsidePress";

/**
 * What stands behind an info button: plain text (paragraphs split at a blank
 * line) and, optionally, the user-guide page that says more.
 *
 * Text and not markup on purpose: the settings search reads the same string
 * (settings plan 2026-10-29, § 4.3), and every one of them is a locale key in
 * all ten languages.
 */
export type InfoContent = string | { text: string; guide?: string };

/** The text of an `InfoContent`. */
export function infoText(info: InfoContent): string {
  return typeof info === "string" ? info : info.text;
}

/** The user-guide page of an `InfoContent` (`"Search.md"`, `"Journal.md#the-day-ends-at"`). */
export function infoGuide(info: InfoContent): string | undefined {
  return typeof info === "string" ? undefined : info.guide;
}

/** The web address of a guide page in the app language, with an optional `#anchor`. */
export function infoGuideUrl(guide: string, language?: string): string {
  const at = guide.indexOf("#");
  const page = at < 0 ? guide : guide.slice(0, at);
  const url = userGuideUrl(page, language);
  return at < 0 ? url : `${url}${guide.slice(at)}`;
}

export interface InfoTipProps {
  /** The label the button belongs to: it names the button and titles the phone's sheet. */
  label: string;
  info: InfoContent;
  testId?: string;
  className?: string;
}

/**
 * The info button (ⓘ) at the end of a label or heading (settings plan
 * 2026-10-29, § 3, decision E1).
 *
 * A setting keeps visible what someone needs to avoid a wrong, irreversible or
 * unnoticed decision; a general explanation goes behind this button. It is a
 * real button and not a hover tooltip, because the phone has no hover and the
 * app's tooltip is hidden from screen readers (`TooltipHost` is aria-hidden):
 * a press, Enter or Space opens it, Escape, a press beside it or a second
 * press closes it, and the text is announced through a polite live region,
 * not `aria-describedby` (which would read it with every focus of the button).
 *
 * One component, two presentations, and the shell decides which: a shell that
 * registers a sheet in its platform services (the phone) shows the text in
 * that sheet; the desktop shows it in a popover anchored at the button.
 */
export function InfoTip({ label, info, testId = "info-tip", className }: InfoTipProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const Sheet = hasPlatformServices() ? getPlatformServices().Sheet : undefined;
  const popRef = useFixedPopover(open && !Sheet, buttonRef, { minWidth: 0 });
  const text = infoText(info);
  const guide = infoGuide(info);
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (!refocus) return;
    // The focus goes back to the button when it was inside, or nowhere.
    const now = document.activeElement;
    if (now === null || now === document.body || wrapRef.current?.contains(now)) buttonRef.current?.focus({ preventScroll: true });
  };

  useOutsidePress(open && !Sheet, () => setOpen(false), wrapRef);

  // Escape is the panel's first, before a dialog around it hears the key: the
  // settings window is a dialog, and one Escape must not close both.
  const closeOnEscape = useStableHandler(() => close(true));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      closeOnEscape();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closeOnEscape]);

  const openGuide = (event?: MouseEvent) => {
    event?.preventDefault();
    if (!guide || !hasPlatformServices()) return;
    void getPlatformServices().openExternal(infoGuideUrl(guide, i18n.language)).catch(() => undefined);
  };

  const body = paragraphs.map((part, index) => <span key={index} className="pv-infotip-text">{part}</span>);

  return (
    // A press inside belongs to the button and its panel, never to the row
    // around it: a phone row that leads somewhere would follow the press.
    <span ref={wrapRef} className={cx("pv-infotip-wrap", className)} onClick={(e) => e.stopPropagation()} data-testid={testId}>
      <button
        ref={buttonRef}
        type="button"
        className="pv-infotip"
        aria-label={t("infoTip.more", { label })}
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        data-testid={`${testId}-button`}
      >
        <Info size={ICON.ui} aria-hidden="true" />
      </button>
      <span role="status" className={Sheet ? "pv-infotip-live" : undefined}>
        {open && !Sheet && (
          <span ref={popRef as unknown as RefObject<HTMLSpanElement>} className="pv-popover pv-popover--fixed pv-infotip-panel" data-testid={`${testId}-panel`}>
            {body}
            {guide && (
              <a className="pv-infotip-guide" href={infoGuideUrl(guide, i18n.language)} onClick={openGuide} data-testid={`${testId}-guide`}>
                {t("infoTip.guide")} <span aria-hidden="true">›</span>
              </a>
            )}
          </span>
        )}
        {open && Sheet && text}
      </span>
      {open && Sheet && (
        <Sheet title={label} onClose={() => close(true)} testId={`${testId}-sheet`}>
          {paragraphs.map((part, index) => <p key={index} className="pv-infotip-sheettext">{part}</p>)}
          {guide && (
            <Button variant="ghost" onClick={() => openGuide()} data-testid={`${testId}-guide`}>
              {t("infoTip.guide")}
            </Button>
          )}
        </Sheet>
      )}
    </span>
  );
}

export interface InfoLabelProps {
  /** The visible label; it wraps like any text. */
  children: ReactNode;
  /** What stands behind the button; without it the label stands alone. */
  info?: InfoContent;
  /** The button's name (the label as text). */
  name: string;
  testId?: string;
}

/**
 * A label with its info button at the end, the button glued to the label's
 * last word (finding 2026-10-30: under six settings the ⓘ dropped alone onto a
 * line of its own).
 *
 * The label still wraps between its words; its last word and the button sit
 * in one span that does not wrap (`.pv-infotip-glue`), so a line breaks before
 * that word, never between it and the button. Only a span that holds both
 * does this in every engine: a `nowrap` parent around a wrapping label still
 * let Chromium break at the label's end. A label that is markup cannot be
 * split; it keeps the button after it.
 */
export function InfoLabel({ children, info, name, testId }: InfoLabelProps) {
  if (info === undefined) return <>{children}</>;
  const button = <InfoTip label={name} info={info} testId={testId} />;
  if (typeof children !== "string") return <>{children}{button}</>;
  const text = children.trimEnd();
  // Back from the end to the last whitespace: where the last word starts.
  let at = text.length;
  while (at > 0 && !/\s/.test(text[at - 1])) at -= 1;
  // One span around both parts, so a flex heading (`SectionLabel`) sees one item, not two.
  return (
    <span className="pv-infotip-label">
      {text.slice(0, at)}
      <span className="pv-infotip-glue">{text.slice(at)}{button}</span>
    </span>
  );
}
