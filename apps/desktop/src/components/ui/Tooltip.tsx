import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Global tooltip host (plan Designsprache P2, E7). Mounted ONCE (main.tsx);
 * event delegation on [data-tip] replaces native title= tooltips so hints
 * follow the theme (and LCARS can restyle them). Shows after a short delay on
 * hover or keyboard focus; hides on leave, blur, scroll, any key or press.
 * Accessible names stay on aria-label — data-tip is presentation only.
 */

const SHOW_DELAY_MS = 500;
const MARGIN = 8;

interface Pending {
  text: string;
  rect: { left: number; right: number; top: number; bottom: number; width: number };
}

export function TooltipHost() {
  const [tip, setTip] = useState<Pending | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let target: HTMLElement | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      target = null;
      setTip(null);
      setPos(null);
    };

    const schedule = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      target = el;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (target !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({
          text,
          rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width },
        });
      }, SHOW_DELAY_MS);
    };

    const onOver = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return;
      if (el !== target) schedule(el);
    };
    const onOut = (e: MouseEvent) => {
      if (!target) return;
      const to = e.relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      if (e.target instanceof Node && target.contains(e.target)) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (el) schedule(el);
    };
    const onHide = () => hide();

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onHide);
    document.addEventListener("mousedown", onHide, true);
    document.addEventListener("keydown", onHide, true);
    window.addEventListener("scroll", onHide, true);
    window.addEventListener("resize", onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onHide);
      document.removeEventListener("mousedown", onHide, true);
      document.removeEventListener("keydown", onHide, true);
      window.removeEventListener("scroll", onHide, true);
      window.removeEventListener("resize", onHide);
    };
  }, []);

  // Position after render: centered below the target, clamped to the
  // viewport; flips above when there is no room underneath.
  useLayoutEffect(() => {
    if (!tip) return;
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = tip.rect.left + tip.rect.width / 2 - w / 2;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - w - MARGIN));
    let top = tip.rect.bottom + 6;
    if (top + h > window.innerHeight - MARGIN) top = tip.rect.top - h - 6;
    setPos({ left, top: Math.max(MARGIN, top) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className="pv-tooltip"
      role="presentation"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {tip.text}
    </div>
  );
}
