import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { SlidersHorizontal, Settings2, Trash2, X, Plus, GripVertical, ArrowUp, ArrowDown, Filter } from "lucide-react";
import { Select, type SelectOption } from "../Select";
import { DatabaseSourceConfig } from "../DatabaseSourceConfig";
import { ALL_VIEW_TYPES, EXTENDED_TYPES, baseInputTypeOptions, defaultViewName } from "./baseViewerShared";
import {
  addGroupWithRule,
  addRuleToGroup,
  addTopFilterRule,
  buildUIFilterModel,
  moveTopFilterEntries,
  removeFilterEntry,
  removeGroupRule,
  serializePropertyFilter,
  setGroupLogic,
  updateGroupRule,
  updateTopFilterRule,
  type FilterEntryRef,
  type FilterOp,
  type PropertyFilterRule,
} from "@plainva/ui";
import { inlineOptionsFrom, parseWikiLinkValue, columnValuesAreWikiLinks, type CuratedOption } from "@plainva/ui";
import type { BaseCells } from "./useBaseCells";
import { useRowDrag } from "./useRowDrag";
import { SELF_MARKER, getContextFilters, addContextFilter, removeContextFilter } from "../../services/embedScope";

export interface SortRuleUI {
  property: string;
  direction: "ASC" | "DESC";
}

// Date-field controls shared by the calendar and timeline layout sections.
function DateViewControls({
  isTimeline,
  dateProp,
  endProp,
  currentType,
  availableColumns,
  cells,
  onSetDateField,
  onSetDateFieldType,
  onSetEndDateField,
}: {
  isTimeline: boolean;
  dateProp: string | null;
  endProp: string | null;
  currentType: "date" | "datetime";
  availableColumns: string[];
  cells: BaseCells;
  onSetDateField: (col: string) => void;
  onSetDateFieldType: (t: "date" | "datetime") => void;
  onSetEndDateField: (col: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="base-cfg-field">{isTimeline ? t("database.startDateField", "Startdatum") : t("database.dateField", "Datumsfeld")}
        <Select
          ariaLabel={isTimeline ? t("database.startDateField", "Startdatum") : t("database.dateField", "Datumsfeld")}
          value={dateProp || ""}
          onChange={v => onSetDateField(v)}
          options={[
            ...(!dateProp ? [{ value: "", label: t("database.selectColumn", "Spalte wählen...") }] : []),
            ...availableColumns.map(c => ({ value: c, label: cells.columnLabel(c) })),
          ]}
        />
      </label>
      <label className="base-cfg-field">{t("database.dateFieldType", "Format")}
        <Select
          ariaLabel={t("database.dateFieldType", "Format")}
          value={currentType}
          onChange={v => onSetDateFieldType(v as "date" | "datetime")}
          disabled={!dateProp}
          options={[
            { value: "date", label: t("database.typeDateOnly", "Nur Datum") },
            { value: "datetime", label: t("database.typeDateTime", "Datum & Uhrzeit") },
          ]}
        />
      </label>
      {isTimeline && (
        <label className="base-cfg-field">{t("database.endDateField", "Enddatum")}
          <Select
            ariaLabel={t("database.endDateField", "Enddatum")}
            value={endProp || ""}
            onChange={v => onSetEndDateField(v)}
            options={[
              { value: "", label: t("database.noEndDate", "— keines —") },
              ...availableColumns.filter(c => c !== dateProp).map(c => ({ value: c, label: cells.columnLabel(c) })),
            ]}
          />
        </label>
      )}
    </>
  );
}

// Typed value editor of one filter row: curated options become a picker, dates a
// date input, numbers a number input; free text commits on blur/Enter so typing
// does not rewrite the .base file per keystroke. Options come from the SOURCE
// rows (`rows`), not the filtered result — deriving them from the filtered rows
// would collapse the picker to the filter's own value (or to a bare text input
// at zero matches) right after selecting one.
function FilterValueEditor({
  column,
  op,
  value,
  rows,
  cells,
  t,
  onCommit,
}: {
  column: string;
  op: FilterOp;
  value: string;
  rows: Record<string, any>[];
  cells: BaseCells;
  t: TFunction;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const input = column ? cells.getColumnInput(column) : undefined;
  const derived = column ? inlineOptionsFrom(cells.getColumnOptions(column) as CuratedOption[], rows, column) : [];
  // Keep the active value selectable even when it no longer occurs in the source.
  const options = derived.length > 0 && value && !derived.some((o) => o.value === value)
    ? [{ value }, ...derived]
    : derived;

  // Relation-ish columns get a note dropdown (P11): the distinct raw link
  // values of the source rows, labeled by their display text. The stored
  // filter value is the full `[[...]]` string, so `contains` matches exact
  // membership without prefix false-positives.
  // A declared relation/link/reverse column — OR an untyped column whose values
  // are all wiki-links (a relation by data, e.g. a `project` link with no schema
  // entry). Both get the note dropdown: display-text labels and the "Diese Notiz"
  // option, instead of the raw "[[...]]" in a generic text picker.
  const isRelation =
    !!column &&
    (input === "relation" ||
      input === "link" ||
      cells.isReverseColumn?.(column) ||
      (input === undefined && columnValuesAreWikiLinks(rows, column)));
  if (isRelation) {
    const seen = new Set<string>();
    const linkOptions: SelectOption[] = [];
    for (const r of rows) {
      let v = r[column];
      if (v === undefined && column.startsWith("note.")) v = r[column.substring(5)];
      const arr = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
      for (const raw of arr.map(String)) {
        if (seen.has(raw)) continue;
        seen.add(raw);
        linkOptions.push({ value: raw, label: parseWikiLinkValue(raw)?.display ?? raw });
      }
    }
    linkOptions.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    if (value && !seen.has(value)) linkOptions.unshift({ value, label: parseWikiLinkValue(value)?.display ?? value });
    return (
      <Select
        ariaLabel={t("database.filterValue", "Wert...")}
        value={value}
        size="sm"
        minWidth={60}
        onChange={onCommit}
        options={[
          { value: "", label: t("database.selectValue", "Wert wählen...") },
          { value: SELF_MARKER, label: t("database.filterThisNote", "Diese Notiz") },
          ...linkOptions,
        ]}
      />
    );
  }

  if (column && input === "checkbox") {
    return (
      <Select
        ariaLabel={t("database.filterValue", "Wert...")}
        value={value}
        size="sm"
        minWidth={60}
        onChange={onCommit}
        options={[
          { value: "", label: t("database.selectValue", "Wert wählen...") },
          { value: "true", label: t("database.boolTrue", "Ja") },
          { value: "false", label: t("database.boolFalse", "Nein") },
        ]}
      />
    );
  }
  if (column && (input === "date" || input === "datetime")) {
    return (
      <input
        type={input === "datetime" ? "datetime-local" : "date"}
        className="base-cfg-input"
        style={{ width: "100%", boxSizing: "border-box" }}
        aria-label={t("database.filterValue", "Wert...")}
        value={value}
        onChange={(e) => onCommit(e.target.value)}
      />
    );
  }
  if (column && options.length > 0 && op !== ">" && op !== "<" && op !== ">=" && op !== "<=") {
    return (
      <Select
        ariaLabel={t("database.filterValue", "Wert...")}
        value={value}
        size="sm"
        minWidth={60}
        onChange={onCommit}
        options={[
          { value: "", label: t("database.selectValue", "Wert wählen...") },
          // A value that is a wiki-link (a relation-by-data column with no schema)
          // shows its display text, never the raw "[[...]]"; the stored value stays
          // the full link.
          ...options.map((o) => ({ value: o.value, label: o.label ?? parseWikiLinkValue(o.value)?.display ?? o.value })),
        ]}
      />
    );
  }
  return (
    <input
      type={input === "number" ? "number" : "text"}
      className="base-cfg-input"
      style={{ width: "100%", boxSizing: "border-box" }}
      aria-label={t("database.filterValue", "Wert...")}
      placeholder={t("database.filterValue", "Wert...")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit(draft); } }}
    />
  );
}

