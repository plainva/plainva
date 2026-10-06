import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { asSingleLineValue, Button, GrowingField, IconButton, ICON, PropRow, Rating, tagColorAttrs, useFixedPopover, usePropertyValues, PropertyNameInput, type ValueSuggestionLoader, type PropertySuggestionSource } from "@plainva/ui";
import {
  Type, Hash, CheckSquare, Calendar, Clock, List, Tag, Link2, Mail, Phone, Globe,
  CircleDot, ListChecks, ChevronsUpDown, ChevronDown, X, Plus, Trash2, Search, ExternalLink, Lock, Sigma, Star, MessageSquare,
} from "lucide-react";
import { CustomDatePicker } from "./DatePicker";
import {
  PropertyType, tagSegments, stripWikiLink, toWikiLink, chipClass,
  formatDateValue, filterTagSuggestions, TagSuggestion, CuratedOption, groupOptions,
} from "@plainva/ui";

export interface RelationCandidate { path: string; title: string; }

type TFn = (key: string, opts?: any) => string;

/**
 * The `.base` column editor shares this menu (Gesamtplan 2026-07-04, P7): its
 * vocabulary is the panel's minus the generic `link` plus `relation` (a link
 * with schema — target base, cardinality, reverse column).
 */
export type MenuPropertyType = PropertyType | "relation" | "rollup";

export const TYPE_ICONS: Record<MenuPropertyType, React.ElementType> = {
  text: Type, number: Hash, rating: Star, checkbox: CheckSquare, date: Calendar, datetime: Clock,
  list: List, tags: Tag, select: ChevronsUpDown, status: CircleDot, multiselect: ListChecks,
  url: Globe, email: Mail, phone: Phone, link: Link2, relation: Link2, rollup: Sigma,
};

const TYPE_GROUPS: { labelKey: string; types: PropertyType[] }[] = [
  { labelKey: "properties.group_basic", types: ["text", "number", "rating", "checkbox", "date", "datetime"] },
  { labelKey: "properties.group_choice", types: ["select", "status", "multiselect"] },
  { labelKey: "properties.group_list", types: ["list", "tags", "link"] },
  { labelKey: "properties.group_contact", types: ["url", "email", "phone"] },
];

/** Same groups for `.base` columns — `relation` takes the generic link's slot. */
export const BASE_TYPE_GROUPS: { labelKey: string; types: MenuPropertyType[] }[] = [
  { labelKey: "properties.group_basic", types: ["text", "number", "rating", "checkbox", "date", "datetime"] },
  { labelKey: "properties.group_choice", types: ["select", "status", "multiselect"] },
  { labelKey: "properties.group_list", types: ["list", "tags", "relation"] },
  { labelKey: "properties.group_contact", types: ["url", "email", "phone"] },
  // Derived, not entered: a rollup's value is computed from the linked notes.
  { labelKey: "properties.group_computed", types: ["rollup"] },
];

export function typeLabel(t: TFn, type: MenuPropertyType): string {
  return t(`properties.type_${type}`);
}

/* ------------------------------------------------------------------ helpers */

function openExternal(href: string) {
  try { window.open(href, "_blank", "noopener"); } catch { /* webview may block — no-op */ }
}

/** Look up a curated option's color/label by value (for the active chip + option rows). */
function findOption(curated: CuratedOption[] | undefined, value: string): CuratedOption | undefined {
  return curated?.find((o) => o.value === value);
}

/**
 * A click on the free part of a chip value puts the caret into its input. The
 * input is folded away while the value is only read (a quiet value shows its
 * chips, not an empty field behind them), so the value itself is the target.
 * A click on a chip's own button stays that button's.
 */
function focusChipInput(e: ReactMouseEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest("button")) return;
  e.currentTarget.querySelector<HTMLInputElement>(".pv-chip-input")?.focus();
}

/* ------------------------------------------------------------------ inputs */

