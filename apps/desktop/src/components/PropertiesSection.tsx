import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  appendVerification,
  formatActor,
  formatStampDate,
  generatedAtOf,
  getPlatformServices,
  ICON,
  parseBaseConfig,
  toast,
  TRUST_LEVEL_I18N,
  trustLevelOf,
} from "@plainva/ui";
import {
  parseMarkdownAst,
  extractFrontmatter,
  updateFrontmatterString,
  ReadableFrontmatter,
  PLAINVA_NAMESPACE_KEY,
  parseOkfTrustSignals,
  OKF_STATUS_VALUES,
  type OkfSource,
} from "@plainva/core";
import { activeDocument, type ActiveDoc, type DocChannel } from "../services/activeDocument";
import { appPrompt } from "../services/appDialogs";
import { getSettingsStore } from "../services/settingsStore";
import { useVault, verifierNameKey } from "../contexts/VaultContext";
import {
  PropertyType, inferType, coerceForType, defaultValueForType, normalizeFrontmatterValue, baseInputToType, TagSuggestion, CuratedOption,
} from "@plainva/ui";
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

/** OKF 0.2 lifecycle keys (plan P3a): pinned rows with a fixed meta — the
 * value stays editable, and clearing it removes the key. */
const OKF_LIFECYCLE_KEYS = new Set(["status", "stale_after"]);

/** OKF 0.2 provenance families: shown as the read-only trust card, never as
 * editable rows — the editor does not touch `generated`/`verified`/`sources`
 * (plan decision E3), and a hand-typed stamp would be a claim, not a fact. */
const OKF_CARD_KEYS = new Set(["generated", "verified", "sources"]);

interface Row {
  key: string;
  value: unknown;
  type: PropertyType;
  curatedOptions?: CuratedOption[];
  relationBase?: string;
  relationLimit?: "one";
  lockMeta: boolean;
  lockValue: boolean;
}

/** One label/value line of the trust card. */
function TrustLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 88px) minmax(0, 1fr)", gap: "0 0.5rem", alignItems: "baseline", fontSize: "var(--text-ui)", padding: "0.1rem 0.1rem" }}>
      <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "var(--text-main)", minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

/** A source entry: a web resource opens externally, everything else is text. */
function SourceLine({ source }: { source: OkfSource }) {
  const label = source.title ?? source.resource;
  const external = /^https?:\/\//i.test(source.resource);
  if (!external) {
    return <span data-tip={source.title ? source.resource : undefined} style={{ overflowWrap: "anywhere" }}>{label}</span>;
  }
  return (
    <button
      type="button"
      className="pv-linkbtn"
      data-tip={source.title ? source.resource : undefined}
      onClick={() => { void getPlatformServices().openExternal(source.resource); }}
      style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", maxWidth: "100%" }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <ExternalLink size={ICON.meta} style={{ flexShrink: 0 }} />
    </button>
  );
}

