import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./cx";

export interface ScrollEdgeProps {
  children: ReactNode;
  /** Classes for the inner scroller (e.g. "custom-scrollbar"). */
  className?: string;
  /** Extra styles for the inner scroller — pass maxHeight, gap, padding here. */
  style?: CSSProperties;
}

/**
 * Scroll-edge container (Plainva UI 2.0 / M3 Expressive): wraps a scrolling
 * region and shows a subtle bottom shadow ONLY while there is content scrolled
 * below the edge, so the last row is never obscured when everything fits. The
 * shadow fades out toward the horizontal edges (see .pv-scroll-edge in ui.css).
 * The children are the scroller's content; pass maxHeight/gap/padding via style.
 */
export function ScrollEdge({ children, className, style }: ScrollEdgeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setOverflow(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    update();
    // Content can arrive after mount (async recent vaults); the box height is
    // capped so a ResizeObserver wouldn't fire on content growth — watch the
    // DOM and the window instead.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className={cx("pv-scroll-edge", overflow && "is-overflow")}>
      <div
        ref={ref}
        className={className}
        style={{ overflowY: "auto", ...style }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setOverflow(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
        }}
      >
        {children}
      </div>
    </div>
  );
}
