import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Menu, Search } from "lucide-react";
import { ICON, IconButton } from "@plainva/ui";
import { chromeScrollPublisher, resetChromeScroll, type ChromeScroll } from "../services/chromeScroll";

/**
 * The app bar — ONE header for every surface (redesign P2 / S11).
 *
 * The phone had two: 26 screens rendered `.m-header` (22 px, weight 500, 8 px
 * edge, a permanent shadow) and exactly ONE rendered `.m-appbar` (24 px, weight
 * 750, 18 px edge, no shadow) — and that one was the start screen. Every step
 * inward therefore changed title size, weight, left edge and elevation at once.
 * That is the moment the app looked self-built, before a word had been read.
 *
 * The anatomy is the mockup's, on every screen: back on the left, title (plus
 * an optional line of context) in the middle, actions on the right. Only two
 * things differ between a root and a pushed surface — the back arrow, and one
 * step of title size.
 *
 * The elevation is M3's: none while the content sits at the top, a shadow as
 * soon as it scrolls under the bar. `.m-topbar` already carried exactly that
 * behaviour and was dead code, referenced nowhere; it lives here now.
 */
/**
 * Movement below which the chrome ignores a scroll event.
 *
 * It was 6px, and that was smaller than the layout shift the state change
 * ITSELF caused: `is-away` collapsed ~21px of bar, the browser corrected
 * `scrollTop` by the same amount at the bottom of a page, and the resulting
 * event flipped the state straight back — a closed loop the dead zone could
 * not damp because it sat inside it (§ 3.8).
 *
 * N1.1 removes the loop structurally by floating the bar, so nothing the bar
 * does reaches the scroll height any more. This value is the second lock:
 * dimensioned ABOVE that former shift, so that even if some later change put a
 * height-changing element back into the flow, a single correction could not
 * start the oscillation again.
 */


export function AppBar({
  onBack,
  onMenu,
  title,
  subtitle,
  large = false,
  onSearch,
  actions,
  titleAs,
  className,
  testId,
  scrollState,
}: {
  /** Absent on a tab root — there is nothing to go back to. */
  onBack?: () => void;
  /**
   * App settings, in the leading slot of a ROOT surface (N1.5, E7).
   *
   * They used to be a row at the foot of the navigator: reachable only from
   * Home, and only after scrolling to the end of it. Here they are one tap
   * from every root.
   *
   * `onBack` wins the slot when both are given — that is M3's definition of
   * it, and on a pushed surface going back is the more urgent of the two.
   * The tap opens the existing settings destination; this is not a drawer.
   */
  onMenu?: () => void;
  title: ReactNode;
  /** One line of context: where this is, or what state it is in. */
  subtitle?: ReactNode;
  /** Tab roots carry the larger title. */
  large?: boolean;
  onSearch?: () => void;
  /** Object actions, right of search. `⋮` belongs here — settings never do. */
  actions?: ReactNode;
  /**
   * Replaces the plain heading (a surface whose title is itself a control).
   * It lands in the same flexible holder the heading has, so it spans the row
   * up to the actions; to be narrower, the caller limits it.
   */
  titleAs?: ReactNode;
  className?: string;
  /** Names the surface for the screenshot baseline's `requires` proof (5.7): a surface that renders this bar shows its subject. */
  testId?: string;
  /** A nested editor publishes its own scroll state. */
  scrollState?: ChromeScroll;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // The bar raises itself against whatever actually scrolls beneath it. Which
  // element that is differs per screen, so it is looked up rather than assumed
  // — an assumption here would silently leave single screens flat.
  useEffect(() => {
    const el = ref.current;
    if (!el || scrollState !== undefined) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    const target: HTMLElement | Window = scroller ?? window;
    const publish = chromeScrollPublisher();
    const read = () => {
      const top = scroller ? scroller.scrollTop : window.scrollY;
      setScrolled(top > 2); publish(top);
    };
    resetChromeScroll();
    read();
    target.addEventListener("scroll", read, { passive: true });
    return () => target.removeEventListener("scroll", read);
  }, [scrollState]);

  return (
    <header
      className={`m-appbar${large ? " m-appbar--lg" : ""}${(scrollState?.scrolled ?? scrolled) ? " is-scrolled" : ""}${className ? ` ${className}` : ""}`}
      data-testid={testId}
      ref={ref}
    >
      <div className="m-appbar-row">
        {onBack ? (
          <IconButton label={t("common.back")} onClick={onBack}>
            <ChevronLeft size={ICON.touch} />
          </IconButton>
        ) : (
          onMenu && (
            <IconButton data-testid="nav-settings" label={t("mobile.sectionSettings")} onClick={onMenu}>
              <Menu size={ICON.touch} />
            </IconButton>
          )
        )}
        {/* The title slot is the bar's ONE flexible holder, whatever sits in
            it (finding 2026-09-24, E19). A control used to be rendered in
            place of the holder instead of inside it, so it got no share of
            the row and stayed as wide as its own content — the search field
            ended at 60 % of the bar once a sort button stood beside it. A
            control here takes the row; a caller that wants less limits it. */}
        <div className="m-appbar-ttl">
          {titleAs ?? (
            <>
              <h1>{title}</h1>
              {subtitle !== undefined && subtitle !== null && subtitle !== "" && (
                <p className="m-appbar-sub">{subtitle}</p>
              )}
            </>
          )}
        </div>
        <span className="m-headactions">
          {onSearch && (
            <IconButton label={t("sidebar.search")} data-testid="appbar-search" onClick={onSearch}>
              <Search size={ICON.head} />
            </IconButton>
          )}
          {actions}
        </span>
      </div>
    </header>
  );
}
