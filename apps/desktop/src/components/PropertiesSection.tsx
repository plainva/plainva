import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseBaseConfig } from "../services/baseFormat";
import { parseMarkdownAst, extractFrontmatter, updateFrontmatterString, ReadableFrontmatter, PLAINVA_NAMESPACE_KEY } from "@plainva/core";
import { activeDocument, type ActiveDoc, type DocChannel } from "../services/activeDocument";
import { useVault } from "../contexts/VaultContext";
import {
  PropertyType, inferType, coerceForType, defaultValueForType, normalizeFrontmatterValue, baseInputToType, TagSuggestion, CuratedOption,
} from "./propertyModel";
import { getConfiguredNoteType, getConfiguredDailyNoteType } from "../services/newNote";
import { loadPropertyTypes, setPropertyType, clearPropertyType, renamePropertyType } from "./propertyTypeStore";
import { resolveGoverningBase, clearGoverningBaseCache, type GoverningBase } from "../services/baseSchema";
import { PropertyRow, AddPropertyPopover, type RelationCandidate } from "./PropertyValues";

interface PropertiesSectionProps {
  /** Reports the number of frontmatter keys (for the section header badge). */
  onCountChange?: (count: number) => void;
  /** Open a note from a relation (link) chip. */
  onOpenPath?: (path: string, newTab?: boolean) => void;
  /** Live-document channel to bind to; defaults to the global one. A floating
   * peek passes its own so its inline Properties reflect the peek note. */
  channel?: DocChannel;
}

/** Relation candidate lists keyed by target base path (or "__all__"); cleared on vault/index change. */
const relationCandidateCache = new Map<string, RelationCandidate[]>();

/** OKF system fields (P13): name/field type/delete are fixed; `type`'s value
 * stays editable (dropdown of known types), `okf_version` is display-only. */
const OKF_SYSTEM_KEYS = new Set(["type", "okf_version"]);

/**
 * Right-sidebar Properties (frontmatter) editor. Reads the live document from the
 * shared activeDocument channel and writes frontmatter changes back through the
 * editor. Each property renders with a type-specific control. Per ADR 0008 the
 * stored value stays an Obsidian-native scalar/list; the "richness" comes from
 * the governing `.base` column schema (curated select/status options + colors +
 * groups, relation target) with folder-scoped discovery as the fallback.
 */
