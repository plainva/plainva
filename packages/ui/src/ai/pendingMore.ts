import { useEffect, type RefObject } from "react";

/**
 * Marks each card of the pending column that has more above its pinned foot than it shows (F71 of release 0.9.0, review
 * of M8): the card scrolls inside itself, and its foot draws a line while something lies under it — only then. Read
 * again on a scroll, when a card or the column changes size, and when a card's content changes (a "Details" opened).
 */
export function usePendingMore(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const box = ref.current;
    if (!active || !box) return;
    const update = () => {
      for (const card of Array.from(box.children) as HTMLElement[]) card.classList.toggle("is-more", card.scrollHeight - card.scrollTop - card.clientHeight > 1);
    };
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const watch = () => {
      if (!sizes) return;
      sizes.disconnect();
      sizes.observe(box);
      for (const card of Array.from(box.children)) sizes.observe(card);
    };
    const changes = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => (watch(), update()));
    changes?.observe(box, { childList: true, subtree: true, characterData: true });
    box.addEventListener("scroll", update, true);
    watch();
    update();
    return () => {
      box.removeEventListener("scroll", update, true);
      sizes?.disconnect();
      changes?.disconnect();
    };
  }, [ref, active]);
}
