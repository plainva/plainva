import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChevronDown } from "lucide-react";
import { ALL_VIEW_TYPES, EXTENDED_TYPES, defaultViewName, viewIcon, viewLabel } from "./baseViewerShared";
import { ICON, MenuItem, MenuSeparator, MenuSurface, TextInput, useFixedPopover, useOutsidePress, useStableHandler } from "@plainva/ui";

// Notion-style view tabs of the BaseViewer (structural split, plan C3): one tab
// per view in views[], a "+" to add a view of a chosen type, and a per-view menu
// (rename/duplicate/delete). Tab drag reorder is pointer-based (Tauri-safe): a
// small move threshold tells a drag from a click, so tapping a tab still just
// switches the active view. Config mutations happen in the BaseViewer callbacks.
//
// Both menus are the menu primitive, and the rename field is a popover that
// hears the press beside it itself. Until 2026-10-11 all three were boxes of
// their own over an element that caught the press beside them: no Escape for
// the menus, and the catcher lay under the floating windows — a press into a
// note preview left them open.
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
  const closeViewMenu = useCallback(() => setViewMenuFor(null), []);
  const closeAddViewMenu = useCallback(() => setShowAddViewMenu(false), []);
  // The view's menu and the rename field hang on the tab they belong to — the
  // active one, the only tab with a caret.
  const activeTabRef = useRef<HTMLDivElement>(null);
  const addViewRef = useRef<HTMLButtonElement>(null);

  // Inline rename popover (plan W6): native window.prompt is unreliable in
  // WebView2, so the menu's "rename" opens a small anchored input instead.
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);

  // Both belong to the tab they were opened for. A database that is read again
  // from outside (a sync, another window) can take that view away or make
  // another one the active one: then they go with it, and nothing they held is
  // applied to a view that merely has the same number.
  const stillThere = (i: number | null) => (i !== null && i === activeViewIndex && i < views.length ? i : null);
  const menuFor = stillThere(viewMenuFor);
  const renaming = stillThere(renamingIdx);

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
    // The tab is what the view's menu hangs on, so the menu does not take a
    // press on it for a press beside it. It is one all the same.
    setViewMenuFor(null);
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
          <div key={i} ref={active ? activeTabRef : undefined} className={`base-view-tab${active ? " active" : ""}${viewOverIdx === i && viewDragIdx !== null && viewDragIdx !== i ? " drop" : ""}`} style={{ opacity: viewDragIdx === i ? 0.5 : 1 }}>
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
              <button
                className="base-view-tab-caret"
                aria-label={t("database.viewOptions", "Ansichts-Optionen")}
                data-tip={t("database.viewOptions", "Ansichts-Optionen")}
                aria-haspopup="menu"
                aria-expanded={menuFor === i}
                onClick={() => setViewMenuFor(menuFor === i ? null : i)}
              >
                <ChevronDown size={ICON.meta} />
              </button>
            )}
          </div>
        );
      })}
      <MenuSurface
        open={menuFor !== null}
        onClose={closeViewMenu}
        anchorRef={activeTabRef}
        minWidth={160}
        ariaLabel={t("database.viewOptions", "Ansichts-Optionen")}
      >
        <MenuItem onSelect={() => setRenamingIdx(menuFor)}>{t("database.renameView", "Umbenennen")}</MenuItem>
        <MenuItem onSelect={() => { if (menuFor !== null) onDuplicate(menuFor); }}>{t("database.duplicateView", "Duplizieren")}</MenuItem>
        <MenuSeparator />
        <MenuItem danger disabled={views.length <= 1} onSelect={() => { if (menuFor !== null) onDelete(menuFor); }}>{t("database.deleteView", "Löschen")}</MenuItem>
      </MenuSurface>
      {renaming !== null && (
        <RenameViewPopover
          anchorRef={activeTabRef}
          initial={viewLabel(t, views[renaming])}
          label={t("database.renameViewPrompt", "Name der Ansicht:")}
          onKeep={(name) => { onRename(renaming, name); setRenamingIdx(null); }}
          onDrop={() => setRenamingIdx(null)}
        />
      )}
      <button
        ref={addViewRef}
        className="base-view-add"
        aria-label={t("database.addView", "Ansicht hinzufügen")}
        data-tip={t("database.addView", "Ansicht hinzufügen")}
        aria-haspopup="menu"
        aria-expanded={showAddViewMenu}
        onClick={() => setShowAddViewMenu((s) => !s)}
      >
        <Plus size={ICON.ui} />
      </button>
      <MenuSurface
        open={showAddViewMenu}
        onClose={closeAddViewMenu}
        anchorRef={addViewRef}
        minWidth={160}
        ariaLabel={t("database.addView", "Ansicht hinzufügen")}
      >
        {ALL_VIEW_TYPES.filter((ty) => extendedDbEnabled || !EXTENDED_TYPES.includes(ty)).map((ty) => (
          <MenuItem key={ty} icon={viewIcon(ty)} onSelect={() => onAdd(ty)}>{defaultViewName(t, ty)}</MenuItem>
        ))}
      </MenuSurface>
    </div>
  );
}

/**
 * The field a view is renamed in, under its tab.
 *
 * It ends once, whichever way it is left: Enter, a press beside it and losing
 * the focus keep the name, Escape drops it. The press beside it is heard for
 * itself and not read off the blur — a press that is taken for a drag (the
 * head of a floating window) moves no focus, and the field would stay.
 */
function RenameViewPopover({ anchorRef, initial, label, onKeep, onDrop }: {
  anchorRef: RefObject<HTMLElement | null>;
  initial: string;
  label: string;
  onKeep: (name: string) => void;
  onDrop: () => void;
}) {
  const [value, setValue] = useState(initial);
  const popRef = useFixedPopover(true, anchorRef, { minWidth: 200 });
  const ended = useRef(false);
  const end = useStableHandler((keep: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (keep) onKeep(value);
    else onDrop();
  });
  const keep = useCallback(() => end(true), [end]);
  useOutsidePress(true, keep, popRef);
  // Being taken away is not being left: when the tab the field hangs on goes
  // (the database was read again from outside), nothing is kept. The field
  // loses its focus as it is removed, and that must not count as "keep".
  useLayoutEffect(() => {
    ended.current = false;
    return () => { ended.current = true; };
  }, []);
  // The caret goes into the field once the popover is placed: until then it is
  // hidden, and what is hidden takes no focus (`autoFocus` comes too early).
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fieldRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={popRef} className="pv-popover pv-popover--fixed">
      <TextInput
        ref={fieldRef}
        compact
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") end(true);
          else if (e.key === "Escape") {
            // The key is used here: it drops the name and reaches nothing behind.
            e.preventDefault();
            e.stopPropagation();
            end(false);
          }
        }}
        onBlur={keep}
      />
    </div>
  );
}
