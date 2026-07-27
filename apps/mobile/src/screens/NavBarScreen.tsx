import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, GripVertical } from "lucide-react";
import {
  MAX_BAR_TABS,
  MIN_BAR_TABS,
  TAB_POOL,
  barTabs,
  moveTabId,
  sanitizeBarTabCount,
  type TabScreenId,
} from "../navigation";
import { createDragAutoScroll, type DragAutoScroll } from "@plainva/ui";
import { haptics } from "../services/haptics";

/**
 * Settings → Navigation bar (plan P5). Arranging moved here out of the old
 * "More" screen, because with the fixed More tab gone that screen became a
 * sheet — and a setting belongs in Settings anyway.
 *
 * The number of areas in the bar is now the user's (3–5, the Material range).
 * Bar membership follows from POSITION, exactly as before: the top `count`
 * entries ARE the bar, so dragging a row up promotes it. Everything below is
 * still reachable — through the Areas sheet, which the hint names explicitly so
 * nobody thinks the areas are gone.
 */
export function NavBarScreen({
  order,
  barCount,
  onReorder,
  onBarCount,
  onBack,
}: {
  order: TabScreenId[];
  barCount: number;
  onReorder: (next: TabScreenId[]) => void;
  onBarCount: (next: number) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  // Eight entries plus stepper and preview do not fit one screen, and pointer
  // capture keeps the page from scrolling under the finger — without this a
  // drag from bottom to top is simply not possible in one gesture (§ 9.3).
  // Built on the first drag, not during render: handing a ref to a function in
  // the render body is exactly what react-hooks/refs forbids, and a drag that
  // never happens needs no loop.
  const autoScrollRef = useRef<DragAutoScroll | null>(null);
  const autoScroll = () => (autoScrollRef.current ??= createDragAutoScroll(() => listRef.current));
  const [dragId, setDragId] = useState<TabScreenId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const count = sanitizeBarTabCount(barCount);
  const preview = barTabs(order, count);

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
    autoScroll().update(e.clientY);
    setDropIndex(indexAt(e.clientY));
  };

  const endDrag = () => {
    autoScrollRef.current?.stop();
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
        <span className="m-row-main">
          <Icon className="m-accent" size={18} />
          <span>{t(def.labelKey)}</span>
        </span>
        <button
          aria-label={t("block.move")}
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
        <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1>{t("mobile.navBar", { defaultValue: "Navigationsleiste" })}</h1>
      </header>

      <p className="m-hint">{t("mobile.navBarHint")}</p>

      <div className="m-stepper m-stepper--row">
        <span className="m-stepper-label">{t("mobile.navBarCount", { defaultValue: "Bereiche in der Leiste" })}</span>
        <button
          aria-label={t("mobile.navBarFewer", { defaultValue: "Weniger Bereiche" })}
          className="m-iconbtn"
          data-testid="navbar-minus"
          disabled={count <= MIN_BAR_TABS}
          onClick={() => onBarCount(count - 1)}
        >
          −
        </button>
        <span className="m-stepper-num" data-testid="navbar-count">{count}</span>
        <button
          aria-label={t("mobile.navBarMore", { defaultValue: "Mehr Bereiche" })}
          className="m-iconbtn"
          data-testid="navbar-plus"
          disabled={count >= MAX_BAR_TABS}
          onClick={() => onBarCount(count + 1)}
        >
          +
        </button>
      </div>

      {/* Live preview of the bar, so the number means something before you
          leave the screen. */}
      <div className="m-navpreview">
        <p className="m-sectionlabel">{t("mobile.navBarPreview", { defaultValue: "Vorschau" })}</p>
        <div className="m-navpreview-bar">
          {preview.map((id) => {
            const def = TAB_POOL.find((p) => p.id === id);
            if (!def) return null;
            const Icon = def.icon;
            return (
              <span className="m-navpreview-tab" key={id}>
                <Icon size={16} />
                {/* The real bar renders barLabelKey when there is one (App.tsx).
                    Showing labelKey here made the preview promise "Datenbanken"
                    where the bar says "DBs" — the very case barLabelKey exists
                    for (§ 9.1). */}
                <span>{t(def.barLabelKey ?? def.labelKey)}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div ref={listRef}>
        <p className="m-sectionlabel">{t("mobile.moreInBar")}</p>
        <div className="m-more-bargroup" data-testid="more-bar-group">
          {order.slice(0, count).map((id, i) => renderRow(id, i))}
        </div>

        <p className="m-sectionlabel">{t("mobile.navBarOutside")}</p>
        {order.slice(count).map((id, i) => renderRow(id, count + i))}
      </div>
    </div>
  );
}
