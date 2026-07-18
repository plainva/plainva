import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { BAR_TAB_COUNT, TAB_POOL, moveTabId, type TabScreenId } from "../navigation";
import { haptics } from "../services/haptics";

/**
 * "More" screen (settings redesign 2026-07-18, P3): the area overview behind
 * the bar's fixed More tab. It lists EVERY pool screen in the user's order —
 * a tap navigates there, the drag HANDLE rearranges (no arrows, no radio
 * buttons). The top three entries ARE the bar; they sit in a framed group so
 * the membership is visible — dragging a row up promotes it into the bar.
 * Vaults and settings moved out (settings behind the ⋮, vaults inside them).
 */
export function MoreScreen({
  order,
  onReorder,
  onBack,
  onOpenScreen,
}: {
  order: TabScreenId[];
  onReorder: (next: TabScreenId[]) => void;
  onBack: () => void;
  onOpenScreen: (id: TabScreenId) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<TabScreenId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** Insertion index from the pointer position (row midpoints, DOM order). */
  const indexAt = (clientY: number): number => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-tab-row]") ?? []);
    let idx = 0;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) idx += 1;
    }
    return idx;
  };

  const startDrag = (id: TabScreenId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    // The handle owns the gesture: capture keeps every move even outside the
    // row, touch-action: none (CSS) stops the page from scrolling instead.
    // Capture can throw when the pointer is already gone — the drag still
    // works through the bubbling move/up events then.
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic events) — proceed uncaptured */
    }
    haptics.medium();
    setDragId(id);
    setDropIndex(indexAt(e.clientY));
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragId) return;
    setDropIndex(indexAt(e.clientY));
  };

  const endDrag = () => {
    if (dragId && dropIndex !== null) {
      const from = order.indexOf(dragId);
      // indexAt counts insertion slots; dropping BELOW the origin shifts by one.
      const target = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (target !== from) {
        haptics.light();
        onReorder(moveTabId(order, dragId, target));
      }
    }
    setDragId(null);
    setDropIndex(null);
  };

  const renderRow = (id: TabScreenId, index: number) => {
    const def = TAB_POOL.find((p) => p.id === id);
    if (!def) return null;
    const Icon = def.icon;
    const dropBefore =
      dragId !== null && dropIndex !== null && index === dropIndex && order.indexOf(dragId) !== index;
    return (
      <div
        className={`m-row m-row--split${dragId === id ? " is-dragging" : ""}${dropBefore ? " is-drop-before" : ""}`}
        data-tab-row
        key={id}
      >
        <button className="m-row-main" onClick={() => onOpenScreen(id)}>
          <Icon className="m-accent" size={18} />
          <span>{t(def.labelKey)}</span>
          <ChevronRight className="m-chevron" size={18} />
        </button>
        <button
          aria-label={t("block.move", { defaultValue: "Verschieben" })}
          className="m-iconbtn m-grip"
          onPointerDown={startDrag(id)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <GripVertical size={18} />
        </button>
      </div>
    );
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1>{t("mobile.tabMore")}</h1>
      </header>

      <p className="m-hint">{t("mobile.moreArrangeHint")}</p>

      <div ref={listRef}>
        <p className="m-sectionlabel">{t("mobile.moreInBar")}</p>
        <div className="m-more-bargroup" data-testid="more-bar-group">
          {order.slice(0, BAR_TAB_COUNT).map((id, i) => renderRow(id, i))}
        </div>

        <p className="m-sectionlabel">{t("mobile.moreMoreList")}</p>
        {order.slice(BAR_TAB_COUNT).map((id, i) => renderRow(id, BAR_TAB_COUNT + i))}
      </div>
    </div>
  );
}
