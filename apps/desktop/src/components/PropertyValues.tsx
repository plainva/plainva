import { useEffect, useRef, useState } from "react";
import { useFixedPopover } from "./ui/useFixedPopover";
import {
  Type, Hash, CheckSquare, Calendar, Clock, List, Tag, Link2, Mail, Phone, Globe,
  CircleDot, ListChecks, ChevronsUpDown, ChevronDown, X, Plus, Trash2, Search, ExternalLink, Lock,
} from "lucide-react";
import { CustomDatePicker } from "./DatePicker";
import {
  PropertyType, tagSegments, stripWikiLink, toWikiLink, chipClass,
  formatDateValue, filterTagSuggestions, TagSuggestion, CuratedOption, groupOptions,
} from "./propertyModel";

export interface RelationCandidate { path: string; title: string; }

type TFn = (key: string, opts?: any) => string;

/**
 * The `.base` column editor shares this menu (Gesamtplan 2026-07-04, P7): its
 * vocabulary is the panel's minus the generic `link` plus `relation` (a link
 * with schema — target base, cardinality, reverse column).
 */
export type MenuPropertyType = PropertyType | "relation";

export const TYPE_ICONS: Record<MenuPropertyType, React.ElementType> = {
  text: Type, number: Hash, checkbox: CheckSquare, date: Calendar, datetime: Clock,
  list: List, tags: Tag, select: ChevronsUpDown, status: CircleDot, multiselect: ListChecks,
  url: Globe, email: Mail, phone: Phone, link: Link2, relation: Link2,
};

const TYPE_GROUPS: { labelKey: string; types: PropertyType[] }[] = [
  { labelKey: "properties.group_basic", types: ["text", "number", "checkbox", "date", "datetime"] },
  { labelKey: "properties.group_choice", types: ["select", "status", "multiselect"] },
  { labelKey: "properties.group_list", types: ["list", "tags", "link"] },
  { labelKey: "properties.group_contact", types: ["url", "email", "phone"] },
];

