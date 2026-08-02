import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Eye, EyeOff, Square, type LucideIcon } from "lucide-react";
import {
  Button,
  cx,
  ICON,
  IconButton,
  SettingCard,
  SettingCardNote,
  createDragAutoScroll,
  type DragAutoScroll,
  hiddenAreas,
  moveArea,
  setAreaVisible,
  visibleAreas,
  type AreaOrder,
} from "@plainva/ui";
import { AreaHead } from "./AppPages";
import {
  BAR_DEFS,
  barLayoutIsInherited,
  loadAllBarLayouts,
  resetBarLayout,
  saveBarLayout,
  saveBarLayoutAsDefault,
  type BarDef,
  type BarId,
} from "@plainva/ui";

/**
 * "Bars & areas" — the one place where the action rail and both sidebars are
 * arranged (plan § 2). Each bar is one ordered list with a line: everything
 * above it is visible, everything below is hidden. That is the mobile model,
 * and it is why there is no second "visible?" switch to keep in sync.
 *
 * Drag HANDLES belong here (plan E10): on this page a list is being ARRANGED,
 * so a handle is the honest affordance. In the interface itself the element is
 * pressed and held instead — a handle beside every section header was exactly
 * the visual noise the maintainer objected to.
 */

interface RowProps {
  def: BarDef;
  layout: AreaOrder;
  id: string;
  visible: boolean;
  pinned: boolean;
  onMove: (id: string, toIndex: number) => void;
  onToggle: (id: string, visible: boolean) => void;
  dragId: string | null;
  overId: string | null;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (e: React.PointerEvent) => void;
  label: string;
  hint?: string;
  Icon: LucideIcon;
}

const AreaRow: React.FC<RowProps> = ({ id, visible, pinned, onToggle, dragId, overId, onDragStart, onDragMove, onDragEnd, label, hint, Icon }) => {
  const { t } = useTranslation();
  const isOver = overId === id && dragId !== null && dragId !== id;
  return (
    <div
      data-bar-area={id}
      className={cx("pv-barrow", isOver && "is-over", dragId === id && "is-dragging")}
    >
      <span
        role="button"
        className="pv-barrow-grip"
        aria-label={t("bars.reorder", { defaultValue: "Zum Verschieben gedrückt halten" })}
        data-tip={t("bars.reorder", { defaultValue: "Zum Verschieben gedrückt halten" })}
        onPointerDown={(e) => { if (e.button === 0) onDragStart(id, e); }}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <GripVertical size={ICON.ui} />
      </span>
      {/* The glyph the bar itself shows — the list is meant to be read against
          the interface, and a name alone makes the eye translate it back. */}
      <span className="pv-barrow-icon" aria-hidden><Icon size={ICON.ui} /></span>
      <span className="pv-barrow-label">{label}</span>
      {hint && <span className="pv-barrow-hint">{hint}</span>}
      {!pinned && (
        <IconButton
          label={visible ? t("bars.hide", { defaultValue: "Ausblenden" }) : t("bars.show", { defaultValue: "Einblenden" })}
          onClick={() => onToggle(id, !visible)}
        >
          {visible ? <Eye size={ICON.ui} /> : <EyeOff size={ICON.ui} />}
        </IconButton>
      )}
    </div>
  );
};

interface BarBlockProps {
  def: BarDef;
  layout: AreaOrder;
  inherited: boolean;
  vaultPath: string | null;
  onChange: (bar: BarId, next: AreaOrder) => void;
  onReset: (bar: BarId) => void;
  onSaveDefault: (bar: BarId) => void;
}