// One editable property-filter row: [column] [operator] [typed value] [delete].
function FilterRow({
  rule,
  availableColumns,
  filterValueRows,
  cells,
  t,
  onChange,
  onRemove,
}: {
  rule: PropertyFilterRule;
  availableColumns: string[];
  filterValueRows: Record<string, any>[];
  cells: BaseCells;
  t: TFunction;
  onChange: (rule: PropertyFilterRule) => void;
  onRemove?: () => void;
}) {
  const input = rule.column ? cells.getColumnInput(rule.column) : undefined;
  const isDate = input === "date" || input === "datetime";
  // Relation-ish columns (owning or computed reverse) filter by linked note:
  // membership operators + is-empty, no free-text comparisons (P11).
  // Same relation detection as the value editor: declared relation/link/reverse,
  // or an untyped column whose values are all wiki-links (relation by data).
  const isRelation =
    !!rule.column &&
    (input === "relation" ||
      input === "link" ||
      cells.isReverseColumn?.(rule.column) ||
      (input === undefined && columnValuesAreWikiLinks(filterValueRows, rule.column)));
  const opLabels: Record<FilterOp, string> = {
    "==": t("database.opIs", "ist"),
    "!=": t("database.opIsNot", "ist nicht"),
    contains: t("database.opContains", "enthält"),
    notContains: t("database.opNotContains", "enthält nicht"),
    ">": isDate ? t("database.opAfter", "nach") : t("database.opGt", "größer als"),
    "<": isDate ? t("database.opBefore", "vor") : t("database.opLt", "kleiner als"),
    ">=": isDate ? t("database.opFrom", "ab") : t("database.opGte", "mindestens"),
    "<=": isDate ? t("database.opUntil", "bis") : t("database.opLte", "höchstens"),
    empty: t("database.opEmpty", "ist leer"),
    notEmpty: t("database.opNotEmpty", "ist nicht leer"),
  };
  const availableOps: FilterOp[] = isRelation
    ? ["contains", "notContains", "empty", "notEmpty"]
    : (Object.keys(opLabels) as FilterOp[]);
  // Keep a pre-existing operator selectable even if it is not in the relation set
  // (e.g. a data-relation column already filtered with `==`): otherwise the
  // operator dropdown would show a blank/first value and silently rewrite it.
  if (rule.op && !availableOps.includes(rule.op)) availableOps.unshift(rule.op);
  const columnOptions: SelectOption[] = [
    ...(!rule.column ? [{ value: "", label: t("database.selectColumn", "Spalte wählen...") }] : []),
    ...availableColumns.map((c) => ({ value: c, label: cells.columnLabel(c) })),
  ];
  return (
    <div className="base-cfg-filterrow">
      <div style={{ flex: "1.2 1 0", minWidth: 0 }}>
        <Select ariaLabel={t("database.filterColumn", "Filterspalte")} value={rule.column} size="sm" minWidth={60} onChange={(v) => {
          const nextInput = v ? cells.getColumnInput(v) : undefined;
          const nextIsRelation = !!v && (nextInput === "relation" || nextInput === "link" || cells.isReverseColumn?.(v) || (nextInput === undefined && columnValuesAreWikiLinks(filterValueRows, v)));
          const op = nextIsRelation && !["contains", "notContains", "empty", "notEmpty"].includes(rule.op)
            ? "contains"
            : rule.op === "==" && nextInput === "multiselect" ? "contains" : rule.op;
          onChange({ ...rule, column: v, op, value: "" });
        }} options={columnOptions} />
      </div>
      <div style={{ flex: "0.9 1 0", minWidth: 0 }}>
        <Select ariaLabel={t("database.filterOperator", "Filteroperator")} value={rule.op} size="sm" minWidth={50} onChange={(v) => onChange({ ...rule, op: v as FilterOp, value: v === "empty" || v === "notEmpty" ? "" : rule.value })} options={availableOps.map((op) => ({ value: op, label: opLabels[op] }))} />
      </div>
      <div style={{ flex: "1.3 1 0", minWidth: 0 }}>
        {rule.op === "empty" || rule.op === "notEmpty"
          ? <div className="base-cfg-empty" aria-hidden="true" />
          : <FilterValueEditor column={rule.column} op={rule.op} value={rule.value} rows={filterValueRows} cells={cells} t={t} onCommit={(value) => onChange({ ...rule, value })} />}
      </div>
      {onRemove && (
        <button onClick={onRemove} aria-label={t("common.delete", "Löschen")} title={t("common.delete", "Löschen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
      )}
    </div>
  );
}

// Sort rules as reorderable rows (plan W2/P9): [drag grip] [column] [direction]
// [delete]; the row order is the sort priority. Reordering uses pointer events —
// HTML5 DnD is swallowed by Tauri (same reason as the column drag).
function SortSection({
  sortRules,
  availableColumns,
  cells,
  t,
  onSetSortRules,
}: {
  sortRules: SortRuleUI[];
  availableColumns: string[];
  cells: BaseCells;
  t: TFunction;
  onSetSortRules: (rules: SortRuleUI[]) => void;
}) {
  const rowEls = useRef<Record<number, HTMLElement>>({});
  const dragFrom = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const sortableColumns = ["file.name", "file.mtime", "file.size", ...availableColumns];
  const rowAtY = (clientY: number): number | null => {
    for (let i = 0; i < sortRules.length; i++) {
      const el = rowEls.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return i;
    }
    return null;
  };
  const endDrag = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
    const to = rowAtY(e.clientY);
    setDragIdx(null);
    setOverIdx(null);
    if (from == null || to == null || from === to) return;
    const next = [...sortRules];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onSetSortRules(next);
  };

  return (
    <section className="base-cfg-section">
      <div className="base-cfg-title">{t("database.sort", "Sortierung")}</div>
      {sortRules.length === 0 && <div className="base-cfg-empty">{t("database.noSort", "Keine Sortierung – Standardreihenfolge")}</div>}
      {sortRules.map((rule, i) => (
        <div
          key={i}
          ref={(el) => { if (el) rowEls.current[i] = el; }}
          className={`base-cfg-filterrow${overIdx === i && dragIdx !== null && dragIdx !== i ? " base-cfg-row-drop" : ""}`}
          style={{ opacity: dragIdx === i ? 0.5 : 1 }}
        >
          <span
            className="base-cfg-grip"
            role="button"
            aria-label={t("database.reorderSort", "Priorität ändern (ziehen)")}
            title={t("database.reorderSort", "Priorität ändern (ziehen)")}
            onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* unsupported */ } dragFrom.current = i; setDragIdx(i); setOverIdx(i); } }}
            onPointerMove={(e) => { if (dragFrom.current != null) { const t2 = rowAtY(e.clientY); if (t2 != null) setOverIdx(t2); } }}
            onPointerUp={endDrag}
            onPointerCancel={() => { dragFrom.current = null; setDragIdx(null); setOverIdx(null); }}
          >
            <GripVertical size={12} />
          </span>
          <div style={{ flex: "1.4 1 0", minWidth: 0 }}>
            <Select
              ariaLabel={t("database.sortColumn", "Sortierspalte")}
              value={rule.property}
              size="sm"
              minWidth={60}
              onChange={(v) => onSetSortRules(sortRules.map((r, j) => (j === i ? { ...r, property: v } : r)))}
              options={sortableColumns.map((c) => ({ value: c, label: cells.columnLabel(c), disabled: c !== rule.property && sortRules.some((r) => r.property === c) }))}
            />
          </div>
          <button
            className="base-cfg-dirbtn"
            onClick={() => onSetSortRules(sortRules.map((r, j) => (j === i ? { ...r, direction: r.direction === "ASC" ? "DESC" : "ASC" } : r)))}
            aria-label={rule.direction === "ASC" ? t("database.sortAsc", "Aufsteigend") : t("database.sortDesc", "Absteigend")}
            title={rule.direction === "ASC" ? t("database.sortAsc", "Aufsteigend") : t("database.sortDesc", "Absteigend")}
          >
            {rule.direction === "ASC" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            <span>{rule.direction === "ASC" ? t("database.sortAsc", "Aufsteigend") : t("database.sortDesc", "Absteigend")}</span>
          </button>
          <button onClick={() => onSetSortRules(sortRules.filter((_, j) => j !== i))} aria-label={t("database.removeSort", "Sortierung entfernen")} title={t("database.removeSort", "Sortierung entfernen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
        </div>
      ))}
      <button
        className="base-cfg-addrow"
        onClick={() => {
          const free = sortableColumns.find((c) => !sortRules.some((r) => r.property === c));
          if (free) onSetSortRules([...sortRules, { property: free, direction: "ASC" }]);
        }}
        disabled={sortableColumns.every((c) => sortRules.some((r) => r.property === c))}
      >
        <Plus size={12} /> {t("database.addSort", "Sortierung hinzufügen")}
      </button>
    </section>
  );
}

