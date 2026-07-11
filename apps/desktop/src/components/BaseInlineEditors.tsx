import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { chipClass, optionSwatch, parseWikiLinkValue, type CuratedOption } from "@plainva/ui";
import { Select } from "./Select";

type TFn = (key: string, opts?: any) => string;

function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return ref;
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value == null || value === "") return [];
  return [String(value)];
}

/**
 * Inline multi-select editor (multiselect columns): the value stays a list; existing
 * entries show as removable chips, new ones are added from the curated/discovered
 * options or typed freely. Commits the full array on every change.
 */
export function InlineMultiSelect({ value, options, onCommit, onClose, t }: {
  value: unknown;
  options: CuratedOption[];
  onCommit: (next: string[]) => void;
  onClose: () => void;
  t: TFn;
}) {
  const ref = useDismiss(onClose);
  const [free, setFree] = useState("");
  const selected = asArray(value);
  const remaining = options.filter((o) => !selected.includes(o.value));
  const add = (v: string) => { const x = v.trim(); if (x && !selected.includes(x)) onCommit([...selected, x]); };
  const remove = (v: string) => onCommit(selected.filter((x) => x !== v));

  return (
    <div ref={ref} className="base-inline-editor" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="base-inline-chips">
        {selected.length === 0 && <span style={{ color: "var(--text-faint)", fontSize: "0.8rem" }}>—</span>}
        {selected.map((v) => {
          const o = options.find((x) => x.value === v);
          return (
            <span key={v} className={chipClass(v, o?.color)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {o?.label ?? v}
              <button type="button" onClick={() => remove(v)} aria-label={t("properties.removeItem", { defaultValue: "Entfernen" })} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}><X size={11} /></button>
            </span>
          );
        })}
      </div>
      {remaining.length > 0 && (
        <Select
          value=""
          options={[
            { value: "", label: t("database.addValue", { defaultValue: "+ Wert" }) },
            ...remaining.map((o) => ({ value: o.value, label: o.label ?? o.value, swatch: optionSwatch(o.value, o.color) })),
          ]}
          ariaLabel={t("database.addValue", { defaultValue: "Wert hinzufügen" })}
          size="sm"
          onChange={(v) => { if (v) add(v); }}
        />
      )}
      <input
        className="base-inline-input"
        value={free}
        placeholder={t("database.addValueFree", { defaultValue: "Neuer Wert…" })}
        onChange={(e) => setFree(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { add(free); setFree(""); } }}
      />
    </div>
  );
}

export interface RelationSearchResult {
  path: string;
  title: string;
  /** Collision-safe wiki target (path-qualified on duplicate basenames); falls back to the title. */
  linkTarget?: string;
}

/**
 * Inline relation editor: search the vault for notes and add them as `[[wikilinks]]`.
 * The value is kept as a list of wikilinks (removable chips). `search` is supplied by
 * the host (queries the note index, optionally scoped to a target `.base`).
 *
 * Notion parity (Gesamtplan Base-Relationen, P7): `limit: "one"` makes a pick
 * REPLACE the value and close the editor; `excludeTitles` hides the row's own
 * note (no self-link); `onCreateNew` offers creating a missing note inline;
 * `brokenTitles` renders chips whose target no longer exists as muted/inert.
 */
