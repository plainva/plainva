import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, GripVertical, LayoutGrid } from "lucide-react";
import { TAB_POOL, type TabScreenId } from "../navigation";
import {
  barDef,
  createDragAutoScroll,
  moveArea,
  setVisibleCount,
  visibleAreas,
  type AreaOrder,
  type DragAutoScroll,
  ICON,
  IconButton,
} from "@plainva/ui";
import { haptics } from "../services/haptics";

/**
 * Settings → Navigation bar (plan P5). Arranging moved here out of the old
 * "More" screen, because with the fixed More tab gone that screen became a
 * sheet — and a setting belongs in Settings anyway.
 *
 * Since S10 the arrangement IS the shared bar model's fifth bar, so the rules —
 * how many areas fit, which one can never be hidden — come from one place and
 * the same bar can be arranged from the desktop. Bar membership still follows
 * from POSITION: the top `count` entries ARE the bar, so dragging a row up
 * promotes it. The last bar entry, "Areas", is fixed and therefore not in this
 * list: a way to everything else that a user can hide is not a way back.
 */
export function NavBarScreen({
  value,
  onChange,
  onBack,
}: {
  value: AreaOrder;
  onChange: (next: AreaOrder) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const spec = barDef("mobileBar").spec;
  const order = value.order as TabScreenId[];
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
  const count = value.visibleCount;
  const preview = visibleAreas(value) as TabScreenId[];

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
        onChange(moveArea(value, dragId, target, spec));
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
          <Icon className="m-accent" size={ICON.head} />
          <span>{t(def.labelKey)}</span>
        </span>
        <IconButton
          label={t("block.move")}
          className="m-grip"
          onPointerDown={startDrag(id)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <GripVertical size={ICON.head} />
        </IconButton>
      </div>
    );
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
          <ChevronLeft size={ICON.touch} />
        </IconButton>
        <h1>{t("mobile.navBar", { defaultValue: "Navigationsleiste" })}</h1>
      </header>

      <p className="m-hint">{t("mobile.navBarHint")}</p>

      <div className="m-stepper m-stepper--row">
        <span className="m-stepper-label">{t("mobile.navBarCount", { defaultValue: "Bereiche in der Leiste" })}</span>
        <IconButton
          label={t("mobile.navBarFewer", { defaultValue: "Weniger Bereiche" })}
          data-testid="navbar-minus"
          disabled={count <= (spec.minVisible ?? 1)}
          onClick={() => onChange(setVisibleCount(value, count - 1, spec))}
        >
          −
        </IconButton>
        <span className="m-stepper-num" data-testid="navbar-count">{count}</span>
        <IconButton
          label={t("mobile.navBarMore", { defaultValue: "Mehr Bereiche" })}
          data-testid="navbar-plus"
          disabled={count >= (spec.maxVisible ?? spec.known.length)}
          onClick={() => onChange(setVisibleCount(value, count + 1, spec))}
        >
          +
        </IconButton>
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
                <Icon size={ICON.ui} />
                {/* The real bar renders barLabelKey when there is one (App.tsx).
                    Showing labelKey here made the preview promise "Datenbanken"
                    where the bar says "DBs" — the very case barLabelKey exists
                    for (§ 9.1). */}
                <span>{t(def.barLabelKey ?? def.labelKey)}</span>
              </span>
            );
          })}
          {/* The fixed last entry — shown so the preview counts what the bar
              really shows, not what this screen happens to arrange. */}
          <span className="m-navpreview-tab" key="areas">
            <LayoutGrid size={ICON.ui} />
            <span>{t("mobile.areas")}</span>
          </span>
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