// Single docked, view-adaptive config panel of the BaseViewer. Section order per
// plan Base-Erweiterungen W2 (P2): the data source sits at the very top and the
// former mixed "Filter" block is split into a source section and a property-
// filter section with editable rows.
export function BaseConfigPanel({
  currentViewType,
  extendedDbEnabled,
  dbConfig,
  activeViewIndex,
  embedScope,
  visibleColumns,
  availableColumns,
  columnCoverage,
  cells,
  filterValueRows,
  boardGroupBy,
  coverImageProperty,
  dateProp,
  endProp,
  dateFormat,
  sortRules,
  onClose,
  onSetViewType,
  onToggleColumn,
  onOpenColumnEditor,
  onSaveConfig,
  onMutateFilters,
  onSetSortRules,
  onAddProperty,
  onReorderColumns,
  onSetBoardGroupBy,
  boardColorMode,
  onSetBoardColorMode,
  pinboardFilterBy,
  onSetPinboardFilterBy,
  onSetCoverImage,
  onSetDateField,
  onSetDateFieldType,
  onSetEndDateField,
  onSetDateFormat,
  subItemsProperty,
  onEnableSubItems,
  onSetSubItemsProperty,
}: {
  currentViewType: string;
  extendedDbEnabled: boolean;
  dbConfig: any;
  /** Index of the active view — property filter rules are edited per view. */
  activeViewIndex: number;
  /** Embed scope control (shown as a "Diese Notiz" row); only when embedded. */
  embedScope?: { selection: string; onChange: (v: string) => void; options: { value: string; label: string }[] };
  visibleColumns: string[];
  availableColumns: string[];
  /** In how many of the loaded entries each property is set (x/y badge). */
  columnCoverage: { counts: Record<string, number>; total: number };
  cells: BaseCells;
  /** Rows of the unfiltered SOURCE — the filter value dropdowns derive their options from these. */
  filterValueRows: Record<string, any>[];
  boardGroupBy: string | null;
  coverImageProperty: string | null;
  dateProp: string | null;
  endProp: string | null;
  dateFormat: string;
  sortRules: SortRuleUI[];
  onClose: () => void;
  onSetViewType: (type: string) => void;
  onToggleColumn: (col: string) => void;
  onOpenColumnEditor: (col: string) => void;
  onSaveConfig: (config: any) => void;
  /** Apply one pure filter mutation (filterExpr helpers) to a config copy and save it. */
  onMutateFilters: (mutate: (cfg: any) => any) => void;
  onSetSortRules: (rules: SortRuleUI[]) => void;
  onAddProperty: (name: string, input: string) => void;
  /** Rewrites the active view's column order (drag-reorder in the properties list). */
  onReorderColumns: (cols: string[]) => void;
  onSetBoardGroupBy: (col: string) => void;
  /** Board column tint mode (WP3): "column" tints the whole list, "chip" only the header chip. */
  boardColorMode?: "chip" | "column";
  onSetBoardColorMode: (mode: "chip" | "column") => void;
  /** Pinboard label-chip source (plan Pinboard P1): "tags" (default) or a multiselect column key. */
  pinboardFilterBy?: string;
  onSetPinboardFilterBy?: (source: string) => void;
  onSetCoverImage: (col: string | null) => void;
  onSetDateField: (col: string) => void;
  onSetDateFieldType: (t: "date" | "datetime") => void;
  onSetEndDateField: (col: string) => void;
  onSetDateFormat: (fmt: string) => void;
  /** The active table view's sub-items parent property (null = flat, P10). */
  subItemsProperty?: string | null;
  /** Turn sub-items on: creates the parent self-relation + reverse column when missing. */
  onEnableSubItems?: () => void;
  /** Switch the parent property or turn nesting off (null). */
  onSetSubItemsProperty?: (col: string | null) => void;
}) {
  const { t } = useTranslation();

  // Pointer-drag reorder of the enabled property rows — dropping rewrites the
  // active view's `order` (plan UI-UX-Paket P3).
  const colDrag = useRowDrag((from, to) => {
    const next = [...visibleColumns];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorderColumns(next);
  });

  // Per-view filters (plan Per-View-Filter 2026-07-07): property filter RULES
  // live in the active view (views[i].filters); folder/tag SOURCES and the
  // "Diese Notiz" contextFilters stay base-global. The filterExpr mutators only
  // touch `.filters`, so pointing them at the active view object scopes them per
  // view unchanged.
  const viewOf = (cfg: any) => {
    const views = Array.isArray(cfg.views) ? cfg.views : (cfg.views = []);
    const idx = Math.max(0, Math.min(activeViewIndex, views.length - 1));
    return views[idx] && typeof views[idx] === "object" ? views[idx] : (views[idx] = {});
  };
  /** Apply a filterExpr mutator to the ACTIVE view of a config copy and save. */
  const mutateViewFilters = (fn: (view: any) => any) =>
    onMutateFilters((cfg) => {
      fn(viewOf(cfg));
      return cfg;
    });
  const activeView = dbConfig?.views?.[Math.max(0, Math.min(activeViewIndex, (dbConfig?.views?.length ?? 1) - 1))] ?? {};

  // Property-filter model (plan Base-Filtergruppen P9): top logic over loose
  // rules and one level of groups; source conditions never show here. Read from
  // the active view (per-view filters).
  const filterModel = buildUIFilterModel(activeView);

  // The local state only matters while no entry exists (it decides where the
  // NEXT filter is added); otherwise the logic derives from the lists.
  const [emptyLogic, setEmptyLogic] = useState<"all" | "any">("all");
  const filterLogic: "all" | "any" = filterModel.hasEntries ? filterModel.topLogic : emptyLogic;
  const setFilterLogic = (to: "all" | "any") => {
    setEmptyLogic(to);
    if (to !== filterLogic && filterModel.hasEntries) {
      mutateViewFilters((v) => moveTopFilterEntries(v, to));
    }
  };

  // A rule is complete once it has a column and either a value or an is-empty
  // operator (P11) — half-configured drafts never hit the .base and so never
  // empty the view.
  const ruleComplete = (rule: PropertyFilterRule) =>
    !!rule.column && (rule.value !== "" || rule.op === "empty" || rule.op === "notEmpty");

  // Draft rows: one loose rule, one fresh group (rule + its logic) and one
  // per existing group (keyed by list:idx), each committed only when complete.
  const [draftFilter, setDraftFilter] = useState<PropertyFilterRule | null>(null);
  const [draftGroup, setDraftGroup] = useState<{ logic: "all" | "any"; rule: PropertyFilterRule } | null>(null);
  const [groupDrafts, setGroupDrafts] = useState<Record<string, PropertyFilterRule>>({});
  const groupKey = (ref: FilterEntryRef) => `${ref.list}:${ref.idx}`;

  // "Diese Notiz" is not a native filter (E1=B): it lands in the plainva-side
  // contextFilters (base-global), so Obsidian ignores it and it never fills the
  // .base with a literal @this clause.
  const isSelfDraft = (rule: PropertyFilterRule) => rule.value === SELF_MARKER && !!rule.column;
  const commitDraft = (rule: PropertyFilterRule) => {
    if (isSelfDraft(rule)) {
      onMutateFilters((cfg) => addContextFilter(cfg, rule.column));
      setDraftFilter(null);
      return;
    }
    if (ruleComplete(rule)) {
      mutateViewFilters((v) => addTopFilterRule(v, serializePropertyFilter(rule), filterLogic));
      setDraftFilter(null);
    } else {
      setDraftFilter(rule);
    }
  };
  const commitDraftGroup = (logic: "all" | "any", rule: PropertyFilterRule) => {
    if (isSelfDraft(rule)) {
      onMutateFilters((cfg) => addContextFilter(cfg, rule.column));
      setDraftGroup(null);
      return;
    }
    if (ruleComplete(rule)) {
      mutateViewFilters((v) => addGroupWithRule(v, logic, serializePropertyFilter(rule), filterLogic));
      setDraftGroup(null);
    } else {
      setDraftGroup({ logic, rule });
    }
  };
  const commitGroupDraft = (ref: FilterEntryRef, rule: PropertyFilterRule) => {
    const key = groupKey(ref);
    if (isSelfDraft(rule)) {
      onMutateFilters((cfg) => addContextFilter(cfg, rule.column));
      setGroupDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    if (ruleComplete(rule)) {
      mutateViewFilters((v) => addRuleToGroup(v, ref, serializePropertyFilter(rule)));
      setGroupDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setGroupDrafts((prev) => ({ ...prev, [key]: rule }));
    }
  };

  // New-property inline form (decision F1: schema-only column).
  const [showAddProp, setShowAddProp] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState("text");
  const newPropExists = availableColumns.includes(newPropName.trim()) || newPropName.trim().startsWith("file.");
  const commitNewProp = () => {
    const name = newPropName.trim();
    if (!name || newPropExists) return;
    onAddProperty(name, newPropType);
    setNewPropName("");
    setNewPropType("text");
    setShowAddProp(false);
  };

  const currentDateType = dateProp && cells.getColumnInput(dateProp) === "datetime" ? "datetime" : "date";

  return (
    <aside className="base-config-panel" aria-label={t("database.configure", "Konfigurieren")}>
      <div className="base-cfg-head">
        <span className="base-cfg-headtitle"><SlidersHorizontal size={14} />{t("database.configure", "Konfigurieren")}</span>
        <button onClick={onClose} aria-label={t("common.close", "Schließen")} title={t("common.close", "Schließen")} className="base-cfg-close"><X size={16} /></button>
      </div>

      {/* 1. Data source — at the very top (P2); its own header lives inside. */}
      <section className="base-cfg-section">
        <DatabaseSourceConfig dbConfig={dbConfig} onSaveConfig={onSaveConfig} />
      </section>

      {/* 2. View — the view type WITH its view-specific options right below
          (layout redesign, maintainer 2026-07-03): board grouping, calendar/
          timeline date fields, gallery cover, table sub-items and the date
          format live here instead of a detached "Layout" section at the end. */}
      <section className="base-cfg-section">
        <div className="base-cfg-title">{t("database.sectionView", "Ansicht")}</div>
        <label className="base-cfg-field">{t("database.viewType", "Ansichtstyp")}
          <Select ariaLabel={t("database.viewType", "Ansichtstyp")} value={currentViewType} onChange={(v) => onSetViewType(v)} options={ALL_VIEW_TYPES.filter((ty) => extendedDbEnabled || !EXTENDED_TYPES.includes(ty)).map((ty) => ({ value: ty, label: defaultViewName(t, ty) }))} />
        </label>
        {currentViewType === "board" && (
          <label className="base-cfg-field">{t("database.groupBy", "Gruppieren nach")}
            <Select ariaLabel={t("database.groupBy", "Gruppieren nach")} value={boardGroupBy || ""} onChange={(v) => onSetBoardGroupBy(v)} options={availableColumns.map((c) => ({ value: c, label: cells.columnLabel(c) }))} />
          </label>
        )}
        {/* Whole-column tint (WP3): only meaningful for a curated option group. */}
        {currentViewType === "board" && boardGroupBy && ["select", "status", "multiselect"].includes(dbConfig?.columns?.[boardGroupBy]?.input) && (
          <label className="base-cfg-field">{t("database.boardColor", "Spaltenfarbe")}
            <Select
              ariaLabel={t("database.boardColor", "Spaltenfarbe")}
              value={boardColorMode === "column" ? "column" : "chip"}
              onChange={(v) => onSetBoardColorMode(v === "column" ? "column" : "chip")}
              options={[
                { value: "chip", label: t("database.boardColorChip", "Nur Chip") },
                { value: "column", label: t("database.boardColorColumn", "Ganze Liste") },
              ]}
            />
          </label>
        )}
        {/* Pinboard label-chip source (plan Pinboard P1): tags (default) or a
            curated multiselect property — mirrors the board grouping pattern. */}
        {currentViewType === "pinboard" && onSetPinboardFilterBy && (
          <label className="base-cfg-field">{t("database.pinboardFilterBy", "Label-Quelle")}
            <Select
              ariaLabel={t("database.pinboardFilterBy", "Label-Quelle")}
              value={pinboardFilterBy && pinboardFilterBy !== "tags" ? pinboardFilterBy : "tags"}
              onChange={(v) => onSetPinboardFilterBy(v)}
              options={[
                { value: "tags", label: t("sidebar.tags", "Tags") },
                ...availableColumns
                  .filter((c) => dbConfig?.columns?.[c]?.input === "multiselect")
                  .map((c) => ({ value: c, label: cells.columnLabel(c) })),
              ]}
            />
          </label>
        )}
        {(currentViewType === "calendar" || currentViewType === "timeline") && (
          <DateViewControls
            isTimeline={currentViewType === "timeline"}
            dateProp={dateProp}
            endProp={endProp}
            currentType={currentDateType}
            availableColumns={availableColumns}
            cells={cells}
            onSetDateField={onSetDateField}
            onSetDateFieldType={onSetDateFieldType}
            onSetEndDateField={onSetEndDateField}
          />
        )}
        {currentViewType === "gallery" && (
          <label className="base-cfg-field">{t("database.coverImage", "Titelbild")}
            <Select ariaLabel={t("database.coverImage", "Titelbild")} value={coverImageProperty || ""} onChange={(v) => onSetCoverImage(v || null)} options={[{ value: "", label: t("database.noCover", "Kein Titelbild") }, ...availableColumns.map((c) => ({ value: c, label: cells.columnLabel(c) }))]} />
          </label>
        )}
        {currentViewType === "table" && onEnableSubItems && onSetSubItemsProperty && (() => {
          // Sub-items (P10, Notion "Sub-items"): the switch nests rows under
          // their parent (a self-relation). Enabling creates the parent
          // property + reverse column when the base has none yet.
          const selfRelationColumns = Object.entries((dbConfig?.columns ?? {}) as Record<string, any>)
            .filter(([, c]) => c && typeof c === "object" && c.input === "relation" && !c.reverseOf)
            .map(([name]) => name);
          return (
            <>
              <div className="base-cfg-field" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                {t("database.subItems", "Unterelemente")}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!subItemsProperty}
                  aria-label={t("database.enableSubItems", "Unterelemente aktivieren")}
                  className={`pv-switch${subItemsProperty ? " pv-switch-on" : ""}`}
                  onClick={() => { if (subItemsProperty) onSetSubItemsProperty(null); else onEnableSubItems(); }}
                >
                  <span className="pv-switch-knob" />
                </button>
              </div>
              {subItemsProperty && selfRelationColumns.length > 1 && (
                <label className="base-cfg-field">{t("database.subItemsProperty", "Eltern-Eigenschaft")}
                  <Select
                    ariaLabel={t("database.subItemsProperty", "Eltern-Eigenschaft")}
                    value={subItemsProperty}
                    onChange={(v) => onSetSubItemsProperty(v || null)}
                    options={selfRelationColumns.map((c) => ({ value: c, label: cells.columnLabel(c) }))}
                  />
                </label>
              )}
              <div className="base-cfg-empty">{t("database.subItemsHint", "Verschachtelt: Einträge mit Eltern-Relation erscheinen aufklappbar unter ihrem Eltern-Eintrag. Aus = flache Liste; die Eigenschaften bleiben erhalten.")}</div>
            </>
          );
        })()}
        <label className="base-cfg-field">{t("database.dateFormat", "Datumsformat")}
          <Select
            ariaLabel={t("database.dateFormat", "Datumsformat")}
            value={dateFormat}
            onChange={onSetDateFormat}
            options={[
              { value: "default", label: t("database.dateFormatDefault", "Standard (03.07.2026)") },
              { value: "long", label: t("database.dateFormatLong", "Lang (3. Juli 2026)") },
              { value: "iso", label: t("database.dateFormatIso", "ISO (2026-07-03)") },
              { value: "relative", label: t("database.dateFormatRelative", "Relativ (vor 3 Tagen)") },
            ]}
          />
        </label>
      </section>

      {/* 3. Properties (visible columns + new property) */}
      <section className="base-cfg-section">
        <div className="base-cfg-title">{t("database.properties", "Eigenschaften")}</div>
        {(() => {
          // One list in column order: the view's enabled columns (incl. file.*)
          // are drag-reorderable — dropping rewrites `order` —, the not-enabled
          // leftovers follow below without a grip (plan UI-UX-Paket P3).
          const disabled = [
            ...["file.name", "file.mtime"].filter((c) => !visibleColumns.includes(c)),
            ...availableColumns.filter((c) => !visibleColumns.includes(c)),
          ];
          const renderRow = (col: string, dragIndex: number | null) => {
            // Relation direction badge: "→ target" for owning relations, "← source"
            // for computed reverse columns (P8); the stem keeps the row compact.
            const schema = cells.getColumnSchema?.(col);
            const stemOf = (p: string) => p.split("/").pop()?.replace(/\.base$/i, "") || p;
            const relBadge = schema?.reverseOf
              ? { text: `← ${stemOf(schema.reverseOf.base)}`, tip: t("database.badgeReverse", "Rückrelation zu „{{property}}“ in „{{base}}“", { property: schema.reverseOf.property, base: schema.reverseOf.base }) }
              : schema?.input === "relation" && schema.relationBase
                ? { text: `→ ${stemOf(schema.relationBase)}`, tip: t("database.badgeRelation", "Relation zu „{{base}}“", { base: schema.relationBase }) }
                : null;
            return (
              <div
                key={col}
                ref={dragIndex != null ? colDrag.rowRef(dragIndex) : undefined}
                className={`base-cfg-colrow${dragIndex != null && colDrag.overIdx === dragIndex && colDrag.dragIdx !== null && colDrag.dragIdx !== dragIndex ? " base-cfg-row-drop" : ""}`}
                style={{ opacity: dragIndex != null && colDrag.dragIdx === dragIndex ? 0.5 : 1 }}
              >
                {dragIndex != null ? (
                  <span
                    className="base-cfg-grip"
                    role="button"
                    aria-label={t("database.reorderProperty", "Eigenschaft verschieben (ziehen)")}
                    title={t("database.reorderProperty", "Eigenschaft verschieben (ziehen)")}
                    {...colDrag.gripProps(dragIndex)}
                  >
                    <GripVertical size={12} />
                  </span>
                ) : (
                  <span style={{ width: 12, flexShrink: 0 }} aria-hidden="true" />
                )}
                <label className="base-cfg-check" style={{ flex: 1, minWidth: 0 }}>
                  <input type="checkbox" className="pv-check" checked={visibleColumns.includes(col)} onChange={() => onToggleColumn(col)} />
                  {" "}<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{cells.columnLabel(col)}</span>
                  {relBadge && <span className="base-cfg-badge" title={relBadge.tip}>{relBadge.text}</span>}
                  {availableColumns.includes(col) && (
                    <span
                      className="base-cfg-badge"
                      title={t("database.coverageTooltip", "In {{count}} von {{total}} Einträgen vorhanden", { count: columnCoverage.counts[col] ?? 0, total: columnCoverage.total })}
                    >{columnCoverage.counts[col] ?? 0}/{columnCoverage.total}</span>
                  )}
                </label>
                {!col.startsWith("file.") && (
                  <button onClick={() => onOpenColumnEditor(col)} aria-label={t("properties.editColumn", { column: col })} title={t("properties.editColumn", { column: col })} className="base-cfg-iconbtn"><Settings2 size={12} /></button>
                )}
              </div>
            );
          };
          return (
            <>
              {visibleColumns.map((col, i) => renderRow(col, i))}
              {disabled.map((col) => renderRow(col, null))}
            </>
          );
        })()}
        {!showAddProp && (
          <button className="base-cfg-addrow" onClick={() => setShowAddProp(true)}><Plus size={12} /> {t("database.newProperty", "Neue Eigenschaft")}</button>
        )}
        {showAddProp && (
          // Stacked full-width card (layout redesign): the name, the type and
          // the confirm never fight for one narrow row, and the type dropdown
          // opens over the card instead of colliding with the filter section.
          <div className="base-cfg-newprop">
            <input
              autoFocus
              type="text"
              className="base-cfg-input"
              placeholder={t("database.propertyNamePlaceholder", "Name der Eigenschaft...")}
              value={newPropName}
              onChange={(e) => setNewPropName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitNewProp(); if (e.key === "Escape") setShowAddProp(false); }}
            />
            <Select
              ariaLabel={t("properties.type", { defaultValue: "Typ" })}
              value={newPropType}
              size="sm"
              minWidth={0}
              onChange={setNewPropType}
              options={baseInputTypeOptions(t)}
            />
            {newPropExists && <div className="base-cfg-empty">{t("database.propertyExists", "Diese Eigenschaft existiert bereits.")}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
              <button className="base-cfg-addrow" style={{ margin: 0 }} onClick={() => setShowAddProp(false)}>{t("common.cancel", "Abbrechen")}</button>
              <button className="base-cfg-addbtn" onClick={commitNewProp} disabled={!newPropName.trim() || newPropExists} style={{ opacity: !newPropName.trim() || newPropExists ? 0.5 : 1 }}>{t("database.add", "Hinzufügen")}</button>
            </div>
          </div>
        )}
      </section>

      {/* 4. Property filters — editable rows with an all/any toggle (P4, F3). */}
      <section className="base-cfg-section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
          <div className="base-cfg-title" style={{ margin: 0 }}>{t("database.filter", "Filter")}</div>
          <div className="base-cfg-seg" role="group" aria-label={t("database.filterLogic", "Verknüpfung")}>
            <button
              className={filterLogic === "all" ? "active" : ""}
              title={t("database.filterMatchAllTip", "Alle Bedingungen müssen zutreffen")}
              onClick={() => setFilterLogic("all")}
            >{t("database.filterMatchAll", "Alle")}</button>
            <button
              className={filterLogic === "any" ? "active" : ""}
              title={t("database.filterMatchAnyTip", "Mindestens eine Bedingung muss zutreffen")}
              onClick={() => setFilterLogic("any")}
            >{t("database.filterMatchAny", "Beliebige")}</button>
          </div>
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "-2px", marginBottom: "2px" }}>{t("database.filterPerViewHint", "Gilt für diese Ansicht")}</div>
        {!filterModel.hasEntries && getContextFilters(dbConfig).length === 0 && !embedScope && !draftFilter && !draftGroup && <div className="base-cfg-empty">{t("database.noFilters", "Keine Filter aktiv")}</div>}
        {filterModel.entries.map((entry) => {
          const key = `${entry.ref.list}-${entry.ref.idx}`;
          if (entry.kind === "opaque") {
            return (
              <div key={key} className="base-cfg-chiprow" title={t("database.complexFilterTip", "Verschachtelter Filter aus Obsidian – bleibt erhalten und wird angewendet, ist hier aber nicht editierbar.")}>
                <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>{t("database.complexFilter", "Komplexer Filter (nicht editierbar)")}</span>
                <button onClick={() => mutateViewFilters((v) => removeFilterEntry(v, entry.ref))} aria-label={t("common.delete", "Löschen")} title={t("common.delete", "Löschen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
              </div>
            );
          }
          if (entry.kind === "rawString") {
            return (
              <div key={key} className="base-cfg-chiprow">
                <span style={{ wordBreak: "break-all" }}>{entry.raw}</span>
                <button onClick={() => mutateViewFilters((v) => removeFilterEntry(v, entry.ref))} aria-label={t("common.delete", "Löschen")} title={t("common.delete", "Löschen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
              </div>
            );
          }
          if (entry.kind === "rule") {
            return (
              <FilterRow
                key={key}
                rule={entry.rule}
                availableColumns={availableColumns}
                filterValueRows={filterValueRows}
                cells={cells}
                t={t}
                onChange={(rule) => {
                  if (rule.value === SELF_MARKER && rule.column) {
                    // Convert a per-view rule into a base-global context filter:
                    // remove from the active view, add to the config's contextFilters.
                    onMutateFilters((cfg) => { removeFilterEntry(viewOf(cfg), entry.ref); return addContextFilter(cfg, rule.column); });
                    return;
                  }
                  if (rule.column && (rule.value !== "" || rule.op === "empty" || rule.op === "notEmpty" || entry.rule.value === rule.value)) {
                    mutateViewFilters((v) => updateTopFilterRule(v, entry.ref, serializePropertyFilter(rule)));
                  }
                }}
                onRemove={() => mutateViewFilters((v) => removeFilterEntry(v, entry.ref))}
              />
            );
          }
          // Group box: own all/any toggle, its rules, a per-group draft row.
          const draft = groupDrafts[groupKey(entry.ref)];
          return (
            <div key={key} className="base-cfg-filtergroup" style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", padding: "6px", display: "flex", flexDirection: "column", gap: "4px", background: "var(--bg-secondary)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>{t("database.filterGroup", "Gruppe")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <div className="base-cfg-seg" role="group" aria-label={t("database.filterLogic", "Verknüpfung")}>
                    <button
                      className={entry.logic === "all" ? "active" : ""}
                      title={t("database.filterMatchAllTip", "Alle Bedingungen müssen zutreffen")}
                      onClick={() => mutateViewFilters((v) => setGroupLogic(v, entry.ref, "all"))}
                    >{t("database.filterMatchAll", "Alle")}</button>
                    <button
                      className={entry.logic === "any" ? "active" : ""}
                      title={t("database.filterMatchAnyTip", "Mindestens eine Bedingung muss zutreffen")}
                      onClick={() => mutateViewFilters((v) => setGroupLogic(v, entry.ref, "any"))}
                    >{t("database.filterMatchAny", "Beliebige")}</button>
                  </div>
                  <button onClick={() => mutateViewFilters((v) => removeFilterEntry(v, entry.ref))} aria-label={t("database.removeGroup", "Gruppe entfernen")} title={t("database.removeGroup", "Gruppe entfernen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
                </div>
              </div>
              {entry.items.map((item) =>
                item.rule ? (
                  <FilterRow
                    key={item.idx}
                    rule={item.rule}
                    availableColumns={availableColumns}
                    filterValueRows={filterValueRows}
                    cells={cells}
                    t={t}
                    onChange={(rule) => {
                      if (rule.value === SELF_MARKER && rule.column) {
                        // Convert a per-view group rule into a base-global context filter.
                        onMutateFilters((cfg) => { removeGroupRule(viewOf(cfg), entry.ref, item.idx); return addContextFilter(cfg, rule.column); });
                        return;
                      }
                      if (rule.column && (rule.value !== "" || rule.op === "empty" || rule.op === "notEmpty" || item.rule!.value === rule.value)) {
                        mutateViewFilters((v) => updateGroupRule(v, entry.ref, item.idx, serializePropertyFilter(rule)));
                      }
                    }}
                    onRemove={() => mutateViewFilters((v) => removeGroupRule(v, entry.ref, item.idx))}
                  />
                ) : (
                  <div key={item.idx} className="base-cfg-chiprow">
                    <span style={{ wordBreak: "break-all" }}>{item.raw}</span>
                    <button onClick={() => mutateViewFilters((v) => removeGroupRule(v, entry.ref, item.idx))} aria-label={t("common.delete", "Löschen")} title={t("common.delete", "Löschen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
                  </div>
                )
              )}
              {draft && (
                <FilterRow
                  rule={draft}
                  availableColumns={availableColumns}
                  filterValueRows={filterValueRows}
                  cells={cells}
                  t={t}
                  onChange={(rule) => commitGroupDraft(entry.ref, rule)}
                  onRemove={() => setGroupDrafts((prev) => { const next = { ...prev }; delete next[groupKey(entry.ref)]; return next; })}
                />
              )}
              {!draft && (
                <button className="base-cfg-addrow" style={{ margin: 0 }} onClick={() => setGroupDrafts((prev) => ({ ...prev, [groupKey(entry.ref)]: { column: "", op: "==", value: "" } }))}>
                  <Plus size={12} /> {t("database.addRule", "Regel hinzufügen")}
                </button>
              )}
            </div>
          );
        })}
        {getContextFilters(dbConfig).map((prop) => (
          <div key={`ctx-${prop}`} className="base-cfg-chiprow" title={t("database.filterThisNoteTip", "Filtert im eingebetteten Zustand auf die aktuelle Notiz; alleine geöffnet werden alle Zeilen gezeigt.")}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {cells.columnLabel(prop)} · {t("database.opContains", "enthält")} · <strong>{t("database.filterThisNote", "Diese Notiz")}</strong>
            </span>
            <button onClick={() => onMutateFilters((cfg) => removeContextFilter(cfg, prop))} aria-label={t("common.delete", "Löschen")} title={t("common.delete", "Löschen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
          </div>
        ))}
        {/* Embed scope, unified into the filter list (maintainer 2026-07-07): the
            auto-scope of an embedded, related database as a "Diese Notiz" row —
            switch the relation or choose "Alle anzeigen". Runtime-only, not saved. */}
        {embedScope && (
          <div className="base-cfg-chiprow" title={t("database.embedScopeLabel", "Diese Datenbank auf die aktuelle Notiz filtern")}>
            <Filter size={12} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-muted)" }} />
            <Select
              ariaLabel={t("database.embedScopeLabel", "Diese Datenbank auf die aktuelle Notiz filtern")}
              value={embedScope.selection}
              size="sm"
              minWidth={60}
              onChange={embedScope.onChange}
              options={embedScope.options}
            />
          </div>
        )}
        {draftFilter && (
          <FilterRow
            rule={draftFilter}
            availableColumns={availableColumns}
            filterValueRows={filterValueRows}
            cells={cells}
            t={t}
            onChange={commitDraft}
            onRemove={() => setDraftFilter(null)}
          />
        )}
        {draftGroup && (
          <div className="base-cfg-filtergroup" style={{ border: "1px dashed var(--border-color)", borderRadius: "var(--radius-sm)", padding: "6px", display: "flex", flexDirection: "column", gap: "4px", background: "var(--bg-secondary)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>{t("database.filterGroup", "Gruppe")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <div className="base-cfg-seg" role="group" aria-label={t("database.filterLogic", "Verknüpfung")}>
                  <button className={draftGroup.logic === "all" ? "active" : ""} onClick={() => setDraftGroup({ ...draftGroup, logic: "all" })}>{t("database.filterMatchAll", "Alle")}</button>
                  <button className={draftGroup.logic === "any" ? "active" : ""} onClick={() => setDraftGroup({ ...draftGroup, logic: "any" })}>{t("database.filterMatchAny", "Beliebige")}</button>
                </div>
                <button onClick={() => setDraftGroup(null)} aria-label={t("database.removeGroup", "Gruppe entfernen")} title={t("database.removeGroup", "Gruppe entfernen")} className="base-cfg-delbtn"><Trash2 size={12} /></button>
              </div>
            </div>
            <FilterRow
              rule={draftGroup.rule}
              availableColumns={availableColumns}
              filterValueRows={filterValueRows}
              cells={cells}
              t={t}
              onChange={(rule) => commitDraftGroup(draftGroup.logic, rule)}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {!draftFilter && (
            <button className="base-cfg-addrow" style={{ margin: 0 }} onClick={() => setDraftFilter({ column: "", op: "==", value: "" })}><Plus size={12} /> {t("database.addFilter", "Filter hinzufügen")}</button>
          )}
          {!draftGroup && (
            <button className="base-cfg-addrow" style={{ margin: 0 }} onClick={() => setDraftGroup({ logic: "all", rule: { column: "", op: "==", value: "" } })}><Plus size={12} /> {t("database.addFilterGroup", "Gruppe hinzufügen")}</button>
          )}
        </div>
      </section>

      {/* 5. Sort — rule rows for every view type (P9). */}
      <SortSection sortRules={sortRules} availableColumns={availableColumns} cells={cells} t={t} onSetSortRules={onSetSortRules} />
    </aside>
  );
}
