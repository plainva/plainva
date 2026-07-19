import React, { useEffect, useRef, useState } from "react";
import { applyIndexChanges } from "../../services/fileActions";
import { CheckSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseMarkdownAst, extractFrontmatter, updateFrontmatterString, upsertFrontmatterKeys, wikiTargetForPath } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { chipClass, formatDateValue, groupOptions, ICON, inlineOptionsFrom, optionSwatch, parseWikiLinkValue, resolvePropertyWriteKey, splitMultiValue, toIsoDateTime, type CuratedOption, type DateDisplayFormat } from "@plainva/ui";
import { InlineMultiSelect, InlineRelationEditor, type RelationSearchResult } from "../BaseInlineEditors";
import { CustomDatePicker } from "../DatePicker";
import { Select, type SelectOption } from "../Select";
import { formatBytes, columnLabel as sharedColumnLabel } from "./baseViewerShared";
import { segmentInlineText, safeHref } from "@plainva/ui";
import { parseBaseConfig } from "@plainva/ui";
import { resolveNewItemTarget } from "@plainva/ui";
import { addRelationLink, removeRelationLinksToNote } from "../../services/relations";
import { buildNewNoteContent, getConfiguredNoteType } from "../../services/newNote";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";
import type { ColumnSchema, ReverseRelationDef } from "../../services/baseSchema";