export function PlainInput({ value, onChange, type, t, propKey = "", getValueSuggestions, curated, autoFocus, onClose, growing, selectOnFocus = true }: {
  value: any; onChange: (v: any) => void; type: PropertyType; t: TFn; propKey?: string;
  getValueSuggestions?: ValueSuggestionLoader; curated?: CuratedOption[]; autoFocus?: boolean; onClose?: () => void;
  /** A table cell (issue 118): the field wraps and grows with the text instead of showing one line of it. */
  growing?: boolean;
  /**
   * A cell editor opens to replace its value, so the text is selected. A
   * property row is a standing field one clicks INTO — there the caret goes
   * where the click was.
   */
  selectOnFocus?: boolean;
}) {
  const [v, setV] = useState(String(value ?? ""));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const suggestions = usePropertyValues(open && curated === undefined, propKey, getValueSuggestions);
  const options = curated ?? suggestions.values;
  const matches = options.filter((o) => o.value !== v && o.value.toLocaleLowerCase().includes(v.toLocaleLowerCase()));
  const popRef = useFixedPopover(open && (!!getValueSuggestions || curated !== undefined), wrapRef);
  useEffect(() => setV(String(value ?? "")), [value]);
  const commit = () => { if (v !== String(value ?? "")) onChange(v); onClose?.(); };
  const pick = (next: string) => { setV(next); setOpen(false); onChange(next); onClose?.(); };
  const href = type === "url" ? v : type === "email" ? `mailto:${v}` : type === "phone" ? `tel:${v}` : "";
  // One set of keys for both shapes of the field. Enter saves in the growing
  // one too: a cell holds one value, its lines come from wrapping.
  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Without a suggestion to choose, the arrows belong to the caret: in a
      // field with several lines that is how one gets from line to line.
      if (growing && matches.length === 0) return;
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(matches.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    }
    if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && matches[active]) pick(matches[active].value); else e.currentTarget.blur(); }
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); setV(String(value ?? "")); onClose?.(); }
  };
  return <div ref={wrapRef} className="pv-property-text" onBlur={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); commit(); }
  }}>
    {growing
      ? <GrowingField autoFocus={autoFocus} value={v} onFocus={(e) => { setOpen(true); if (selectOnFocus) e.currentTarget.select(); }}
          onChange={(e) => { setV(asSingleLineValue(e.target.value)); setActive(-1); setOpen(true); }}
          onKeyDown={onFieldKey} placeholder={t("properties.value")} />
      : <input autoFocus={autoFocus} type={type === "phone" ? "tel" : type === "email" ? "email" : "text"}
          className="pv-field pv-field--compact" value={v} onFocus={() => setOpen(true)}
          onChange={(e) => { setV(e.target.value); setActive(-1); setOpen(true); }}
          onKeyDown={onFieldKey} placeholder={t("properties.value")} />}
    {open && (!!getValueSuggestions || curated !== undefined) && <div ref={popRef} className="pv-popover pv-popover--fixed">
      {matches.map((o, i) => <Button variant="ghost" key={o.value} type="button" className="pv-popover-row" aria-pressed={active === i}
        onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}>{"label" in o ? o.label ?? o.value : o.value}</Button>)}
      {curated === undefined && getValueSuggestions && !suggestions.wholeVault && <Button variant="ghost" type="button" className="pv-popover-row"
        onMouseDown={(e) => e.preventDefault()} onClick={suggestions.expand}>{t("properties.searchWholeVault")}</Button>}
    </div>}
    {type !== "text" && v && <IconButton size="sm" label={t("properties.openLink")} onClick={() => openExternal(href)}><ExternalLink size={ICON.ui} /></IconButton>}
  </div>;
}

function NumberInput({ value, onChange, t }: { value: any; onChange: (v: any) => void; t: TFn }) {
  const [v, setV] = useState(value === "" || value == null ? "" : String(value));
  useEffect(() => setV(value === "" || value == null ? "" : String(value)), [value]);
  const commit = () => {
    if (v === "") { if (value !== "") onChange(""); return; }
    const n = Number(v);
    if (!Number.isNaN(n) && n !== value) onChange(n);
  };
  return (
    <input
      type="number" className="pv-field pv-field--compact" style={{ flex: 1, minWidth: 0 }} value={v}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      placeholder={t("properties.value")}
    />
  );
}

function CheckboxToggle({ value, onChange, label }: { value: any; onChange: (v: any) => void; label?: string }) {
  const on = value === true;
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label || "toggle"} onClick={() => onChange(!on)} className={`pv-switch${on ? " pv-switch-on" : ""}`}>
      <span className="pv-switch-knob" />
    </button>
  );
}