export function PropertiesSection({ onCountChange, onOpenPath, channel = activeDocument }: PropertiesSectionProps) {
  const { t, i18n } = useTranslation();
  const { queryService, vaultAdapter, vaultPath, fileTreeVersion } = useVault();
  const [doc, setDoc] = useState<ActiveDoc>(() => channel.get());
  const [properties, setProperties] = useState<ReadableFrontmatter>({});
  const [typeReg, setTypeReg] = useState<Record<string, PropertyType>>({});
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [governing, setGoverning] = useState<GoverningBase | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDoc(channel.get());
    return channel.subscribe(setDoc);
  }, [channel]);

  // Per-vault type registry (Obsidian-safe; lives in localStorage, not the note).
  useEffect(() => { setTypeReg(loadPropertyTypes(vaultPath)); }, [vaultPath]);

  // A re-index (e.g. after editing a `.base`) may change schemas/candidates — drop caches.
  useEffect(() => { clearGoverningBaseCache(); relationCandidateCache.clear(); }, [fileTreeVersion, vaultPath]);

  // Vault-wide tags for the tag-pill autocomplete (loaded once per vault).
  useEffect(() => {
    let alive = true;
    if (queryService) queryService.getAllTags().then((rows) => { if (alive) setTagSuggestions(rows); }).catch((e) => { console.warn("[PropertiesSection] loading tag suggestions failed", e); });
    else setTagSuggestions([]);
    return () => { alive = false; };
  }, [queryService, vaultPath]);

  // Known `type` values for the locked system row's dropdown: the two
  // configured defaults plus every value already used in the vault.
  const [okfTypeOptions, setOkfTypeOptions] = useState<CuratedOption[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const configured = [
          await getConfiguredNoteType(vaultPath ?? ""),
          await getConfiguredDailyNoteType(vaultPath ?? ""),
        ];
        const used = queryService ? await queryService.getDistinctPropertyValues("type", "") : [];
        const values = [...new Set([...configured, ...used.map((u) => String(u.value))])].filter(Boolean);
        if (alive) setOkfTypeOptions(values.map((value) => ({ value })));
      } catch {
        if (alive) setOkfTypeOptions([]);
      }
    })();
    return () => { alive = false; };
  }, [vaultPath, queryService, fileTreeVersion]);

  // Resolve which `.base` governs this note (its column schema drives typed rendering).
  useEffect(() => {
    let alive = true;
    if (doc.kind === "markdown" && doc.path) {
      resolveGoverningBase(doc.path, queryService, vaultAdapter).then((g) => { if (alive) setGoverning(g); }).catch((e) => { console.warn("[PropertiesSection] resolving governing .base failed", e); if (alive) setGoverning(null); });
    } else {
      setGoverning(null);
    }
    return () => { alive = false; };
  }, [doc.path, doc.kind, queryService, vaultAdapter, fileTreeVersion]);

  useEffect(() => {
    if (doc.kind !== "markdown") { setProperties({}); return; }
    try {
      const ast = parseMarkdownAst(doc.content);
      const fm = extractFrontmatter(ast);
      setProperties(fm.success && fm.data ? fm.data : {});
    } catch { /* ignore parse errors while typing */ }
  }, [doc.content, doc.kind]);

  // The `plainva` namespace (doc icon, header color) is managed via its own UI
  // in the editor — hide it from the generic list, but keep it in `properties`
  // so apply() writes it back untouched.
  const visibleKeys = useMemo(
    () => Object.keys(properties).filter((k) => k !== PLAINVA_NAMESPACE_KEY),
    [properties]
  );

  useEffect(() => { onCountChange?.(visibleKeys.length); }, [visibleKeys, onCountChange]);

  const apply = useCallback((newProps: ReadableFrontmatter) => {
    try {
      const newContent = updateFrontmatterString(doc.content, newProps);
      channel.applyFrontmatter(newContent);
    } catch (e) {
      console.error("Failed to update properties", e);
    }
  }, [doc.content, channel]);

  const commit = useCallback((next: ReadableFrontmatter) => { setProperties(next); apply(next); }, [apply]);

  const onChangeProp = useCallback((key: string, value: any) => {
    commit({ ...properties, [key]: value });
  }, [commit, properties]);

  const onRenameProp = useCallback((oldKey: string, newKey: string) => {
    if (OKF_SYSTEM_KEYS.has(oldKey)) return;
    if (oldKey === newKey || !newKey.trim() || properties[newKey] !== undefined) return;
    const next: ReadableFrontmatter = {};
    for (const [k, v] of Object.entries(properties)) next[k === oldKey ? newKey : k] = v;
    renamePropertyType(vaultPath, oldKey, newKey);
    setTypeReg(loadPropertyTypes(vaultPath));
    commit(next);
  }, [commit, properties, vaultPath]);

  const onDeleteProp = useCallback((key: string) => {
    if (OKF_SYSTEM_KEYS.has(key)) return;
    const next = { ...properties };
    delete next[key];
    clearPropertyType(vaultPath, key);
    setTypeReg(loadPropertyTypes(vaultPath));
    commit(next);
  }, [commit, properties, vaultPath]);

  const onAddProp = useCallback((name: string, type: PropertyType) => {
    // Name is optional in the popover — fall back to a unique default the user can rename inline.
    let finalName = name.trim();
    if (!finalName) {
      const base = t("properties.untitled");
      finalName = base;
      let n = 2;
      while (properties[finalName] !== undefined) finalName = `${base} ${n++}`;
    }
    if (properties[finalName] !== undefined) return;
    setPropertyType(vaultPath, finalName, type);
    setTypeReg(loadPropertyTypes(vaultPath));
    commit({ ...properties, [finalName]: defaultValueForType(type) as any });
  }, [commit, properties, vaultPath, t]);

  const onChangeType = useCallback((key: string, type: PropertyType) => {
    if (OKF_SYSTEM_KEYS.has(key)) return;
    setPropertyType(vaultPath, key, type);
    setTypeReg(loadPropertyTypes(vaultPath));
    commit({ ...properties, [key]: coerceForType(normalizeFrontmatterValue(properties[key]), type) as any });
  }, [commit, properties, vaultPath]);

  // Folder of the active note — scopes select/status discovery so a generic key
  // like `status` reused across note types does not mix vocabularies (ADR 0008).
  const folderPrefix = useMemo(() => {
    if (!doc.path) return "";
    const i = doc.path.lastIndexOf("/");
    return i < 0 ? "" : doc.path.slice(0, i + 1);
  }, [doc.path]);

  const getValueSuggestions = useCallback(async (key: string) => {
    if (!queryService) return [];
    try { return await queryService.getDistinctPropertyValues(key, folderPrefix); } catch { return []; }
  }, [queryService, folderPrefix]);

  // Relation candidates: from the target `.base`'s notes if the column declares one,
  // else any note in the vault. Cached per scope; filtered by the typed query.
  const relationCandidates = useCallback(async (query: string, relationBase?: string): Promise<RelationCandidate[]> => {
    if (!queryService) return [];
    const cacheKey = relationBase || "__all__";
    let list = relationCandidateCache.get(cacheKey);
    if (!list) {
      try {
        if (relationBase && vaultAdapter) {
          const text = await vaultAdapter.readTextFile(relationBase);
          const config = parseBaseConfig(text);
          const data = await queryService.queryDatabaseFiles(config);
          list = data.map((d: any) => ({ path: d["file.path"], title: d["file.name"] ?? d["file.path"] }));
        } else {
          list = await queryService.listNotes();
        }
        list = (list || []).filter((c) => c.path);
      } catch (e) {
        console.warn("[PropertiesSection] loading relation candidates failed", e);
        list = [];
      }
      relationCandidateCache.set(cacheKey, list);
    }
    const q = query.trim().toLowerCase();
    return list
      .filter((c) => c.path !== doc.path)
      .filter((c) => q === "" || c.title.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
      .slice(0, 30);
  }, [queryService, vaultAdapter, doc.path]);

  // Relation chips open a note: resolve the wikilink target like the editor does.
  const onOpenLink = useCallback(async (target: string) => {
    if (!onOpenPath || !queryService) return;
    const search = target.split("#")[0].trim();
    try {
      const path = await queryService.resolveNotePath(search);
      if (path) onOpenPath(path, false);
    } catch (e) {
      console.warn("[PropertiesSection] resolving relation link target failed", e);
    }
  }, [onOpenPath, queryService]);

  const locale = i18n.language || "de";

  const rows = useMemo(() => {
    return visibleKeys.map((key) => {
      const raw = normalizeFrontmatterValue(properties[key]);
      // OKF system fields (P13): meta locked; `type` value editable via dropdown,
      // `okf_version` display-only.
      if (key === "type") {
        const current = raw == null ? "" : String(raw);
        const options = current === "" || okfTypeOptions.some((o) => o.value === current)
          ? okfTypeOptions
          : [{ value: current }, ...okfTypeOptions];
        return { key, value: raw, type: "select" as PropertyType, curatedOptions: options, relationBase: undefined, relationLimit: undefined, lockMeta: true, lockValue: false };
      }
      if (key === "okf_version") {
        return { key, value: raw, type: "text" as PropertyType, curatedOptions: undefined, relationBase: undefined, relationLimit: undefined, lockMeta: true, lockValue: true };
      }
      const schema = governing?.columns?.[key];
      // A `.base`-declared input wins over the local registry, which wins over inference.
      const type: PropertyType = baseInputToType(schema?.input) ?? typeReg[key] ?? inferType(raw, key);
      return { key, value: raw, type, curatedOptions: schema?.options, relationBase: schema?.relationBase, relationLimit: schema?.relationLimit, lockMeta: false, lockValue: false };
    });
  }, [visibleKeys, properties, typeReg, governing, okfTypeOptions]);

  if (doc.kind !== "markdown" || !doc.path) {
    return (
      <div style={{ padding: "0.75rem 0.25rem", color: "var(--text-faint)", fontSize: "0.82rem", fontStyle: "italic" }}>
        {t("rightPanel.propertiesUnavailable")}
      </div>
    );
  }

  return (
    <div className="pv-props" style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      {rows.length === 0 ? (
        <div style={{ fontSize: "0.82rem", color: "var(--text-faint)", fontStyle: "italic", padding: "0.25rem 0.1rem" }}>
          {t("properties.noProperties")}
        </div>
      ) : (
        rows.map(({ key, value, type, curatedOptions, relationBase, relationLimit, lockMeta, lockValue }) => (
          <PropertyRow
            key={key}
            propKey={key}
            value={value}
            type={type}
            onChangeValue={onChangeProp}
            onRename={onRenameProp}
            onDelete={onDeleteProp}
            onChangeType={onChangeType}
            tagSuggestions={tagSuggestions}
            getValueSuggestions={getValueSuggestions}
            curatedOptions={curatedOptions}
            lockMeta={lockMeta}
            lockValue={lockValue}
            getRelationCandidates={(q) => relationCandidates(q, relationBase)}
            onOpenLink={onOpenLink}
            relationLimit={relationLimit}
            t={t}
            locale={locale}
          />
        ))
      )}

      <div style={{ position: "relative", marginTop: "0.35rem" }}>
        <button ref={addBtnRef} type="button" className="pv-add-btn" onClick={() => setShowAdd((s) => !s)}>
          <Plus size={14} />
          {t("properties.addProperty")}
        </button>
        {showAdd && <AddPropertyPopover onAdd={onAddProp} onClose={() => setShowAdd(false)} t={t} anchorRef={addBtnRef} />}
      </div>
    </div>
  );
}