// Cell layer of the BaseViewer (structural split, plan C3): typed display and
// inline editing of a row's property values, shared by every view. The hook owns
// the editing state; the render functions close over it exactly like they did in
// the single-file BaseViewer.
export function useBaseCells({
  dbConfig,
  dbData,
  setDbData,
  onOpenNote,
  dateFormat = "default",
}: {
  dbConfig: any;
  dbData: any[];
  setDbData: React.Dispatch<React.SetStateAction<any[]>>;
  /**
   * Open a note from a cell (name link, wikilink chip, inline link). The mouse
   * event travels along so the host can route Ctrl/Cmd+click into the split
   * (Base-UX2 P5); a plain click opens the peek window.
   */
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Per-view display format of date values (plan W4/P12). */
  dateFormat?: DateDisplayFormat;
}) {
  const { t, i18n } = useTranslation();
  const { vaultAdapter, queryService, vaultPath, indexer, fileTreeVersion, triggerFileTreeUpdate } = useVault();

  // Vault-wide note index for the relation editors: lowercase titles + paths
  // (broken-chip detection) and the raw path list (collision-safe link text).
  // One listNotes() per index change, never per cell/chip.
  const [noteIndex, setNoteIndex] = useState<{ titleSet: Set<string>; paths: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!queryService) { setNoteIndex(null); return; }
    queryService
      .listNotes()
      .then((notes) => {
        if (!alive) return;
        const titleSet = new Set<string>();
        const paths: string[] = [];
        for (const n of notes) {
          titleSet.add(n.title.toLowerCase());
          titleSet.add(n.path.toLowerCase());
          titleSet.add(n.path.toLowerCase().replace(/\.md$/, ""));
          paths.push(n.path);
        }
        setNoteIndex({ titleSet, paths });
      })
      .catch(() => { if (alive) setNoteIndex(null); });
    return () => { alive = false; };
  }, [queryService, fileTreeVersion]);

  // Relation candidates per target `.base`, cached until the next re-index.
  const candCacheRef = useRef<{ version: number; map: Map<string, { path: string; title: string }[]> }>({ version: -1, map: new Map() });

  // Open a note referenced by a wikilink / internal markdown link. Resolution
  // goes through the index (title or path, case-insensitive) like editor links
  // do; the naive `target + ".md"` only remains as the not-indexed fallback.
  const openNoteLink = async (target: string, ev?: React.MouseEvent) => {
    let path = /\.(md|base)$/i.test(target) ? target : `${target}.md`;
    try {
      const resolved = await queryService?.resolveNotePath(target);
      if (resolved) path = resolved;
    } catch (e) {
      console.warn("[BaseViewer] resolving a cell link failed", target, e);
    }
    onOpenNote?.(path, ev);
  };

  const [editingCell, setEditingCell] = useState<{path: string, col: string} | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Localized display label of a column (point 3), shared by every view and the
  // config panel so headers, card labels and pickers all agree.
  const columnLabel = (col: string): string => sharedColumnLabel(col, t, dbConfig);

  // The configured input type of a property column ("date" | "datetime" | "select" |
  // "number" | "checkbox" | ...), or undefined for file.* / untyped columns.
  const getColumnInput = (col: string): string | undefined => {
    if (col.startsWith('file.')) return undefined;
    const cols = dbConfig?.columns;
    if (cols && !Array.isArray(cols)) return cols[col]?.input;
    return undefined;
  };

  const getColumnOptions = (col: string): any[] => {
    const opts = dbConfig?.columns?.[col]?.options;
    return Array.isArray(opts) ? opts : [];
  };

  const getColumnSchema = (col: string): ColumnSchema | undefined => {
    const cols = dbConfig?.columns;
    if (cols && !Array.isArray(cols)) return cols[col];
    return undefined;
  };

  /** Relation cardinality of the column: "one" = single link, else unlimited. */
  const getRelationLimit = (col: string): "one" | undefined =>
    getColumnSchema(col)?.relationLimit === "one" ? "one" : undefined;

  /** Reverse-relation definition when the column is a computed reverse column. */
  const getReverseOf = (col: string): ReverseRelationDef | null => {
    const rev = getColumnSchema(col)?.reverseOf;
    return rev && rev.base && rev.property ? rev : null;
  };

  const isReverseColumn = (col: string): boolean => getReverseOf(col) !== null;

  // Options for inline select/status editing: curated options from the .base when
  // present, otherwise the distinct values actually used by the matching notes — so
  // a Status cell offers the real options instead of an empty dropdown (point 9).
  // Discovered values of option-typed columns may be comma-joined legacy strings;
  // those offer their parts as separate options (P1). Curated sets stay as authored.
  const getInlineOptions = (col: string): CuratedOption[] => {
    const curated = getColumnOptions(col) as CuratedOption[];
    const opts = inlineOptionsFrom(curated, dbData, col);
    const input = getColumnInput(col);
    if (curated.length > 0 || (input !== "select" && input !== "status" && input !== "multiselect")) return opts;
    const seen = new Set<string>();
    const split: CuratedOption[] = [];
    for (const o of opts) {
      for (const v of splitMultiValue(o.value)) {
        if (!seen.has(v)) {
          seen.add(v);
          split.push({ value: v });
        }
      }
    }
    return split;
  };

  // Coerce a freshly edited cell value to the column's type so frontmatter keeps its
  // native YAML type (a number stays a number, not a quoted string).
  const coerceValue = (col: string, value: any): any => {
    const input = getColumnInput(col);
    if (input === "number") {
      if (value === "" || value === null || value === undefined) return "";
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    if (input === "checkbox") return value === true || value === "true";
    // List/tags columns (P7) edit as comma-separated text but store a native
    // YAML list — same comma semantics as select/status/multiselect, text never.
    if (input === "list" || input === "tags") {
      if (Array.isArray(value)) return value;
      const arr = splitMultiValue(value);
      return arr.length === 0 ? "" : arr;
    }
    return value;
  };

  // Write a final value to a note's frontmatter and reflect it in dbData. Does NOT
  // close the inline editor — used by the multi-value editors (multiselect/relation)
  // that stay open so the user can add several entries.
  const commitCellValue = async (path: string, col: string, newValue: any) => {
    if (!vaultAdapter) return;
    setDbData(prev => prev.map(row => (row['file.path'] === path ? { ...row, [col]: newValue } : row)));
    try {
      const text = await vaultAdapter.readTextFile(path);
      const ast = parseMarkdownAst(text);
      const fmResult = extractFrontmatter(ast);
      const props = fmResult.success && fmResult.data ? fmResult.data : {};
      // A note may carry the property under a different CASING than the column
      // key ("Frist" vs. column "frist" — the panel capitalizes bare keys for
      // display, so both spellings occur in the wild). Update the existing key
      // in place instead of adding a duplicate second key; the query side maps
      // case-insensitively onto column keys, so the value shows either way.
      const writeKey = resolvePropertyWriteKey(props, col);
      const newProps: Record<string, any> = { ...props, [writeKey]: newValue };
      if (newValue === "" || newValue === undefined || (Array.isArray(newValue) && newValue.length === 0)) delete newProps[writeKey];
      const newText = updateFrontmatterString(text, newProps);
      await vaultAdapter.writeTextFile(path, newText);
    } catch (e) {
      console.error("Failed to update file property", e);
    }
  };

  const handleCellSave = async (path: string, col: string, rawValue: any) => {
    if (!vaultAdapter) return;
    const newValue = coerceValue(col, rawValue);
    const row = dbData.find(r => r['file.path'] === path);
    if (row && row[col] === newValue) { setEditingCell(null); return; }
    await commitCellValue(path, col, newValue);
    setEditingCell(null);
  };

  // Editing a computed reverse column writes the OWNING property in the
  // counterpart notes (never this row's frontmatter — the value here is
  // derived). Adds respect the owning side's cardinality ("Genau 1" steals,
  // like Notion); removals are resolution-based. Both sides of the edit are
  // patched in memory; the re-index refresh trues everything up.
  const reverseBusyRef = useRef(false);
  const commitReverseCellValue = async (row: any, col: string, nextArr: string[]) => {
    const rev = getReverseOf(col);
    if (!rev || !vaultAdapter || !queryService || reverseBusyRef.current) return;
    const rowPath: string = row["file.path"];
    const targetOf = (v: string) => (parseWikiLinkValue(v)?.target ?? v.replace(/^\[\[/, "").replace(/\]\]$/, "")).toLowerCase();
    const current: string[] = Array.isArray(row[col]) ? row[col].map(String) : [];
    const currentByTarget = new Map(current.map((v) => [targetOf(v), v]));
    const nextByTarget = new Map(nextArr.map((v) => [targetOf(v), v]));
    const added = [...nextByTarget.entries()].filter(([k]) => !currentByTarget.has(k));
    const removed = [...currentByTarget.entries()].filter(([k]) => !nextByTarget.has(k));
    if (added.length === 0 && removed.length === 0) return;

    reverseBusyRef.current = true;
    try {
      // The owning side's cardinality comes from the counterpart base's schema.
      let owningLimit: "one" | undefined;
      try {
        const cfg = rev.base ? parseBaseConfig(await vaultAdapter.readTextFile(rev.base)) : null;
        owningLimit = cfg?.columns?.[rev.property]?.relationLimit === "one" ? "one" : undefined;
      } catch { /* default: unlimited */ }

      const rowLinkText = noteIndex ? wikiTargetForPath(rowPath, noteIndex.paths) : String(row["file.name"] ?? rowPath);
      const changedPaths = new Map<string, "added" | "removed">();
      for (const [, rawValue] of added) {
        const target = parseWikiLinkValue(rawValue)?.target ?? rawValue.replace(/^\[\[/, "").replace(/\]\]$/, "");
        const notePath = await queryService.resolveNotePath(target);
        if (!notePath || notePath === rowPath) continue;
        await addRelationLink({ adapter: vaultAdapter, queryService, notePath, propertyKey: rev.property, targetNotePath: rowPath, limit: owningLimit });
        changedPaths.set(notePath, "added");
      }
      for (const [, rawValue] of removed) {
        const target = parseWikiLinkValue(rawValue)?.target ?? rawValue.replace(/^\[\[/, "").replace(/\]\]$/, "");
        const notePath = await queryService.resolveNotePath(target);
        if (!notePath) continue;
        await removeRelationLinksToNote({ adapter: vaultAdapter, queryService, notePath, propertyKey: rev.property, targetNotePath: rowPath });
        changedPaths.set(notePath, "removed");
      }

      // In-memory: the edited reverse cell plus visible counterpart rows'
      // owning property (self-relations show both sides in the same table).
      const rowKeys = new Set([String(row["file.name"] ?? "").toLowerCase(), rowPath.toLowerCase(), rowPath.toLowerCase().replace(/\.md$/, "")]);
      setDbData((prev) => prev.map((r) => {
        const p: string = r["file.path"];
        if (p === rowPath) return { ...r, [col]: nextArr };
        const change = changedPaths.get(p);
        if (!change) return r;
        if (change === "added") {
          const value = owningLimit === "one" ? `[[${rowLinkText}]]` : [...(Array.isArray(r[rev.property]) ? r[rev.property].map(String) : r[rev.property] ? [String(r[rev.property])] : []), `[[${rowLinkText}]]`];
          return { ...r, [rev.property]: value };
        }
        const kept = (Array.isArray(r[rev.property]) ? r[rev.property].map(String) : r[rev.property] ? [String(r[rev.property])] : []).filter((v: string) => !rowKeys.has(targetOf(v)));
        return { ...r, [rev.property]: kept.length > 0 ? kept : "" };
      }));

      // Re-index only the touched notes; the fileTreeVersion bump re-queries
      // reverse columns everywhere (Issue #9 — no full-vault scan per cell edit).
      if (changedPaths.size > 0 && indexer) {
        applyIndexChanges(indexer, { added: [...changedPaths.keys()] }).then(() => triggerFileTreeUpdate()).catch(() => {});
      }
    } finally {
      reverseBusyRef.current = false;
    }
  };

  // Candidates for the inline relation editor. When the column declares a
  // target `.base` (relationBase), only that base's notes are offered — the
  // Notion model: relation targets are members of the related database. The
  // per-base member list is cached until the next re-index. Link text is
  // collision-safe via wikiTargetForPath.
  const searchCandidatesForBase = async (q: string, basePath: string): Promise<RelationSearchResult[]> => {
    if (!queryService) return [];
    try {
      const cache = candCacheRef.current;
      if (cache.version !== fileTreeVersion) {
        cache.version = fileTreeVersion;
        cache.map.clear();
      }
      let list = cache.map.get(basePath);
      if (!list) {
        if (basePath && vaultAdapter) {
          const config = parseBaseConfig(await vaultAdapter.readTextFile(basePath));
          const data = await queryService.queryDatabaseFiles(config);
          list = data
            .map((d: any) => ({ path: String(d["file.path"] ?? ""), title: String(d["file.name"] ?? d["file.path"] ?? "") }))
            .filter((c) => c.path);
        } else {
          list = await queryService.listNotes(300);
        }
        cache.map.set(basePath, list);
      }
      const query = q.trim().toLowerCase();
      return list
        .filter((c) => query === "" || c.title.toLowerCase().includes(query))
        .slice(0, 50)
        .map((c) => ({
          ...c,
          linkTarget: noteIndex ? wikiTargetForPath(c.path, noteIndex.paths) : undefined,
        }));
    } catch (e) {
      console.warn("[BaseViewer] note search for the relation editor failed", e);
      return [];
    }
  };

  const searchRelationCandidates = (q: string, col: string): Promise<RelationSearchResult[]> =>
    searchCandidatesForBase(q, getColumnSchema(col)?.relationBase ?? "");

  // Create a missing relation target inline (Notion's "create new page"): the
  // note lands in the target base's configured storage folder (plan Base-Neu P2:
  // `newItemFolder`, else the first folder source, else the .base file's folder)
  // and inherits the base's tag sources as frontmatter so it becomes a member.
  const createRelationTarget = async (col: string, title: string): Promise<string | null> => {
    if (!vaultAdapter || !vaultPath) return null;
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-").trim();
    if (!safeTitle) return null;
    const relationBase = getColumnSchema(col)?.relationBase ?? "";
    let folder = "";
    let tags: string[] = [];
    if (relationBase) {
      const baseDir = relationBase.includes("/") ? relationBase.slice(0, relationBase.lastIndexOf("/")) : "";
      try {
        const cfg = parseBaseConfig(await vaultAdapter.readTextFile(relationBase));
        const target = resolveNewItemTarget(cfg);
        folder = target.folder ?? target.folderSources[0] ?? baseDir;
        tags = target.inheritTags;
      } catch {
        folder = baseDir;
      }
    }
    const path = (folder ? folder.replace(/\/+$/, "") + "/" : "") + safeTitle + ".md";
    try {
      await vaultAdapter.readTextFile(path);
      return safeTitle; // already exists — just link it
    } catch {
      // expected: the note does not exist yet
    }
    try {
      let content = buildNewNoteContent(await getConfiguredNoteType(vaultPath), safeTitle);
      if (tags.length > 0) content = upsertFrontmatterKeys(content, { tags });
      await vaultAdapter.writeTextFile(path, content);
      candCacheRef.current.map.clear();
      if (indexer) applyIndexChanges(indexer, { added: [path] }).then(() => {
        triggerFileTreeUpdate();
        notifyFileOps([{ type: "create", path }]);
      }).catch(() => {});
      return safeTitle;
    } catch (e) {
      console.error("[BaseViewer] creating a relation target failed", path, e);
      return null;
    }
  };

  const startEditing = (path: string, col: string, currentValue: any) => {
    if (col.startsWith('file.')) return;
    setEditingCell({ path, col });

    let strVal = "";
    if (Array.isArray(currentValue)) strVal = currentValue.join(", ");
    else if (currentValue !== undefined && currentValue !== null) strVal = String(currentValue);
    setEditValue(strVal);
  };

  // One chip path for every view (plan W4/P10): the text lives in .pv-chip-text
  // (single line + ellipsis) and the full value stays reachable via the tooltip,
  // so long values never spill out of the pill.
  const renderChip = (text: string, color?: string, key?: React.Key, onClick?: (e: React.MouseEvent) => void, neutral?: boolean, broken?: boolean) => (
    <span
      key={key}
      className={broken ? "pv-chip pv-chip-broken" : neutral ? "pv-chip pv-chip-0" : chipClass(text, color)}
      style={onClick && !broken ? { cursor: "pointer" } : undefined}
      data-tip={broken ? t("database.brokenLinkTooltip", { defaultValue: "Verlinkte Notiz existiert nicht" }) : text}
      onClick={onClick && !broken ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
    ><span className="pv-chip-text">{text}</span></span>
  );

  // Render links inside free text like the editor does (plan W4/P11):
  // [[wikilinks|alias]], [label](target) and bare URLs become clickable; other
  // text stays plain. Returns the raw string when it contains no link.
  const renderInlineString = (text: string): React.ReactNode => {
    const segments = segmentInlineText(text);
    if (!segments.some((s) => s.type !== "text")) return text;
    const linkStyle: React.CSSProperties = { color: "var(--accent-color)", textDecoration: "underline", cursor: "pointer" };
    return (
      <span>
        {segments.map((seg, i) => {
          if (seg.type === "text") return <span key={i}>{seg.text}</span>;
          if (seg.type === "url") {
            return <a key={i} href={safeHref(seg.target)} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={(e) => e.stopPropagation()}>{seg.target}</a>;
          }
          if (seg.type === "markdown") {
            const label = seg.text || seg.target;
            if (/^https?:\/\//.test(seg.target)) {
              return <a key={i} href={safeHref(seg.target)} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={(e) => e.stopPropagation()}>{label}</a>;
            }
            return <span key={i} style={linkStyle} onClick={(e) => { e.stopPropagation(); openNoteLink(decodeURIComponent(seg.target), e); }}>{label}</span>;
          }
          return <span key={i} style={linkStyle} onClick={(e) => { e.stopPropagation(); openNoteLink(seg.target, e); }}>{seg.display}</span>;
        })}
      </span>
    );
  };

  // Render select/status/multiselect/relation values as colored chips using the curated
  // `.base` colors, so every view shows typed values instead of raw text. Returns null
  // for columns that are not option/relation typed (caller falls back to generic display).
  const renderTypedDisplay = (col: string, val: any): React.ReactNode | null => {
    if (col.startsWith("file.")) return null;
    const input = getColumnInput(col);
    const opts = getColumnOptions(col);
    const colorOf = (v: string) => opts.find((o: any) => o.value === v)?.color;
    const labelOf = (v: string) => opts.find((o: any) => o.value === v)?.label ?? v;
    const toArr = (x: any): string[] => (Array.isArray(x) ? x.map(String) : x == null || x === "" ? [] : [String(x)]);

    // Select/status/multiselect are the comma-separated types (P1): a YAML list
    // AND a comma-joined legacy string both render as individual chips.
    if (input === "select" || input === "status" || input === "multiselect") {
      const arr = splitMultiValue(val);
      if (arr.length === 0) return null;
      if (arr.length === 1) return renderChip(labelOf(arr[0]), colorOf(arr[0]));
      return <span className="pv-chips">{arr.map((v, i) => renderChip(labelOf(v), colorOf(v), i))}</span>;
    }
    if (input === "relation" || input === "link" || isReverseColumn(col)) {
      const arr = toArr(val);
      return arr.length === 0 ? null : (
        <span className="pv-chips">
          {arr.map((v, i) => {
            const parsed = parseWikiLinkValue(v);
            const target = parsed?.target ?? v.replace(/^\[\[/, "").replace(/\]\]$/, "");
            const display = parsed?.display ?? target;
            const broken =
              noteIndex != null &&
              !noteIndex.titleSet.has(target.toLowerCase()) &&
              !noteIndex.titleSet.has(`${target.toLowerCase()}.md`);
            return renderChip(display, undefined, i, (e) => openNoteLink(target, e), false, broken);
          })}
        </span>
      );
    }
    return null;
  };

  const formatValueForDisplay = (val: any, col?: string) => {
    const isMissing = val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
    if (isMissing) {
      return { displayVal: <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>-</span>, isMissing: true };
    }
    const typed = col ? renderTypedDisplay(col, val) : null;
    if (typed) return { displayVal: typed, isMissing: false };

    let displayVal: React.ReactNode = val;
    const input = col ? getColumnInput(col) : undefined;
    if (col === "file.mtime") {
      const d = new Date(Number(val));
      // The mtime is a ms timestamp; route it through the same per-view date
      // format as the typed date columns (plan W4/P12).
      displayVal = isNaN(d.getTime()) ? String(val) : formatDateValue(toIsoDateTime(d), true, i18n.language, dateFormat);
    } else if (col === "file.size") {
      displayVal = formatBytes(Number(val));
    } else if (typeof val === 'boolean') {
      displayVal = val ? <CheckSquare size={ICON.ui} color="var(--accent-color)" /> : <div style={{width: 14, height: 14, border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)"}}></div>;
    } else if (input === "text" && Array.isArray(val)) {
      // Explicit text columns never split into chips (P1): a list value shows
      // as plain readable text, links inside stay clickable.
      displayVal = renderInlineString(val.map((v) => String(v)).join(", "));
    } else if ((input === "email" || input === "phone") && typeof val === "string" && val.trim() !== "") {
      // Contact types (P7): the value opens the matching handler, like the
      // markdown panel's external-link button.
      const href = input === "email" ? `mailto:${val}` : `tel:${val}`;
      displayVal = <a href={safeHref(href)} style={{ color: "var(--accent-color)", textDecoration: "underline" }} onClick={(e) => e.stopPropagation()}>{val}</a>;
    } else if (Array.isArray(val)) {
      // Generic list (tags / untyped list): show as neutral chips instead of a comma string.
      displayVal = <span className="pv-chips">{val.map((v, i) => renderChip(String(v), undefined, i, undefined, true))}</span>;
    } else if ((input === "date" || input === "datetime") && typeof val === "string") {
      displayVal = formatDateValue(val, input === "datetime", i18n.language, dateFormat);
    } else if (typeof val === 'string') {
      displayVal = renderInlineString(val);
    } else if (typeof val === 'object') {
      displayVal = JSON.stringify(val);
    }
    return { displayVal, isMissing: false };
  };

  const renderEditableCell = (row: any, col: string, val: any, displayVal: React.ReactNode) => {
    const path = row['file.path'];
    const isEditing = editingCell?.path === path && editingCell?.col === col;
    // okf_version is display-only everywhere (P7, parity with the markdown
    // panel's locked value) — the OKF write path owns that field.
    const isReadOnly = col.startsWith('file.') || col === 'okf_version';
    const input = getColumnInput(col);
    // Checkboxes toggle on click; they have no separate edit mode.
    const isCheckbox = input === 'checkbox' || typeof val === 'boolean';

    const renderEditor = () => {
      if (input === 'date' || input === 'datetime') {
        return (
          <CustomDatePicker
            value={val != null ? String(val) : ""}
            includeTime={input === 'datetime'}
            autoOpen
            onChange={(v) => handleCellSave(path, col, v)}
            onClose={() => setEditingCell(null)}
          />
        );
      }
      if (input === 'select' || input === 'status') {
        // Legacy multi-values (list / comma string) preselect their first entry;
        // picking an option writes a clean scalar (P1).
        const curVal = splitMultiValue(val)[0] ?? "";
        let options = getInlineOptions(col);
        // Keep the current value selectable even if it is not (yet) a curated option.
        if (curVal && !options.some((o) => o.value === curVal)) options = [{ value: curVal }, ...options];
        // Theme-aware custom Select instead of the native <select> (plan D2): colored
        // swatches match the chips, status options keep their groups, and the editor
        // opens on entry and leaves edit mode on dismiss (focus/blur-commit model).
        const selOptions: SelectOption[] = [{ value: "", label: "—" }];
        for (const g of groupOptions(options)) {
          for (const o of g.options) {
            selOptions.push({ value: o.value, label: o.label ?? o.value, swatch: optionSwatch(o.value, o.color), group: g.group ?? undefined });
          }
        }
        return (
          <div onClick={e => e.stopPropagation()}>
            <Select
              value={curVal}
              options={selOptions}
              ariaLabel={t("database.selectValue", { defaultValue: "Wert wählen" })}
              autoOpen
              size="sm"
              minWidth={150}
              onChange={v => handleCellSave(path, col, v)}
              onClose={() => setEditingCell(null)}
            />
          </div>
        );
      }
      if (input === 'multiselect') {
        // Comma-joined legacy strings edit as their entries; committing writes a
        // native YAML list (P1).
        return <InlineMultiSelect value={splitMultiValue(val)} options={getInlineOptions(col)} onCommit={(arr) => commitCellValue(path, col, arr)} onClose={() => setEditingCell(null)} t={t} />;
      }
      if (isReverseColumn(col)) {
        // Computed reverse column: candidates are the OWNING base's notes;
        // committing writes their owning property (never this row's frontmatter).
        const rev = getReverseOf(col)!;
        return (
          <InlineRelationEditor
            value={val}
            search={(q) => searchCandidatesForBase(q, rev.base)}
            excludeTitles={[String(row['file.name'] ?? '')]}
            brokenTitles={noteIndex?.titleSet}
            onCommit={(arr) => commitReverseCellValue(row, col, arr)}
            onClose={() => setEditingCell(null)}
            t={t}
          />
        );
      }
      if (input === 'relation' || input === 'link') {
        // Limit "one" writes a scalar link (delete-on-empty keeps working);
        // otherwise the value stays a list. The row's own note is never a
        // candidate (no self-link) and missing targets can be created inline.
        const limit = getRelationLimit(col);
        return (
          <InlineRelationEditor
            value={val}
            search={(q) => searchRelationCandidates(q, col)}
            limit={limit}
            excludeTitles={[String(row['file.name'] ?? '')]}
            brokenTitles={noteIndex?.titleSet}
            onCreateNew={(title) => createRelationTarget(col, title)}
            onCommit={(arr) => commitCellValue(path, col, limit === 'one' ? (arr[arr.length - 1] ?? '') : arr)}
            onClose={() => setEditingCell(null)}
            t={t}
          />
        );
      }
      return (
        <input
          autoFocus
          type={input === 'number' ? 'number' : 'text'}
          className="pv-field pv-field--compact"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => handleCellSave(path, col, editValue)}
          onKeyDown={e => { if (e.key === 'Enter') handleCellSave(path, col, editValue); if (e.key === 'Escape') setEditingCell(null); }}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        />
      );
    };

    return (
      <div
        onDoubleClick={(e) => { e.stopPropagation(); if (!isEditing && !isReadOnly && !isCheckbox) startEditing(path, col, val); }}
        // A single click edits (P3, Notion model): checkboxes toggle, file.*
        // stays read-only, links/chips inside stop propagation themselves.
        onClick={(e) => {
          e.stopPropagation();
          if (isEditing || isReadOnly) return;
          if (isCheckbox) { handleCellSave(path, col, !(val === true)); return; }
          startEditing(path, col, val);
        }}
        style={{ cursor: isReadOnly ? 'default' : (isCheckbox ? 'pointer' : 'text'), width: '100%', minHeight: '1.2em', overflowWrap: 'anywhere' }}
      >
        {isEditing && !isReadOnly && !isCheckbox ? (
          renderEditor()
        ) : (
          col === 'file.name' ? <span style={{ fontWeight: 500, cursor: "pointer", color: "var(--accent-color)", textDecoration: "underline" }} onClick={(e) => { e.stopPropagation(); onOpenNote?.(path, e); }}>{displayVal}</span> : displayVal
        )}
      </div>
    );
  };

  return {
    editingCell,
    columnLabel,
    getColumnInput,
    getColumnOptions,
    getColumnSchema,
    getRelationLimit,
    getReverseOf,
    isReverseColumn,
    getInlineOptions,
    renderTypedDisplay,
    formatValueForDisplay,
    renderEditableCell,
    handleCellSave,
    commitCellValue,
  };
}

// The shape views receive to render and edit cells.
export type BaseCells = ReturnType<typeof useBaseCells>;