function DateValue({ value, onChange, includeTime, locale }: { value: any; onChange: (v: any) => void; includeTime: boolean; locale: string }) {
  const [editing, setEditing] = useState(false);
  // The long form at every width ("Do., 24. September 2026"), and it WRAPS
  // (plan Befunde 2026-10-06, R2). The button used to have a fixed height and
  // an ellipsis, so a narrow column showed "Do., 2…" — two letters of a date.
  // The numeric form below the comfortable step was the workaround for that
  // fixed height; a value that may take a second line does not need one.
  const str = String(value ?? "");
  if (editing || !str) {
    return (
      <CustomDatePicker
        value={str} includeTime={includeTime} autoOpen={editing}
        onChange={(val) => { onChange(val); setEditing(false); }}
        onClose={() => setEditing(false)}
      />
    );
  }
  return (
    <button type="button" className="pv-prow-date" onClick={() => setEditing(true)}>
      {formatDateValue(str, includeTime, locale, "long")}
    </button>
  );
}

/* ------------------------------------------------------------------ chips: list / tags / link */


function RelationPicker(props: {
  value: any; onChange: (v: any) => void;
  getRelationCandidates?: (query: string) => Promise<RelationCandidate[]>;
  onOpenLink?: (target: string) => void; t: TFn;
  /** Cardinality from the governing `.base` schema: "one" = a pick REPLACES the value (scalar). */
  relationLimit?: "one";
}) {
  const { value, onChange, getRelationCandidates, onOpenLink, t, relationLimit } = props;
  const items: string[] = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<RelationCandidate[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    let alive = true;
    if (open && getRelationCandidates) getRelationCandidates(query).then((r) => { if (alive) setCands(r); }).catch(() => {});
    return () => { alive = false; };
  }, [open, query, getRelationCandidates]);

  const existing = new Set(items.map((it) => stripWikiLink(it).toLowerCase()));
  const add = (title: string) => {
    const w = toWikiLink(title);
    if (!title.trim()) return;
    // Limit "one" (Notion "Limit to 1 page"): a pick replaces the value and
    // keeps it scalar; unlimited relations append to the list.
    if (relationLimit === "one") { onChange(w); setQuery(""); setOpen(false); return; }
    if (!items.includes(w)) onChange([...items, w]);
    setQuery("");
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const matches = cands.filter((c) => !existing.has(c.title.toLowerCase()));
  const canCreate = query.trim() !== "" && !existing.has(query.trim().toLowerCase()) && !matches.some((m) => m.title.toLowerCase() === query.trim().toLowerCase());
  const popRef = useFixedPopover(open, wrapRef);

  return (
    <div className="pv-tags" ref={wrapRef}>
      <div className="pv-chips" onClick={focusChipInput}>
        {items.map((it, i) => {
          const target = stripWikiLink(it);
          return (
            <span key={`${it}-${i}`} className="pv-chip pv-chip--removable pv-chip-link">
              {/* The tooltip is the full target: a chip longer than the row
                  shortens with an ellipsis, and this is where the rest is. */}
              <button type="button" className="pv-chip-link-open" onClick={() => onOpenLink?.(target)} aria-label={`${t("properties.openLink")}: ${target}`} data-tip={target}>
                <Link2 size={ICON.meta} /><span className="pv-chip-text">{target}</span>
              </button>
              <button type="button" className="pv-chip-x" aria-label={t("properties.removeItem")} onClick={() => remove(i)}><X size={ICON.meta} /></button>
            </span>
          );
        })}
        <input
          className="pv-chip-input" value={query} placeholder={t("properties.linkNote")}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (matches[0]) add(matches[0].title); else if (canCreate) add(query.trim()); }
            else if (e.key === "Backspace" && query === "" && items.length) remove(items.length - 1);
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          {matches.length > 0 && <div className="pv-popover-label">{t("properties.linkNotes")}</div>}
          {matches.slice(0, 12).map((c) => (
            <button key={c.path} type="button" className="pv-popover-row" onMouseDown={(e) => { e.preventDefault(); add(c.title); }}>
              <Link2 size={ICON.ui} className="pv-popover-ic" /> <span className="pv-chip-text">{c.title}</span>
            </button>
          ))}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onMouseDown={(e) => { e.preventDefault(); add(query.trim()); }}>
              <Plus size={ICON.ui} className="pv-popover-ic" /> {t("properties.createLink", { title: query.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TagPills({ value, onChange, suggestions, t }: { value: any; onChange: (v: any) => void; suggestions: TagSuggestion[]; t: TFn }) {
  const items: string[] = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "");
    if (!tag || items.includes(tag)) { setQuery(""); return; }
    onChange([...items, tag]);
    setQuery("");
  };
  const matches = filterTagSuggestions(suggestions, query, items);
  const canCreate = query.trim() !== "" && !suggestions.some((s) => s.tag.toLowerCase() === query.trim().toLowerCase()) && !items.includes(query.trim());
  const popRef = useFixedPopover(open, wrapRef);

  return (
    <div className="pv-tags" ref={wrapRef}>
      <div className="pv-chips" onClick={focusChipInput}>
        {items.map((tag, i) => {
          const { parent, leaf } = tagSegments(tag);
          return (
            <span key={`${tag}-${i}`} className="pv-chip pv-chip--removable pv-chip-tag" data-tip={tag} {...tagColorAttrs(tag)}>
              <span className="pv-chip-text">{parent && <span className="pv-tag-parent">{parent}</span>}{leaf}</span>
              <button type="button" className="pv-chip-x" aria-label={t("properties.removeTag")} onClick={() => remove(i)}><X size={ICON.meta} /></button>
            </span>
          );
        })}
        <input
          className="pv-chip-input" value={query}
          placeholder={t("properties.addTag")}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (matches[0]) addTag(matches[0].tag); else if (canCreate) addTag(query); }
            else if (e.key === "Backspace" && query === "" && items.length) remove(items.length - 1);
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          {matches.length > 0 && <div className="pv-popover-label">{t("properties.existingTags")}</div>}
          {matches.map((m) => {
            const { parent, leaf } = tagSegments(m.tag);
            return (
              <button key={m.tag} type="button" className="pv-popover-row" onMouseDown={(e) => { e.preventDefault(); addTag(m.tag); }}>
                <Tag size={ICON.ui} className="pv-popover-ic" />
                <span className="pv-chip-text">{parent && <span className="pv-tag-parent">{parent}</span>}{leaf}</span>
                <span className="pv-popover-count">{m.count}</span>
              </button>
            );
          })}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onMouseDown={(e) => { e.preventDefault(); addTag(query); }}>
              <Plus size={ICON.ui} className="pv-popover-ic" /> {t("properties.createTag", { tag: query.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ select / status / multiselect */


export function SelectChip(props: {
  value: any; onChange: (v: any) => void; propKey: string;
  getValueSuggestions?: ValueSuggestionLoader;
  curated?: CuratedOption[]; grouped?: boolean; t: TFn; autoOpen?: boolean; onClose?: () => void;
  /**
   * Draw the caret inside the trigger. A table cell does (it has nowhere else);
   * a property row does not — its caret stands in the row's edge column, where
   * every row keeps what it can do.
   */
  caret?: boolean;
}) {
  const { value, onChange, propKey, getValueSuggestions, curated, grouped, t, onClose, caret = true } = props;
  const [open, setOpen] = useState(props.autoOpen ?? false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const usingCurated = curated !== undefined;
  const suggestions = usePropertyValues(open && !usingCurated, propKey, getValueSuggestions);
  const discovered = suggestions.values;
  const current = value == null ? "" : String(value);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); onClose?.(); } };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  const list: CuratedOption[] = usingCurated ? curated! : discovered.map((d) => ({ value: d.value }));
  const countOf = (v: string) => (usingCurated ? undefined : discovered.find((d) => d.value === v)?.count);
  const q = query.trim().toLowerCase();
  const matches = list.filter((o) => o.value !== current && (q === "" || (o.label ?? o.value).toLowerCase().includes(q) || o.value.toLowerCase().includes(q)));
  const canCreate = q !== "" && !list.some((o) => o.value.toLowerCase() === q) && current.toLowerCase() !== q;
  const currentOpt = findOption(curated, current);
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(""); };
  const popRef = useFixedPopover(open, wrapRef);

  const renderRow = (o: CuratedOption) => (
    <button key={o.value} type="button" className="pv-popover-row" onClick={() => pick(o.value)}>
      <span className={chipClass(o.value, o.color)}><span className="pv-dot" />{o.label ?? o.value}</span>
      {countOf(o.value) !== undefined && <span className="pv-popover-count">{countOf(o.value)}</span>}
    </button>
  );

  return (
    <div className="pv-select" ref={wrapRef}>
      <button type="button" className="pv-rowhover pv-select-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {current
          ? <span className={chipClass(current, currentOpt?.color)} data-tip={currentOpt?.label ?? current}><span className="pv-dot" /><span className="pv-chip-text">{currentOpt?.label ?? current}</span></span>
          : <span className="pv-placeholder">{t("properties.selectValue")}</span>}
        {caret && <ChevronDown size={ICON.ui} className="pv-select-caret" />}
      </button>
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          <div className="pv-popover-search"><Search size={ICON.ui} /><input autoFocus value={query} placeholder={t("properties.selectValue")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (matches[0] || canCreate)) pick(matches[0]?.value ?? query.trim()); if (e.key === "Escape") { setOpen(false); onClose?.(); } }} /></div>
          {current && <button type="button" className="pv-popover-row pv-popover-clear" onClick={() => pick("")}>{t("properties.clearValue")}</button>}
          {grouped && usingCurated
            ? groupOptions(matches).map((g) => (
                <div key={g.group ?? "_"}>
                  {g.group && <div className="pv-popover-label">{g.group}</div>}
                  {g.options.map(renderRow)}
                </div>
              ))
            : matches.map(renderRow)}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onClick={() => pick(query.trim())}>
              <Plus size={ICON.ui} className="pv-popover-ic" /> {t("properties.createValue", { value: query.trim() })}
            </button>
          )}
          {!usingCurated && getValueSuggestions && !suggestions.wholeVault && <Button variant="ghost" className="pv-popover-row" onClick={suggestions.expand}>{t("properties.searchWholeVault")}</Button>}
          {matches.length === 0 && !canCreate && !current && <div className="pv-popover-empty">{t("properties.noValues")}</div>}
        </div>
      )}
    </div>
  );
}