const BarBlock: React.FC<BarBlockProps> = ({ def, layout, inherited, onChange, onReset, onSaveDefault }) => {
  const { t } = useTranslation();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Built on the first drag, not during render: handing a ref to a function in
  // the render body is exactly what react-hooks/refs forbids, and a drag that
  // never happens needs no loop.
  const autoScrollRef = useRef<DragAutoScroll | null>(null);
  const autoScroll = () => (autoScrollRef.current ??= createDragAutoScroll(() => rootRef.current));

  const rowAt = (clientY: number): string | null => {
    const root = rootRef.current;
    if (!root) return null;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-bar-area]"))) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return el.dataset.barArea ?? null;
    }
    return null;
  };

  const onDragStart = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not supported */ }
    dragRef.current = id;
    setDragId(id);
    setOverId(id);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    // Ten action-rail entries plus three more blocks below reach past the
    // settings viewport; pointer capture stops it scrolling by itself (§ 9.3).
    autoScroll().update(e.clientY);
    const target = rowAt(e.clientY);
    if (target) setOverId(target);
  };
  const onDragEnd = (e: React.PointerEvent) => {
    autoScrollRef.current?.stop();
    const from = dragRef.current;
    dragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* not supported */ }
    const to = rowAt(e.clientY);
    setDragId(null);
    setOverId(null);
    if (!from || !to || from === to) return;
    const target = layout.order.indexOf(to);
    if (target >= 0) onChange(def.id, moveArea(layout, from, target, def.spec));
  };

  const area = (id: string) => def.areas.find((a) => a.id === id);
  const label = (id: string) => {
    const a = area(id);
    return a ? t(a.labelKey, { defaultValue: id }) : id;
  };
  // Square is a deliberate placeholder: an id without a def cannot happen once
  // sanitizeAreaOrder has run, and a crash would be the wrong answer if it did.
  const iconOf = (id: string): LucideIcon => area(id)?.icon ?? Square;
  const pinned = (id: string) => (def.spec.alwaysVisible ?? []).includes(id);
  const shown = visibleAreas(layout);
  const hidden = hiddenAreas(layout);

  const rowProps = {
    def,
    layout,
    onMove: () => {},
    onToggle: (id: string, visible: boolean) => onChange(def.id, setAreaVisible(layout, id, visible, def.spec)),
    dragId,
    overId,
    onDragStart,
    onDragMove,
    onDragEnd,
  };

  return (
    <SettingCard label={t(def.titleKey, { defaultValue: def.id })}>
      <SettingCardNote>{t(def.descriptionKey, { defaultValue: "" })}</SettingCardNote>
      <div ref={rootRef}>
        <div className="pv-barlabel">{t("bars.visible", { defaultValue: "Sichtbar" })}</div>
        {shown.map((id) => (
          <AreaRow
            key={id}
            {...rowProps}
            id={id}
            visible
            pinned={pinned(id)}
            label={label(id)}
            Icon={iconOf(id)}
            hint={pinned(id) ? t("bars.alwaysVisible", { defaultValue: "immer sichtbar" }) : undefined}
          />
        ))}
        <div className="pv-barlabel">{t("bars.hidden", { defaultValue: "Ausgeblendet" })}</div>
        {hidden.length === 0 ? (
          <SettingCardNote>—</SettingCardNote>
        ) : (
          hidden.map((id) => (
            <AreaRow key={id} {...rowProps} id={id} visible={false} pinned={false} label={label(id)} Icon={iconOf(id)} />
          ))
        )}
        {def.id === "ribbon" && hidden.length > 0 && (
          <SettingCardNote>{t("bars.hiddenHintRibbon", { defaultValue: "Weiter über die Befehlspalette erreichbar." })}</SettingCardNote>
        )}
        {def.id === "mobileBar" && hidden.length > 0 && (
          <SettingCardNote>{t("bars.hiddenHintMobileBar", { defaultValue: "Weiter über „Bereiche“ erreichbar." })}</SettingCardNote>
        )}
      </div>
      <div className="pv-barfoot">
        <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {inherited
            ? t("bars.inherited", { defaultValue: "Folgt dem Standard" })
            : t("bars.ownValue", { defaultValue: "Für diesen Vault angepasst" })}
        </span>
        {!inherited && (
          <Button variant="ghost" onClick={() => onReset(def.id)}>
            {t("bars.resetDefault", { defaultValue: "Auf Standard zurücksetzen" })}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onSaveDefault(def.id)}>
          {t("bars.saveAsDefault", { defaultValue: "Als Standard übernehmen" })}
        </Button>
      </div>
    </SettingCard>
  );
};

export const BarsPage: React.FC<{ isActiveVault: boolean; vaultPath: string | null }> = ({ isActiveVault, vaultPath }) => {
  const { t } = useTranslation();
  const [layouts, setLayouts] = useState<Record<BarId, AreaOrder> | null>(null);
  const [inherited, setInherited] = useState<Partial<Record<BarId, boolean>>>({});

  const reload = useCallback(async () => {
    const all = await loadAllBarLayouts(vaultPath);
    setLayouts(all);
    const flags: Partial<Record<BarId, boolean>> = {};
    for (const def of BAR_DEFS) flags[def.id] = await barLayoutIsInherited(def.id, vaultPath);
    setInherited(flags);
  }, [vaultPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const change = (bar: BarId, next: AreaOrder) => {
    setLayouts((prev) => (prev ? { ...prev, [bar]: next } : prev));
    setInherited((prev) => ({ ...prev, [bar]: false }));
    void saveBarLayout(bar, vaultPath, next);
  };

  const reset = (bar: BarId) => {
    void resetBarLayout(bar, vaultPath).then(reload);
  };

  const saveDefault = (bar: BarId) => {
    const value = layouts?.[bar];
    if (value) void saveBarLayoutAsDefault(bar, value);
  };

  return (
    <div>
      <AreaHead areaId="bars" />
      {!isActiveVault ? (
        <SettingCard>
          <SettingCardNote>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</SettingCardNote>
        </SettingCard>
      ) : (
        <>
          <SettingCard>
            <SettingCardNote>{t("bars.defaultHint", { defaultValue: "Der Standard gilt in jedem Vault, der nichts Eigenes gesetzt hat." })}</SettingCardNote>
          </SettingCard>
          {layouts
            && BAR_DEFS.map((def) => (
              <BarBlock
                key={def.id}
                def={def}
                layout={layouts[def.id]}
                inherited={inherited[def.id] ?? true}
                vaultPath={vaultPath}
                onChange={change}
                onReset={reset}
                onSaveDefault={saveDefault}
              />
            ))}
        </>
      )}
    </div>
  );
};