export function InlineRelationEditor({ value, search, onCommit, onClose, t, limit, excludeTitles, onCreateNew, brokenTitles }: {
  value: unknown;
  search: (q: string) => Promise<RelationSearchResult[]>;
  onCommit: (next: string[]) => void;
  onClose: () => void;
  t: TFn;
  /** "one" = single link: picking replaces the value and closes the editor. */
  limit?: "one";
  /** Titles never offered as candidates (case-insensitive) — the row's own note. */
  excludeTitles?: string[];
  /** Create a missing note in the target base's source folder; resolves to its title. */
  onCreateNew?: (title: string) => Promise<string | null>;
  /** Lowercase titles/paths that exist; chips outside this set render as broken. */
  brokenTitles?: ReadonlySet<string>;
}) {
  const ref = useDismiss(onClose);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RelationSearchResult[]>([]);
  const [creating, setCreating] = useState(false);
  const selected = asArray(value);

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => { search(q).then((r) => { if (live) setResults(r); }).catch(() => {}); }, 150);
    return () => { live = false; clearTimeout(id); };
  }, [q, search]);

  const displayOf = (v: string) => parseWikiLinkValue(v)?.display ?? v.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const targetOf = (v: string) => parseWikiLinkValue(v)?.target ?? v.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const isBroken = (v: string) => {
    if (!brokenTitles) return false;
    const target = targetOf(v).toLowerCase();
    return !brokenTitles.has(target) && !brokenTitles.has(`${target}.md`);
  };

  const add = (r: RelationSearchResult) => {
    const target = r.linkTarget ?? r.title;
    const link = target !== r.title ? `[[${target}|${r.title}]]` : `[[${target}]]`;
    if (limit === "one") { onCommit([link]); setQ(""); onClose(); return; }
    if (!selected.includes(link)) onCommit([...selected, link]);
    setQ("");
  };
  const remove = (v: string) => onCommit(selected.filter((x) => x !== v));

  const excluded = new Set((excludeTitles ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean));
  const selectedTargets = new Set(selected.map((v) => targetOf(v).toLowerCase()));
  const visible = results
    .filter((r) => !excluded.has(r.title.trim().toLowerCase()))
    .filter((r) => !selectedTargets.has((r.linkTarget ?? r.title).toLowerCase()) && !selectedTargets.has(r.title.toLowerCase()));
  const canCreate =
    !!onCreateNew &&
    q.trim() !== "" &&
    !excluded.has(q.trim().toLowerCase()) &&
    !visible.some((r) => r.title.trim().toLowerCase() === q.trim().toLowerCase());

  const createNew = async () => {
    if (!onCreateNew || creating) return;
    const title = q.trim();
    setCreating(true);
    try {
      const created = await onCreateNew(title);
      if (created) add({ path: "", title: created });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={ref} className="base-inline-editor" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="base-inline-chips">
        {selected.length === 0 && <span style={{ color: "var(--text-faint)", fontSize: "0.8rem" }}>—</span>}
        {selected.map((v) => {
          const broken = isBroken(v);
          return (
            <span
              key={v}
              className={broken ? "pv-chip pv-chip-broken" : "pv-chip pv-chip-1"}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              title={broken ? t("database.brokenLinkTooltip", { defaultValue: "Verlinkte Notiz existiert nicht" }) : undefined}
            >
              {displayOf(v)}
              <button type="button" onClick={() => remove(v)} aria-label={t("properties.removeItem", { defaultValue: "Entfernen" })} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}><X size={11} /></button>
            </span>
          );
        })}
      </div>
      <input autoFocus className="base-inline-input" value={q} placeholder={t("database.searchNotes", { defaultValue: "Notiz suchen…" })} onChange={(e) => setQ(e.target.value)} />
      <div className="base-inline-results">
        {visible.slice(0, 8).map((r) => (
          <button type="button" key={r.path || r.title} className="base-inline-result" onClick={() => add(r)}>{r.title}</button>
        ))}
        {canCreate && (
          <button type="button" className="base-inline-result base-inline-create" disabled={creating} onClick={createNew}>
            <Plus size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {t("database.createNoteOption", { title: q.trim(), defaultValue: `Neue Notiz „${q.trim()}" anlegen` })}
          </button>
        )}
        {visible.length === 0 && !canCreate && <div style={{ padding: "4px 6px", color: "var(--text-faint)", fontSize: "0.8rem" }}>{t("database.noNotesFound", { defaultValue: "Keine Treffer" })}</div>}
      </div>
    </div>
  );
}