export function MultiSelectChips(props: {
  value: any; onChange: (v: any) => void; propKey: string;
  getValueSuggestions?: ValueSuggestionLoader;
  curated?: CuratedOption[]; t: TFn; neutral?: boolean; autoOpen?: boolean;
}) {
  const { value, onChange, propKey, getValueSuggestions, curated, t, neutral } = props;
  const items: string[] = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const [open, setOpen] = useState(props.autoOpen ?? false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const usingCurated = curated !== undefined;
  const suggestions = usePropertyValues(open && !usingCurated, propKey, getValueSuggestions);
  const discovered = suggestions.values;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const list: CuratedOption[] = usingCurated ? curated! : discovered.map((d) => ({ value: d.value }));
  const countOf = (v: string) => (usingCurated ? undefined : discovered.find((d) => d.value === v)?.count);
  const add = (v: string) => { const t2 = v.trim(); if (t2 && !items.includes(t2)) onChange([...items, t2]); setQuery(""); };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const q = query.trim().toLowerCase();
  const matches = list.filter((o) => !items.includes(o.value) && (q === "" || (o.label ?? o.value).toLowerCase().includes(q) || o.value.toLowerCase().includes(q)));
  const canCreate = q !== "" && !list.some((o) => o.value.toLowerCase() === q) && !items.includes(query.trim());
  const popRef = useFixedPopover(open, wrapRef);

  return (
    <div className="pv-select" ref={wrapRef}>
      <div className="pv-chips" onClick={(e) => { setOpen(true); focusChipInput(e); }}>
        {items.map((it, i) => {
          const opt = findOption(curated, it);
          return (
            <span key={`${it}-${i}`} className={`${neutral ? "pv-chip pv-chip--neutral" : chipClass(it, opt?.color)} pv-chip--removable`} data-tip={opt?.label ?? it}>
              {!neutral && <span className="pv-dot" />}<span className="pv-chip-text">{opt?.label ?? it}</span>
              <button type="button" className="pv-chip-x" aria-label={t("properties.removeItem")} onClick={(e) => { e.stopPropagation(); remove(i); }}><X size={ICON.meta} /></button>
            </span>
          );
        })}
        <input className="pv-chip-input" value={query} placeholder={t("properties.addItem")}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0] || canCreate) add(matches[0]?.value ?? query); } if (e.key === "Backspace" && query === "" && items.length) remove(items.length - 1); if (e.key === "Escape") setOpen(false); }}
        />
      </div>
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          {matches.length > 0 && <div className="pv-popover-label">{t("properties.existingValues")}</div>}
          {matches.map((o) => (
            <button key={o.value} type="button" className="pv-popover-row" onMouseDown={(e) => { e.preventDefault(); add(o.value); }}>
              <span className={neutral ? "pv-chip pv-chip--neutral" : chipClass(o.value, o.color)}>{!neutral && <span className="pv-dot" />}{o.label ?? o.value}</span>
              {countOf(o.value) !== undefined && <span className="pv-popover-count">{countOf(o.value)}</span>}
            </button>
          ))}
          {!usingCurated && getValueSuggestions && !suggestions.wholeVault && <Button variant="ghost" className="pv-popover-row" onMouseDown={(e) => e.preventDefault()} onClick={suggestions.expand}>{t("properties.searchWholeVault")}</Button>}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onMouseDown={(e) => { e.preventDefault(); add(query); }}>
              <Plus size={ICON.ui} className="pv-popover-ic" /> {t("properties.createValue", { value: query.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ dispatcher */

export interface PropertyValueProps {
  type: PropertyType;
  value: any;
  propKey: string;
  onChange: (v: any) => void;
  tagSuggestions: TagSuggestion[];
  getValueSuggestions?: ValueSuggestionLoader;
  /** Curated options from the governing `.base` column schema (value/label/color/group). */
  curatedOptions?: CuratedOption[];
  getRelationCandidates?: (query: string) => Promise<RelationCandidate[]>;
  onOpenLink?: (target: string) => void;
  /** Relation cardinality from the governing `.base` schema ("one" = single link). */
  relationLimit?: "one";
  t: TFn;
  locale: string;
}

export function PropertyValue({ type, value, propKey, onChange, tagSuggestions, getValueSuggestions, curatedOptions, getRelationCandidates, onOpenLink, relationLimit, t, locale }: PropertyValueProps) {
  switch (type) {
    case "checkbox": return <CheckboxToggle value={value} onChange={onChange} label={propKey} />;
    case "number": return <NumberInput value={value} onChange={onChange} t={t} />;
    // The marks ARE the editor: a rating one can see but not set would need a
    // second renderer beside this one (plan Journal-Erweiterungen, E5).
    case "rating": return <Rating label={propKey} onChange={onChange} value={Number(value) || 0} />;
    case "date": return <DateValue value={value} onChange={onChange} includeTime={false} locale={locale} />;
    case "datetime": return <DateValue value={value} onChange={onChange} includeTime locale={locale} />;
    case "list": return <MultiSelectChips value={value} onChange={onChange} propKey={propKey} getValueSuggestions={getValueSuggestions} curated={curatedOptions} neutral t={t} />;
    case "tags": return <TagPills value={value} onChange={onChange} suggestions={tagSuggestions} t={t} />;
    case "link": return <RelationPicker value={value} onChange={onChange} getRelationCandidates={getRelationCandidates} onOpenLink={onOpenLink} relationLimit={relationLimit} t={t} />;
    case "select":
    case "status": return <SelectChip value={value} onChange={onChange} propKey={propKey} getValueSuggestions={getValueSuggestions} curated={curatedOptions} grouped={type === "status"} t={t} caret={false} />;
    case "multiselect": return <MultiSelectChips value={value} onChange={onChange} propKey={propKey} getValueSuggestions={getValueSuggestions} curated={curatedOptions} t={t} />;
    // Text in the growing field (R2): a long value wraps and stays readable
    // instead of running out of a one-line input. It is still ONE value —
    // PlainInput folds a pasted line break into a space.
    default: return <PlainInput growing selectOnFocus={false} value={value} onChange={onChange} type={type} propKey={propKey} getValueSuggestions={getValueSuggestions} curated={curatedOptions} t={t} />;
  }
}

/** What a value of this type shows in the row's edge at rest. */
const CHIP_LIST_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["list", "tags", "multiselect", "link"]);
const SELECT_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["select", "status"]);
/** Values that are a control of their own — a switch, a row of marks — get no field frame. */
const FRAMELESS_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["checkbox", "rating"]);