/** Same groups for `.base` columns — `relation` takes the generic link's slot. */
export const BASE_TYPE_GROUPS: { labelKey: string; types: MenuPropertyType[] }[] = [
  { labelKey: "properties.group_basic", types: ["text", "number", "checkbox", "date", "datetime"] },
  { labelKey: "properties.group_choice", types: ["select", "status", "multiselect"] },
  { labelKey: "properties.group_list", types: ["list", "tags", "relation"] },
  { labelKey: "properties.group_contact", types: ["url", "email", "phone"] },
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

/* ------------------------------------------------------------------ inputs */

function PlainInput({ value, onChange, type, t }: { value: any; onChange: (v: any) => void; type: PropertyType; t: TFn }) {
  const [v, setV] = useState(String(value ?? ""));
  useEffect(() => setV(String(value ?? "")), [value]);
  const commit = () => { if (v !== String(value ?? "")) onChange(v); };
  const href = type === "url" ? v : type === "email" ? `mailto:${v}` : type === "phone" ? `tel:${v}` : "";
  return (
    <div className="pv-input-wrap">
      <input
        type={type === "phone" ? "tel" : type === "email" ? "email" : "text"}
        className="pv-input"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        placeholder={t("properties.value")}
      />
      {type !== "text" && v && (
        <button type="button" className="pv-icon-btn" title={t("properties.openLink")} aria-label={t("properties.openLink")} onClick={() => openExternal(href)}>
          <ExternalLink size={13} />
        </button>
      )}
    </div>
  );
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
      type="number" className="pv-input" value={v}
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

function DateValue({ value, onChange, includeTime, t, locale }: { value: any; onChange: (v: any) => void; includeTime: boolean; t: TFn; locale: string }) {
  const [editing, setEditing] = useState(false);
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
    <button type="button" className="pv-date-display" onClick={() => setEditing(true)} title={t("properties.value")}>
      {includeTime ? <Clock size={14} /> : <Calendar size={14} />}
      <span>{formatDateValue(str, includeTime, locale)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ chips: list / tags / link */

function ChipAdder({ onAdd, placeholder }: { onAdd: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState("");
  const commit = () => { const trimmed = v.trim(); if (trimmed) { onAdd(trimmed); setV(""); } };
  return (
    <input
      className="pv-chip-input" value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
        if (e.key === "Backspace" && v === "") { /* handled by parent if desired */ }
      }}
      onBlur={commit}
    />
  );
}

function ListChips({ value, onChange, t }: { value: any; onChange: (v: any) => void; t: TFn }) {
  const items: string[] = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = (v: string) => onChange([...items, v]);
  return (
    <div className="pv-chips">
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className="pv-chip pv-chip-plain">
          <span className="pv-chip-text">{it}</span>
          <button type="button" className="pv-chip-x" aria-label={t("properties.removeItem")} onClick={() => remove(i)}><X size={12} /></button>
        </span>
      ))}
      <ChipAdder onAdd={add} placeholder={t("properties.addItem")} />
    </div>
  );
}

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
  const popRef = useFixedPopover(open && (matches.length > 0 || canCreate), wrapRef);

  return (
    <div className="pv-tags" ref={wrapRef}>
      <div className="pv-chips">
        {items.map((it, i) => {
          const target = stripWikiLink(it);
          return (
            <span key={`${it}-${i}`} className="pv-chip pv-chip-link">
              <button type="button" className="pv-chip-link-open" onClick={() => onOpenLink?.(target)} title={t("properties.openLink")}>
                <Link2 size={11} /> {target}
              </button>
              <button type="button" className="pv-chip-x" aria-label={t("properties.removeItem")} onClick={() => remove(i)}><X size={12} /></button>
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
      {open && (matches.length > 0 || canCreate) && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          {matches.length > 0 && <div className="pv-popover-label">{t("properties.linkNotes")}</div>}
          {matches.slice(0, 12).map((c) => (
            <button key={c.path} type="button" className="pv-popover-row" onMouseDown={(e) => { e.preventDefault(); add(c.title); }}>
              <Link2 size={13} className="pv-popover-ic" /> <span className="pv-chip-text">{c.title}</span>
            </button>
          ))}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onMouseDown={(e) => { e.preventDefault(); add(query.trim()); }}>
              <Plus size={13} className="pv-popover-ic" /> {t("properties.createLink", { title: query.trim() })}
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
  const popRef = useFixedPopover(open && (matches.length > 0 || canCreate), wrapRef);

  return (
    <div className="pv-tags" ref={wrapRef}>
      <div className="pv-chips">
        {items.map((tag, i) => {
          const { parent, leaf } = tagSegments(tag);
          return (
            <span key={`${tag}-${i}`} className="pv-chip pv-chip-tag" title={tag}>
              <span className="pv-chip-text">{parent && <span className="pv-tag-parent">{parent}</span>}{leaf}</span>
              <button type="button" className="pv-chip-x" aria-label={t("properties.removeTag")} onClick={() => remove(i)}><X size={12} /></button>
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
      {open && (matches.length > 0 || canCreate) && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          {matches.length > 0 && <div className="pv-popover-label">{t("properties.existingTags")}</div>}
          {matches.map((m) => {
            const { parent, leaf } = tagSegments(m.tag);
            return (
              <button key={m.tag} type="button" className="pv-popover-row" onMouseDown={(e) => { e.preventDefault(); addTag(m.tag); }}>
                <Tag size={13} className="pv-popover-ic" />
                <span className="pv-chip-text">{parent && <span className="pv-tag-parent">{parent}</span>}{leaf}</span>
                <span className="pv-popover-count">{m.count}</span>
              </button>
            );
          })}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onMouseDown={(e) => { e.preventDefault(); addTag(query); }}>
              <Plus size={13} className="pv-popover-ic" /> {t("properties.createTag", { tag: query.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ select / status / multiselect */

function useValueSuggestions(open: boolean, propKey: string, getValueSuggestions?: (key: string) => Promise<{ value: string; count: number }[]>) {
  const [opts, setOpts] = useState<{ value: string; count: number }[]>([]);
  useEffect(() => {
    let alive = true;
    if (open && getValueSuggestions) getValueSuggestions(propKey).then((r) => { if (alive) setOpts(r); }).catch(() => {});
    return () => { alive = false; };
  }, [open, propKey, getValueSuggestions]);
  return opts;
}

function SelectChip(props: {
  value: any; onChange: (v: any) => void; propKey: string;
  getValueSuggestions?: (key: string) => Promise<{ value: string; count: number }[]>;
  curated?: CuratedOption[]; grouped?: boolean; t: TFn;
}) {
  const { value, onChange, propKey, getValueSuggestions, curated, grouped, t } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const usingCurated = !!(curated && curated.length > 0);
  const discovered = useValueSuggestions(open && !usingCurated, propKey, getValueSuggestions);
  const current = value == null ? "" : String(value);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

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
      <button type="button" className="pv-select-trigger" onClick={() => setOpen((o) => !o)}>
        {current
          ? <span className={chipClass(current, currentOpt?.color)}><span className="pv-dot" />{currentOpt?.label ?? current}</span>
          : <span className="pv-placeholder">{t("properties.selectValue")}</span>}
        <ChevronDown size={14} className="pv-select-caret" />
      </button>
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          <div className="pv-popover-search"><Search size={13} /><input autoFocus value={query} placeholder={t("properties.selectValue")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (matches[0] || canCreate)) pick(matches[0]?.value ?? query.trim()); if (e.key === "Escape") setOpen(false); }} /></div>
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
              <Plus size={13} className="pv-popover-ic" /> {t("properties.createValue", { value: query.trim() })}
            </button>
          )}
          {matches.length === 0 && !canCreate && !current && <div className="pv-popover-empty">{t("properties.noValues")}</div>}
        </div>
      )}
    </div>
  );
}

function MultiSelectChips(props: {
  value: any; onChange: (v: any) => void; propKey: string;
  getValueSuggestions?: (key: string) => Promise<{ value: string; count: number }[]>;
  curated?: CuratedOption[]; t: TFn;
}) {
  const { value, onChange, propKey, getValueSuggestions, curated, t } = props;
  const items: string[] = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const usingCurated = !!(curated && curated.length > 0);
  const discovered = useValueSuggestions(open && !usingCurated, propKey, getValueSuggestions);

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
  const popRef = useFixedPopover(open && (matches.length > 0 || canCreate), wrapRef);

  return (
    <div className="pv-select" ref={wrapRef}>
      <div className="pv-chips" onClick={() => setOpen(true)}>
        {items.map((it, i) => {
          const opt = findOption(curated, it);
          return (
            <span key={`${it}-${i}`} className={chipClass(it, opt?.color)}>
              <span className="pv-dot" />{opt?.label ?? it}
              <button type="button" className="pv-chip-x" aria-label={t("properties.removeItem")} onClick={(e) => { e.stopPropagation(); remove(i); }}><X size={12} /></button>
            </span>
          );
        })}
        <input className="pv-chip-input" value={query} placeholder={t("properties.addItem")}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0] || canCreate) add(matches[0]?.value ?? query); } if (e.key === "Backspace" && query === "" && items.length) remove(items.length - 1); if (e.key === "Escape") setOpen(false); }}
        />
      </div>
      {open && (matches.length > 0 || canCreate) && (
        <div ref={popRef} className="pv-popover pv-popover--fixed">
          {matches.length > 0 && <div className="pv-popover-label">{t("properties.existingValues")}</div>}
          {matches.map((o) => (
            <button key={o.value} type="button" className="pv-popover-row" onMouseDown={(e) => { e.preventDefault(); add(o.value); }}>
              <span className={chipClass(o.value, o.color)}><span className="pv-dot" />{o.label ?? o.value}</span>
              {countOf(o.value) !== undefined && <span className="pv-popover-count">{countOf(o.value)}</span>}
            </button>
          ))}
          {canCreate && (
            <button type="button" className="pv-popover-row pv-popover-create" onMouseDown={(e) => { e.preventDefault(); add(query); }}>
              <Plus size={13} className="pv-popover-ic" /> {t("properties.createValue", { value: query.trim() })}
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
  getValueSuggestions?: (key: string) => Promise<{ value: string; count: number }[]>;
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
    case "date": return <DateValue value={value} onChange={onChange} includeTime={false} t={t} locale={locale} />;
    case "datetime": return <DateValue value={value} onChange={onChange} includeTime t={t} locale={locale} />;
    case "list": return <ListChips value={value} onChange={onChange} t={t} />;
    case "tags": return <TagPills value={value} onChange={onChange} suggestions={tagSuggestions} t={t} />;
    case "link": return <RelationPicker value={value} onChange={onChange} getRelationCandidates={getRelationCandidates} onOpenLink={onOpenLink} relationLimit={relationLimit} t={t} />;
    case "select":
    case "status": return <SelectChip value={value} onChange={onChange} propKey={propKey} getValueSuggestions={getValueSuggestions} curated={curatedOptions} grouped={type === "status"} t={t} />;
    case "multiselect": return <MultiSelectChips value={value} onChange={onChange} propKey={propKey} getValueSuggestions={getValueSuggestions} curated={curatedOptions} t={t} />;
    default: return <PlainInput value={value} onChange={onChange} type={type} t={t} />;
  }
}

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
                  <Ic size={14} className="pv-popover-ic" /> <span>{typeLabel(t, ty)}</span>
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
  getValueSuggestions?: (key: string) => Promise<{ value: string; count: number }[]>;
  curatedOptions?: CuratedOption[];
  getRelationCandidates?: (query: string) => Promise<RelationCandidate[]>;
  onOpenLink?: (target: string) => void;
  relationLimit?: "one";
  /** OKF system fields (type/okf_version): name, field type and delete are fixed (P13). */
  lockMeta?: boolean;
  /** okf_version: the value is display-only as well. */
  lockValue?: boolean;
  t: TFn;
  locale: string;
}

export function PropertyRow(props: PropertyRowProps) {
  const { propKey, value, type, onChangeValue, onRename, onDelete, onChangeType, tagSuggestions, getValueSuggestions, curatedOptions, getRelationCandidates, onOpenLink, relationLimit, lockMeta, lockValue, t, locale } = props;
  const [editKey, setEditKey] = useState(propKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setEditKey(propKey), [propKey]);
  const Icon = TYPE_ICONS[type];

  return (
    <div className="pv-row">
      <div className="pv-row-label">
        <div className="pv-key-box">
          <button ref={typeBtnRef} type="button" className="pv-type-btn" title={lockMeta ? t("properties.okfLockedHint") : t("properties.changeType")} aria-label={lockMeta ? t("properties.okfLockedHint") : t("properties.changeType")} style={lockMeta ? { cursor: "default", opacity: 0.6 } : undefined} onClick={() => { if (!lockMeta) setMenuOpen((o) => !o); }}>
            <Icon size={14} />
          </button>
          <input
            className="pv-key" value={editKey} aria-label={t("properties.name")}
            disabled={lockMeta}
            title={lockMeta ? t("properties.okfLockedHint") : undefined}
            onChange={(e) => setEditKey(e.target.value)}
            onBlur={() => { if (editKey.trim() && editKey !== propKey) onRename(propKey, editKey.trim()); else setEditKey(propKey); }}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
          {lockMeta && <Lock size={10} style={{ color: "var(--text-faint)", flexShrink: 0 }} aria-hidden="true" />}
        </div>
        {menuOpen && <TypeMenu current={type} anchorRef={typeBtnRef} onPick={(ty) => { onChangeType(propKey, ty); setMenuOpen(false); }} onClose={() => setMenuOpen(false)} t={t} />}
      </div>
      <div className="pv-row-value">
        {lockValue ? (
          <span title={t("properties.okfLockedHint")} style={{ fontSize: "0.85rem", color: "var(--text-muted)", padding: "4px 7px" }}>{String(value ?? "")}</span>
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
      </div>
      {!lockMeta && (
        <button type="button" className="pv-del" title={t("properties.deleteProperty")} aria-label={t("properties.deleteProperty")} onClick={() => onDelete(propKey)}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ add popover */

export function AddPropertyPopover({ onAdd, onClose, t, anchorRef }: { onAdd: (name: string, type: PropertyType) => void; onClose: () => void; t: TFn; anchorRef?: React.RefObject<HTMLElement | null> }) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useFixedPopover(!!anchorRef, anchorRef, { minWidth: 240 });
  useEffect(() => { inputRef.current?.focus(); }, []);
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
      <input ref={inputRef} className="pv-add-name" value={name} placeholder={t("properties.namePlaceholder")}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
      <div className="pv-popover-search"><Search size={13} /><input value={query} placeholder={t("properties.chooseType")} onChange={(e) => setQuery(e.target.value)} /></div>
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
                    <Ic size={14} className="pv-popover-ic" /> <span>{typeLabel(t, ty)}</span>
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