/**
 * Right-sidebar Properties (frontmatter) editor. Reads the live document from the
 * shared activeDocument channel and writes frontmatter changes back through the
 * editor. Each property renders with a type-specific control. Per ADR 0008 the
 * stored value stays an Obsidian-native scalar/list; the "richness" comes from
 * the governing `.base` column schema (curated select/status options + colors +
 * groups, relation target) with folder-scoped discovery as the fallback.
 *
 * OKF 0.2 (plan P3a): the trust families render as a card at the end —
 * derived trust level, generated-by, verified-by list, sources — followed by
 * the two editable lifecycle rows (`status` select, `stale_after` date). The
 * derivation is the shared `parseOkfTrustSignals`: a foreign-shaped `status`
 * (a task database's `Offen`) stays an ordinary row and gets no lifecycle UI.
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

  // OKF 0.2 trust signals — form-checked, total. `claimedKeys` tells which of
  // the families actually carry the spec shape; only those leave the generic list.
  const trust = useMemo(() => parseOkfTrustSignals(properties as Record<string, unknown>), [properties]);
  const claimed = useMemo(() => new Set(trust.claimedKeys), [trust]);
  const showStatusRow = !trust.statusForeign;
  // A present-but-malformed `stale_after` stays an ordinary row: the pinned
  // date editor would otherwise show the same key twice.
  const showStaleRow = properties.stale_after === undefined || trust.staleAfter !== null;

  // The `plainva` namespace (doc icon, header color) is managed via its own UI
  // in the editor — hide it from the generic list, but keep it in `properties`
  // so apply() writes it back untouched.
  const allKeys = useMemo(
    () => Object.keys(properties).filter((k) => k !== PLAINVA_NAMESPACE_KEY),
    [properties]
  );
  const visibleKeys = useMemo(
    () => allKeys.filter((k) => {
      if (OKF_CARD_KEYS.has(k) && claimed.has(k)) return false;
      if (k === "status" && showStatusRow) return false;
      if (k === "stale_after" && showStaleRow) return false;
      return true;
    }),
    [allKeys, claimed, showStatusRow, showStaleRow]
  );

  // The header badge counts every user-facing key, the pinned lifecycle rows
  // included — a note that carries only `status: draft` must not hide the section.
  useEffect(() => { onCountChange?.(allKeys.length); }, [allKeys, onCountChange]);

  const apply = useCallback((newProps: ReadableFrontmatter) => {
    try {
      const newContent = updateFrontmatterString(doc.content, newProps);
      channel.applyFrontmatter(newContent);
    } catch (e) {
      console.error("Failed to update properties", e);
    }
  }, [doc.content, channel]);

  const commit = useCallback((next: ReadableFrontmatter) => { setProperties(next); apply(next); }, [apply]);

  // "Mark as reviewed" (OKF 0.2, plan P3b): appends `human:<name>` with the
  // current instant to the note's `verified` list. The name is asked for once
  // per vault and kept on this device (D1) — see `verifierNameKey`. This is
  // the ONE place the app writes a trust family on a person's behalf, and it
  // writes only what that person just did; `generated`/`sources` stay the
  // machine paths' business.
  const markReviewed = useCallback(async () => {
    if (doc.kind !== "markdown") return;
    const key = verifierNameKey(vaultPath ?? "");
    let name = "";
    try {
      const store = await getSettingsStore();
      name = ((await store.get<string>(key)) ?? "").trim();
      if (!name) {
        const typed = await appPrompt({
          title: t("trust.verifierPromptTitle"),
          message: t("trust.verifierPromptBody"),
          placeholder: t("trust.verifierPlaceholder"),
        });
        name = (typed ?? "").trim();
        if (!name) return;
        await store.set(key, name);
        await store.save();
      }
    } catch (e) {
      console.error("Failed to resolve the reviewer name", e);
      if (!name) return;
    }
    // Plain `{ by, at }` objects — the frontmatter value type wants shapes it
    // can serialise, not the core interface.
    const verified = appendVerification(properties.verified, name).map((v) => ({ by: v.by, at: v.at }));
    commit({ ...properties, verified });
    toast.success(t("trust.verifiedToast", { name }));
  }, [doc.kind, vaultPath, properties, commit, t]);

  const onChangeProp = useCallback((key: string, value: any) => {
    // Lifecycle rows (OKF 0.2): clearing removes the key. An empty `status:`
    // is not "stable" — it is noise in every other consumer's frontmatter.
    if (OKF_LIFECYCLE_KEYS.has(key) && (value === "" || value == null)) {
      const next = { ...properties };
      delete next[key];
      commit(next);
      return;
    }
    commit({ ...properties, [key]: value });
  }, [commit, properties]);

  const onRenameProp = useCallback((oldKey: string, newKey: string) => {
    if (OKF_SYSTEM_KEYS.has(oldKey) || OKF_LIFECYCLE_KEYS.has(oldKey)) return;
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
    if (OKF_SYSTEM_KEYS.has(key) || OKF_LIFECYCLE_KEYS.has(key)) return;
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

  const rows = useMemo<Row[]>(() => {
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

  // OKF 0.2 lifecycle rows: the status vocabulary is the spec's, labelled like
  // the badge; `stable` is the default and therefore the same as "not set".
  const statusOptions = useMemo<CuratedOption[]>(
    () => OKF_STATUS_VALUES.map((value) => ({
      value,
      label: value === "draft" ? t("docHeader.statusDraft") : value === "deprecated" ? t("docHeader.statusDeprecated") : t("trust.statusStable"),
    })),
    [t]
  );
  const lifecycleRows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (showStatusRow) list.push({ key: "status", value: trust.status ?? "", type: "select", curatedOptions: statusOptions, lockMeta: true, lockValue: false });
    if (showStaleRow) list.push({ key: "stale_after", value: trust.staleAfter ?? "", type: "date", lockMeta: true, lockValue: false });
    return list;
  }, [showStatusRow, showStaleRow, trust.status, trust.staleAfter, statusOptions]);

  const trustLevel = trustLevelOf(trust);
  const generatedAt = generatedAtOf(trust);
  const actorWords = useMemo(() => ({ person: t("trust.person"), process: t("trust.process") }), [t]);
  const levelClass = trustLevel === "human-reviewed" ? " is-on" : trustLevel === "unverified" ? " pv-chip--muted" : "";

  if (doc.kind !== "markdown" || !doc.path) {
    return (
      <div style={{ padding: "0.75rem 0.25rem", color: "var(--text-faint)", fontSize: "var(--text-ui)", fontStyle: "italic" }}>
        {t("rightPanel.propertiesUnavailable")}
      </div>
    );
  }

  const renderRow = ({ key, value, type, curatedOptions, relationBase, relationLimit, lockMeta, lockValue }: Row) => (
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
  );

  return (
    <div className="pv-props" style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      {rows.length === 0 ? (
        <div style={{ fontSize: "var(--text-ui)", color: "var(--text-faint)", fontStyle: "italic", padding: "0.25rem 0.1rem" }}>
          {t("properties.noProperties")}
        </div>
      ) : (
        rows.map(renderRow)
      )}

      <div
        data-testid="okf-trust-section"
        style={{ display: "flex", flexDirection: "column", gap: "0.15rem", marginTop: "0.45rem", paddingTop: "0.4rem", borderTop: "1px solid var(--border-color-light)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", padding: "0 0.1rem 0.15rem" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {t("trust.title")}
          </span>
          <span className={`pv-chip pv-chip--sm${levelClass}`} data-testid="okf-trust-level" data-level={trustLevel}>
            {t(TRUST_LEVEL_I18N[trustLevel])}
          </span>
        </div>
        {generatedAt && (
          <TrustLine label={t("trust.generated")}>
            {trust.generated ? `${formatActor(trust.generated.by, actorWords)} · ` : ""}
            {formatStampDate(generatedAt, locale)}
          </TrustLine>
        )}
        {trust.verified.map((v, i) => (
          <TrustLine key={`${v.by}-${v.at}-${i}`} label={i === 0 ? t("trust.verified") : ""}>
            {formatActor(v.by, actorWords)} · {formatStampDate(v.at, locale)}
          </TrustLine>
        ))}
        {trust.sources.length > 0 && (
          <TrustLine label={t("trust.sources")}>
            <span style={{ display: "flex", flexDirection: "column", gap: "0.1rem", alignItems: "flex-start" }}>
              {trust.sources.map((s, i) => <SourceLine key={`${s.resource}-${i}`} source={s} />)}
            </span>
          </TrustLine>
        )}
        {lifecycleRows.map(renderRow)}
        {doc.kind === "markdown" && (
          <div style={{ padding: "0.15rem 0.1rem 0" }}>
            <button
              type="button"
              className="pv-btn pv-btn--ghost pv-btn--sm"
              data-testid="okf-mark-verified"
              onClick={() => { void markReviewed(); }}
            >
              <Check size={ICON.ui} />
              {t("trust.markVerified")}
            </button>
          </div>
        )}
      </div>

      <div style={{ position: "relative", marginTop: "0.35rem" }}>
        <button ref={addBtnRef} type="button" className="pv-btn pv-btn--ghost pv-btn--sm" onClick={() => setShowAdd((s) => !s)}>
          <Plus size={ICON.ui} />
          {t("properties.addProperty")}
        </button>
        {showAdd && <AddPropertyPopover onAdd={onAddProp} onClose={() => setShowAdd(false)} t={t} anchorRef={addBtnRef} />}
      </div>
    </div>
  );
}