/* ------------------------------------------------------------------ type menu */

export function TypeMenu<T extends MenuPropertyType = PropertyType>({ current, onPick, onClose, t, query, anchorClass, groups, anchorRef }: { current?: T; onPick: (t: T) => void; onClose: () => void; t: TFn; query?: string; anchorClass?: string; groups?: { labelKey: string; types: T[] }[]; anchorRef?: React.RefObject<HTMLElement | null> }) {
  const ref = useFixedPopover(!!anchorRef, anchorRef, { minWidth: 220 });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
  const q = (query ?? "").trim().toLowerCase();
  const menuGroups = groups ?? (TYPE_GROUPS as unknown as { labelKey: string; types: T[] }[]);
  return (
    <div className={`pv-popover pv-type-menu${anchorRef ? " pv-popover--fixed" : ""}${anchorClass ? " " + anchorClass : ""}`} ref={ref}>
      {menuGroups.map((g) => {
        const types = g.types.filter((ty) => q === "" || typeLabel(t, ty).toLowerCase().includes(q));
        if (types.length === 0) return null;
        return (
          <div key={g.labelKey}>
            <div className="pv-popover-label">{t(g.labelKey)}</div>
            {types.map((ty) => {
              const Ic: React.ElementType = TYPE_ICONS[ty];
              return (
                <button key={ty} type="button" className={`pv-popover-row${ty === current ? " pv-popover-row-active" : ""}`} onClick={() => onPick(ty)}>
                  <Ic size={ICON.ui} className="pv-popover-ic" /> <span>{typeLabel(t, ty)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ row */

export interface PropertyRowProps {
  propKey: string;
  value: any;
  type: PropertyType;
  onChangeValue: (key: string, v: any) => void;
  onRename: (oldKey: string, newKey: string) => void;
  onDelete: (key: string) => void;
  onChangeType: (key: string, t: PropertyType) => void;
  tagSuggestions: TagSuggestion[];
  getValueSuggestions?: ValueSuggestionLoader;
  curatedOptions?: CuratedOption[];
  getRelationCandidates?: (query: string) => Promise<RelationCandidate[]>;
  onOpenLink?: (target: string) => void;
  relationLimit?: "one";
  /** OKF system fields (type/okf_version): name, field type and delete are fixed (P13). */
  lockMeta?: boolean;
  /**
   * What the label SHOWS for a locked row, when it is not the raw key: the
   * OKF lifecycle fields read "Veraltet ab" instead of `stale_after` — the
   * phone did this from the start, the desktop did not (2026-09-04). The file
   * keeps the key; the lock icon's tooltip names it.
   */
  displayLabel?: string;
  /** okf_version: the value is display-only as well. */
  lockValue?: boolean;
  /** Comment THREADS anchored to this property (a reply carries no anchor, so this counts threads). */
  commentCount?: number;
  /** Start a comment on this property. Absent when the workspace forbids commenting. */
  onComment?: (key: string) => void;
  t: TFn;
  locale: string;
}

export function PropertyRow(props: PropertyRowProps) {
  const { propKey, value, type, onChangeValue, onRename, onDelete, onChangeType, tagSuggestions, getValueSuggestions, curatedOptions, getRelationCandidates, onOpenLink, relationLimit, lockMeta, lockValue, displayLabel, commentCount, onComment, t, locale } = props;
  const [editKey, setEditKey] = useState(propKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setEditKey(propKey), [propKey]);
  const Icon = TYPE_ICONS[type];

  // The edge at rest: what the row is, said with one glyph. A locked row shows
  // its lock (and names the file's key in the tooltip); a select shows the
  // caret its trigger no longer draws; a chip list shows that more can be
  // added. Caret and "add" are signs, not buttons — the value beside them is
  // what is clicked, and the actions below lay over them on hover.
  const edge = lockMeta ? (
    <span className="pv-prow-lock" data-tip={t("properties.okfKeyHint", { key: propKey })}>
      <Lock size={ICON.meta} aria-hidden="true" />
    </span>
  ) : SELECT_TYPES.has(type) ? (
    <ChevronDown size={ICON.meta} aria-hidden="true" />
  ) : CHIP_LIST_TYPES.has(type) ? (
    <Plus size={ICON.meta} aria-hidden="true" />
  ) : null;

  const commentLabel = commentCount ? t("comments.commentThreadCount", { count: commentCount }) : t("comments.commentOnProperty");
  const actions = onComment || !lockMeta ? (
    <>
      {onComment && (
        <button
          type="button"
          className="pv-comment-dot"
          data-has={commentCount ? "true" : "false"}
          data-tip={commentLabel}
          aria-label={commentLabel}
          onClick={() => onComment(propKey)}
        >
          <MessageSquare size={ICON.meta} aria-hidden="true" />
          {commentCount ? <span>{commentCount}</span> : null}
        </button>
      )}
      {!lockMeta && (
        <button type="button" className="pv-del" data-tip={t("properties.deleteProperty")} aria-label={t("properties.deleteProperty")} onClick={() => onDelete(propKey)}>
          <Trash2 size={ICON.meta} />
        </button>
      )}
    </>
  ) : null;

  return (
    <PropRow
      data-prop={propKey}
      kind={type}
      // A value that cannot be changed gets no field frame; neither does a
      // control that is its own frame (switch, rating).
      frame={lockValue || FRAMELESS_TYPES.has(type) ? "none" : "quiet"}
      icon={
        <>
          <button ref={typeBtnRef} type="button" className="pv-type-btn" data-tip={lockMeta ? t("properties.okfLockedHint") : t("properties.changeType")} aria-label={lockMeta ? t("properties.okfLockedHint") : t("properties.changeType")} disabled={lockMeta} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <Icon size={ICON.ui} />
          </button>
          {menuOpen && <TypeMenu current={type} anchorRef={typeBtnRef} onPick={(ty) => { onChangeType(propKey, ty); setMenuOpen(false); }} onClose={() => setMenuOpen(false)} t={t} />}
        </>
      }
      // The name wraps instead of being cut: it is a field that grows with its
      // text. A one-line input clipped `day_of_week` at 78 px without a sign.
      name={
        <span className="pv-prow-namebox" data-tip={lockMeta ? t("properties.okfLockedHint") : undefined}>
          <GrowingField
            className="pv-key"
            value={lockMeta && displayLabel ? displayLabel : editKey}
            aria-label={t("properties.name")}
            data-key={propKey}
            disabled={lockMeta}
            spellCheck={false}
            onChange={(e) => setEditKey(asSingleLineValue(e.target.value))}
            onBlur={() => { if (editKey.trim() && editKey !== propKey) onRename(propKey, editKey.trim()); else setEditKey(propKey); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          />
        </span>
      }
      edge={edge}
      actions={actions}
      // The lock's tooltip is the only place the file's key is named once a row
      // shows a translated label, so the actions open beside it, not over it.
      keepEdge={lockMeta}
      // A count nobody has to hover for: the comment dot stays once it counts.
      actionsPinned={Boolean(commentCount)}
    >
      {lockValue ? (
        <span className="pv-prow-static" data-tip={t("properties.okfLockedHint")}>{String(value ?? "")}</span>
      ) : (
        <PropertyValue
          type={type} value={value} propKey={propKey}
          onChange={(v) => onChangeValue(propKey, v)}
          tagSuggestions={tagSuggestions} getValueSuggestions={getValueSuggestions}
          curatedOptions={curatedOptions} getRelationCandidates={getRelationCandidates} onOpenLink={onOpenLink}
          relationLimit={relationLimit}
          t={t} locale={locale}
        />
      )}
    </PropRow>
  );
}

/* ------------------------------------------------------------------ add popover */

export function AddPropertyPopover({ onAdd, onClose, t, anchorRef, source, columns, registry = {}, existing = [] }: { source?: PropertySuggestionSource | null; columns?: Record<string, { input?: string }>; registry?: Record<string, PropertyType>; existing?: string[]; onAdd: (name: string, type: PropertyType) => void; onClose: () => void; t: TFn; anchorRef?: React.RefObject<HTMLElement | null> }) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const ref = useFixedPopover(!!anchorRef, anchorRef, { minWidth: 240 });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);

  const q = query.trim().toLowerCase();
  // Name is optional: picking a type creates the property (with a default name if
  // empty) and the row's inline name field lets the user rename it right after.
  const pick = (type: PropertyType) => { onAdd(name.trim(), type); onClose(); };

  return (
    <div className={`pv-popover pv-add-popover${anchorRef ? " pv-popover--fixed" : ""}`} ref={ref}>
      <PropertyNameInput source={source} columns={columns} registry={registry} existing={existing}
        value={name} onChange={setName} onClose={onClose} onPick={(key, type) => { onAdd(key, type); onClose(); }} />
      <div className="pv-popover-search"><Search size={ICON.ui} /><input value={query} placeholder={t("properties.chooseType")} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="pv-add-types">
        {TYPE_GROUPS.map((g) => {
          const types = g.types.filter((ty) => q === "" || typeLabel(t, ty).toLowerCase().includes(q));
          if (types.length === 0) return null;
          return (
            <div key={g.labelKey}>
              <div className="pv-popover-label">{t(g.labelKey)}</div>
              {types.map((ty) => {
                const Ic = TYPE_ICONS[ty];
                return (
                  <button key={ty} type="button" className="pv-popover-row" onClick={() => pick(ty)}>
                    <Ic size={ICON.ui} className="pv-popover-ic" /> <span>{typeLabel(t, ty)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
