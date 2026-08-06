import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Menu, Search } from "lucide-react";
import { ICON, IconButton } from "@plainva/ui";
import { resetChromeScroll, setChromeScroll } from "../services/chromeScroll";

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
const CHROME_SCROLL_DEAD_ZONE = 24;

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
  /**
   * Object actions, right of search. `⋮` belongs here — settings never do.
   *
   * Pass it AFTER `title`: the design ratchet reads a component tag up to the
   * first `>`, and an element inside a prop brings that forward, so props
   * written after it are mistaken for DOM attributes.
   */
  actions?: ReactNode;
  /** Replaces the plain heading (a surface whose title is itself a control). */
  titleAs?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const lastTop = useRef(0);

  // The bar raises itself against whatever actually scrolls beneath it. Which
  // element that is differs per screen, so it is looked up rather than assumed
  // — an assumption here would silently leave single screens flat.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    const target: HTMLElement | Window = scroller ?? window;
    const read = () => {
      const top = scroller ? scroller.scrollTop : window.scrollY;
      setScrolled(top > 2);
      // Direction, with a dead zone: a bar that flips on every pixel of
      // rubber-banding is worse than one that never moves. It comes back on the
      // first deliberate move upwards, and always near the top.
      const delta = top - lastTop.current;
      if (Math.abs(delta) > CHROME_SCROLL_DEAD_ZONE) {
        setChromeScroll({ scrolled: top > 2, away: delta > 0 && top > 48 });
        lastTop.current = top;
      } else if (top <= 2) {
        setChromeScroll({ scrolled: false, away: false });
        lastTop.current = top;
      }
    };
    resetChromeScroll();
    lastTop.current = 0;
    read();
    target.addEventListener("scroll", read, { passive: true });
    return () => target.removeEventListener("scroll", read);
  }, []);

  return (
    <header
      className={`m-appbar${large ? " m-appbar--lg" : ""}${scrolled ? " is-scrolled" : ""}${className ? ` ${className}` : ""}`}
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
        {titleAs ?? (
          <div className="m-appbar-ttl">
            <h1>{title}</h1>
            {subtitle !== undefined && subtitle !== null && subtitle !== "" && (
              <p className="m-appbar-sub">{subtitle}</p>
            )}
          </div>
        )}
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
