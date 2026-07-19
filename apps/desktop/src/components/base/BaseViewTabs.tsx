import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChevronDown } from "lucide-react";
import { ALL_VIEW_TYPES, EXTENDED_TYPES, defaultViewName, viewIcon, viewLabel } from "./baseViewerShared";
import { ICON } from "@plainva/ui";

// Notion-style view tabs of the BaseViewer (structural split, plan C3): one tab
// per view in views[], a "+" to add a view of a chosen type, and a per-view menu
// (rename/duplicate/delete). Tab drag reorder is pointer-based (Tauri-safe): a
// small move threshold tells a drag from a click, so tapping a tab still just
// switches the active view. Config mutations happen in the BaseViewer callbacks.
export function BaseViewTabs({
  views,
  activeViewIndex,
  extendedDbEnabled,
  onSelect,
  onReorder,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
}: {
  views: any[];
  activeViewIndex: number;
  extendedDbEnabled: boolean;
  onSelect: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (type: string) => void;
  onRename: (i: number, name: string) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
}) {
  const { t } = useTranslation();
  const [viewMenuFor, setViewMenuFor] = useState<number | null>(null);
  const [showAddViewMenu, setShowAddViewMenu] = useState(false);

  // Inline rename popover (plan W6): native window.prompt is unreliable in
  // WebView2, so the menu's "rename" opens a small anchored input instead.
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const commitRename = () => {
    if (renamingIdx != null) onRename(renamingIdx, renameValue);
    setRenamingIdx(null);
  };

  const tabEls = useRef<Record<number, HTMLElement>>({});
  const viewDragRef = useRef<{ from: number; x: number; moved: boolean } | null>(null);
  const [viewDragIdx, setViewDragIdx] = useState<number | null>(null);
  const [viewOverIdx, setViewOverIdx] = useState<number | null>(null);

  const tabAtX = (clientX: number): number | null => {
    for (let i = 0; i < views.length; i++) {
      const el = tabEls.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return i;
    }
    return null;
  };
  const onTabPointerDown = (i: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    viewDragRef.current = { from: i, x: e.clientX, moved: false };
  };
  const onTabPointerMove = (e: React.PointerEvent) => {
    const d = viewDragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) > 5) { d.moved = true; setViewDragIdx(d.from); }
    if (d.moved) { const over = tabAtX(e.clientX); if (over != null) setViewOverIdx(over); }
  };
  const onTabPointerUp = (i: number, e: React.PointerEvent) => {
    const d = viewDragRef.current;
    viewDragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
    if (d && d.moved) {
      const to = tabAtX(e.clientX);
      if (to != null && to !== d.from) onReorder(d.from, to);
    } else {
      onSelect(i);
    }
    setViewDragIdx(null);
    setViewOverIdx(null);
  };
  const onTabPointerCancel = () => { viewDragRef.current = null; setViewDragIdx(null); setViewOverIdx(null); };

  return (
    <div className="base-view-tabs">
      {views.map((view: any, i: number) => {
        const active = i === activeViewIndex;
        return (
          <div key={i} className={`base-view-tab${active ? " active" : ""}${viewOverIdx === i && viewDragIdx !== null && viewDragIdx !== i ? " drop" : ""}`} style={{ opacity: viewDragIdx === i ? 0.5 : 1 }}>
            <button
              className="base-view-tab-btn"
              ref={(el) => { if (el) tabEls.current[i] = el; }}
              onPointerDown={(e) => onTabPointerDown(i, e)}
              onPointerMove={onTabPointerMove}
              onPointerUp={(e) => onTabPointerUp(i, e)}
              onPointerCancel={onTabPointerCancel}
              data-tip={viewLabel(t, view)}
              style={{ touchAction: "none" }}
            >
              {viewIcon(view?.type || "table")}
              <span className="base-view-tab-label">{viewLabel(t, view)}</span>
            </button>
            {active && (
              <button className="base-view-tab-caret" aria-label={t("database.viewOptions", "Ansichts-Optionen")} data-tip={t("database.viewOptions", "Ansichts-Optionen")} onClick={() => setViewMenuFor(viewMenuFor === i ? null : i)}>
                <ChevronDown size={ICON.meta} />
              </button>
            )}
            {viewMenuFor === i && (
              <>
                <div className="base-menu-backdrop" onClick={() => setViewMenuFor(null)} />
                <div className="base-view-menu">
                  <button onClick={() => { setViewMenuFor(null); setRenamingIdx(i); setRenameValue(viewLabel(t, views[i])); }}>{t("database.renameView", "Umbenennen")}</button>
                  <button onClick={() => { setViewMenuFor(null); onDuplicate(i); }}>{t("database.duplicateView", "Duplizieren")}</button>
                  <button onClick={() => { setViewMenuFor(null); onDelete(i); }} disabled={views.length <= 1} className="danger">{t("database.deleteView", "Löschen")}</button>
                </div>
              </>
            )}
            {renamingIdx === i && (
              <>
                <div className="base-menu-backdrop" onClick={() => setRenamingIdx(null)} />
                <div className="base-view-menu" style={{ padding: "0.4rem" }}>
                  <input
                    autoFocus
                    type="text"
                    className="base-inline-input"
                    aria-label={t("database.renameViewPrompt", "Name der Ansicht:")}
                    placeholder={t("database.renameViewPrompt", "Name der Ansicht:")}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingIdx(null); }}
                    onBlur={commitRename}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
      <div style={{ position: "relative" }}>
        <button className="base-view-add" aria-label={t("database.addView", "Ansicht hinzufügen")} data-tip={t("database.addView", "Ansicht hinzufügen")} onClick={() => setShowAddViewMenu((s) => !s)}>
          <Plus size={ICON.ui} />
        </button>
        {showAddViewMenu && (
          <>
            <div className="base-menu-backdrop" onClick={() => setShowAddViewMenu(false)} />
            <div className="base-view-menu">
              {ALL_VIEW_TYPES.filter((ty) => extendedDbEnabled || !EXTENDED_TYPES.includes(ty)).map((ty) => (
                <button key={ty} onClick={() => { setShowAddViewMenu(false); onAdd(ty); }}>{viewIcon(ty)} {defaultViewName(t, ty)}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
