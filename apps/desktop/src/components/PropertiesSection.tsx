import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Check, ExternalLink, Link2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  appendVerification,
  formatActor,
  formatStampDate,
  generatedAtOf,
  getPlatformServices,
  ICON,
  parseBaseConfig, propertyIndexTypes, reservedPropertyName,
  PropActionRow,
  PropGroupHead,
  propertyPanelModel,
  PropRow,
  toast,
  TRUST_LEVEL_I18N,
  trustLevelOf,
  useKeptResolution,
} from "@plainva/ui";
import {
  parseMarkdownAst,
  extractFrontmatter,
  updateFrontmatterString,
  ReadableFrontmatter,
  OKF_STATUS_VALUES,
  sameStoredValue,
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
import { resolveGoverningBase, clearGoverningBaseCache, governingBasesBelongTo, governingBaseMemory, type GoverningBase } from "../services/baseSchema";
import { PropertyRow, AddPropertyPopover, type RelationCandidate } from "./PropertyValues";
import { parseWikiLinkValue, pathsSharingNames, stripWikiLink, wikiLinkTextFor, wikiTargetPath } from "@plainva/ui";
import { useWikiResolver } from "../hooks/useWikiResolver";
import {
  propertyCommentStore,
  usePropertyCommentCounts,
  useCanCommentOnProperties,
} from "../services/propertyComments";

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

// The OKF 0.2 provenance families (`generated`/`verified`/`sources`) render as
// the read-only trust group, never as editable rows — the editor does not
// touch them (plan decision E3), and a hand-typed stamp would be a claim, not
// a fact. Which keys those are is decided in the shared `propertyPanelModel`.

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

/**
 * One line of the trust group, in the column's row grammar (R4): it used to be
 * a third grid with a fixed 88-px label column, beside the property rows and
 * the database section's.
 */
function TrustLine({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <PropRow icon={icon} name={label}>
      <span className="pv-prow-static">{children}</span>
    </PropRow>
  );
}

/** A source entry: a web resource opens externally, everything else is text. */
function SourceLine({ source }: { source: OkfSource }) {
  const label = source.title ?? source.resource;
  const external = /^https?:\/\//i.test(source.resource);
  if (!external) {
    return <span data-tip={source.title ? source.resource : undefined}>{label}</span>;
  }
  // The label wraps like every other value of the column; the tooltip carries
  // the address when the label is a title.
  return (
    <button
      type="button"
      className="pv-linkbtn pv-prow-link"
      data-tip={source.title ? source.resource : undefined}
      onClick={() => { void getPlatformServices().openExternal(source.resource); }}
    >
      {label} <ExternalLink size={ICON.meta} aria-hidden="true" />
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
  // The link rule's lookup, as the editor draws its links with it.
  const linkLookup = useWikiResolver();
  const [doc, setDoc] = useState<ActiveDoc>(() => channel.get());
  const [properties, setProperties] = useState<ReadableFrontmatter>({});
  const [typeReg, setTypeReg] = useState<Record<string, PropertyType>>({});
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDoc(channel.get());
    return channel.subscribe(setDoc);
  }, [channel]);

  // Per-vault type registry (Obsidian-safe; lives in localStorage, not the note).
  useEffect(() => { setTypeReg(loadPropertyTypes(vaultPath)); }, [vaultPath]);

  // A re-index (e.g. after editing a `.base`) may change schemas/candidates:
  // they are looked up again. What was known about the governing database
  // stays on screen until the new answer is there (see `useKeptResolution`).
  // Another vault is another set of answers; nothing remembered applies there.
  useEffect(() => { governingBasesBelongTo(vaultPath ?? ""); clearGoverningBaseCache(); relationCandidateCache.clear(); }, [fileTreeVersion, vaultPath]);

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
        const next = values.map((value) => ({ value }));
        // An index update that changes nothing must not hand the `type` row a
        // new list: the same options keep their identity.
        if (alive) setOkfTypeOptions((prev) => (sameStoredValue(prev, next) ? prev : next));
      } catch {
        if (alive) setOkfTypeOptions((prev) => (prev.length === 0 ? prev : []));
      }
    })();
    return () => { alive = false; };
  }, [vaultPath, queryService, fileTreeVersion]);

  // Which `.base` governs this note — its column schema drives typed rendering.
  //
  // The answer is KEPT while it is looked up again (finding 2026-10-06). This
  // effect used to start with `setGoverning(null)`, and it re-runs on every
  // index update — every save, every sync cycle. Until the lookup came back, a
  // `tags` value the database declares a multi-select was drawn as tag pills,
  // then as option chips again: two renderers with two colour sources, which
  // is the flicker between two colours. Now the row keeps its rendering until
  // the new answer is there, and an equal answer changes nothing at all.
  const governingKey = doc.kind === "markdown" && doc.path ? doc.path : null;
  const resolveGoverning = useCallback(
    (path: string) => resolveGoverningBase(path, queryService, vaultAdapter),
    [queryService, vaultAdapter]
  );
  const governing: GoverningBase | null = useKeptResolution(governingKey, fileTreeVersion, resolveGoverning, governingBaseMemory);
  // The add popover belongs to the note it was opened on.
  useEffect(() => { setShowAdd(false); }, [governingKey]);

  useEffect(() => {
    if (doc.kind !== "markdown") { setProperties({}); return; }
    try {
      const ast = parseMarkdownAst(doc.content);
      const fm = extractFrontmatter(ast);
      setProperties(fm.success && fm.data ? fm.data : {});
    } catch { /* ignore parse errors while typing */ }
  }, [doc.content, doc.kind]);

  // What the panel shows, decided by the shared model — the same one the
  // section head counts with (R4), so the number and the rows cannot disagree.
  // OKF 0.2 trust signals are form-checked and total: only the families that
  // carry the spec shape leave the generic list. The `plainva` namespace (doc
  // icon, header colour) has its own UI in the editor; it is hidden from the
  // list but stays in `properties`, so apply() writes it back untouched.
  const model = useMemo(() => propertyPanelModel(properties as Record<string, unknown>), [properties]);
  const { trust, showStatusRow, showStaleRow } = model;
  const visibleKeys = model.genericKeys;

  useEffect(() => { onCountChange?.(model.shownCount); }, [model.shownCount, onCountChange]);

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
    if (Object.prototype.hasOwnProperty.call(properties, finalName) || reservedPropertyName(finalName)) return;
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
    return i < 0 ? "/" : doc.path.slice(0, i + 1);
  }, [doc.path]);

  const getValueSuggestions = useCallback(async (key: string, wholeVault = false) => {
    if (!queryService) return [];
    try { return await queryService.getDistinctPropertyValues(key, wholeVault ? undefined : folderPrefix, propertyIndexTypes(baseInputToType(governing?.columns?.[key]?.input) ?? typeReg[key] ?? inferType(normalizeFrontmatterValue(properties[key]), key))); } catch { return []; }
  }, [queryService, folderPrefix, governing, typeReg, properties]);

  // Relation candidates: from the target `.base`'s notes if the column declares one,
  // else any note in the vault. Cached per scope; filtered by the typed query.
  const relationCandidates = useCallback(async (query: string, relationBase?: string, current?: unknown): Promise<RelationCandidate[]> => {
    if (!queryService) return [];
    // The notes the value links already — by the link rule, read from this
    // note: a stored link may name its note by file name, path or title.
    const stored = Array.isArray(current) ? current : current == null || current === "" ? [] : [current];
    const linked = new Set(stored.map((v) => wikiTargetPath(parseWikiLinkValue(v)?.target ?? stripWikiLink(String(v)), linkLookup, doc.path ?? undefined)));
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
    const shown = list
      .filter((c) => c.path !== doc.path && !linked.has(c.path))
      .filter((c) => q === "" || c.title.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
      .slice(0, 30);
    // What a pick writes: the file's name, the title as the link's text where
    // it reads otherwise — a target that leads back to the picked note.
    const sharing = await pathsSharingNames(queryService, shown.map((c) => c.path)).catch(() => shown.map((c) => c.path));
    return shown.map((c) => ({ ...c, link: wikiLinkTextFor(c.path, c.title === c.path ? null : c.title, sharing) }));
  }, [queryService, vaultAdapter, doc.path, linkLookup]);

  // Relation chips open a note: resolve the wikilink target like the editor does.
  const onOpenLink = useCallback(async (target: string) => {
    if (!onOpenPath || !queryService) return;
    const search = target.split("#")[0].trim();
    try {
      const path = await queryService.resolveNotePath(search, doc.path ?? undefined);
      if (path) onOpenPath(path, false);
    } catch (e) {
      console.warn("[PropertiesSection] resolving relation link target failed", e);
    }
  }, [onOpenPath, queryService, doc.path]);

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

  // Comment dot per property row (plan Stufe E, E2). The panel is rendered by
  // the right sidebar and the peek window, never by the editor, so the counts
  // travel through a small store keyed by PATH - a peek on another note must
  // not inherit this note's numbers, and its dot must not reach the editor's
  // document. Only a key that really sits in the frontmatter gets a dot: the
  // lifecycle rows below are synthesised and may have no key at all, and an
  // anchor on a key that does not exist would be orphaned the moment it lands.
  const commentCounts = usePropertyCommentCounts(doc.path ?? "");
  const canCommentOnProps = useCanCommentOnProperties(doc.path ?? "");
  const notePath = doc.path ?? "";
  const requestComment = useCallback(
    (key: string) => { propertyCommentStore.request(notePath, key); },
    [notePath]
  );

  const trustLevel = trustLevelOf(trust);
  const generatedAt = generatedAtOf(trust);
  const actorWords = useMemo(() => ({ person: t("trust.person"), process: t("trust.process") }), [t]);
  const levelClass = trustLevel === "human-reviewed" ? " is-on" : trustLevel === "unverified" ? " pv-chip--muted" : "";

  if (doc.kind !== "markdown" || !doc.path) {
    return <p className="pv-prow-hint">{t("rightPanel.propertiesUnavailable")}</p>;
  }

  // The OKF lifecycle rows show their translated name; the key stays in the
  // file and in the lock icon's tooltip (2026-09-04, parity with the phone).
  const lockedLabel = (key: string, lockMeta: boolean): string | undefined => {
    if (!lockMeta) return undefined;
    if (key === "status") return t("trust.status");
    if (key === "stale_after") return t("trust.staleAfter");
    if (key === "okf_version") return t("trust.okfVersion");
    return undefined;
  };

  const renderRow = ({ key, value, type, curatedOptions, relationBase, relationLimit, lockMeta, lockValue }: Row) => (
    <PropertyRow
      key={key}
      propKey={key}
      displayLabel={lockedLabel(key, lockMeta)}
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
      commentCount={commentCounts.get(key)}
      onComment={canCommentOnProps && key in properties ? requestComment : undefined}
      getRelationCandidates={(q) => relationCandidates(q, relationBase, properties[key])}
      onOpenLink={onOpenLink}
      relationLimit={relationLimit}
      t={t}
      locale={locale}
    />
  );

  // One grammar from the first property to the last action (R2, R4): the rows,
  // the trust group under its own head, and what the section can do as action
  // rows at the end. Nothing here lays itself out.
  return (
    <div className="pv-props">
      {rows.length === 0 ? <p className="pv-prow-hint">{t("properties.noProperties")}</p> : rows.map(renderRow)}

      <div data-testid="okf-trust-section">
        <PropGroupHead
          icon={<ShieldCheck size={ICON.meta} aria-hidden="true" />}
          trailing={
            <span className={`pv-chip pv-chip--sm${levelClass}`} data-testid="okf-trust-level" data-level={trustLevel}>
              {t(TRUST_LEVEL_I18N[trustLevel])}
            </span>
          }
        >
          {t("trust.title")}
        </PropGroupHead>
        {generatedAt && (
          <TrustLine icon={<Sparkles size={ICON.ui} aria-hidden="true" />} label={t("trust.generated")}>
            {trust.generated ? `${formatActor(trust.generated.by, actorWords)} · ` : ""}
            {formatStampDate(generatedAt, locale)}
          </TrustLine>
        )}
        {trust.verified.map((v, i) => (
          <TrustLine key={`${v.by}-${v.at}-${i}`} icon={i === 0 ? <BadgeCheck size={ICON.ui} aria-hidden="true" /> : undefined} label={i === 0 ? t("trust.verified") : ""}>
            {formatActor(v.by, actorWords)} · {formatStampDate(v.at, locale)}
          </TrustLine>
        ))}
        {trust.sources.map((s, i) => (
          <TrustLine key={`${s.resource}-${i}`} icon={i === 0 ? <Link2 size={ICON.ui} aria-hidden="true" /> : undefined} label={i === 0 ? t("trust.sources") : ""}>
            <SourceLine source={s} />
          </TrustLine>
        ))}
        {lifecycleRows.map(renderRow)}
        <PropActionRow icon={<Check size={ICON.ui} />} testId="okf-mark-verified" onClick={() => { void markReviewed(); }}>
          {t("trust.markVerified")}
        </PropActionRow>
      </div>

      <PropActionRow icon={<Plus size={ICON.ui} />} buttonRef={addBtnRef} expanded={showAdd} onClick={() => setShowAdd((s) => !s)}>
        {t("properties.addProperty")}
      </PropActionRow>
      {showAdd && <AddPropertyPopover source={queryService} columns={governing?.columns} registry={typeReg} existing={Object.keys(properties)} onAdd={onAddProp} onClose={() => setShowAdd(false)} t={t} anchorRef={addBtnRef} />}
    </div>
  );
}
