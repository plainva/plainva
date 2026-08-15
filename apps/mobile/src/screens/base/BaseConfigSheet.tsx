import { useEffect, useState } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Copy, Folder, Hash, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { mConfirm, mPrompt, mSelect } from "../../services/mobileDialogs";
import { getMobileSettings } from "../../services/mobileSettings";
import { listPimAccounts, pimTaskListRuntime } from "../../services/pim/pimService";
import { FolderPickerSheet } from "../../components/FolderPickerSheet";
import type { MobileVault } from "../../services/vaultService";
import { addContextFilter, addGroupWithRule, addRuleToGroup, addTopFilterRule, parsePropertyFilter, parseSourceClause, resolveTaskCompletionModel, resolveTaskListName, taskListPickerOptions, BASE_CONFIG_AREAS, BASE_VIEW_TYPES, baseConfigArea, baseViewTypeMeta, buildSourceClause, buildUIFilterModel, Button, Chip, columnsForBaseSelector, type FilterEntryRef, type FilterOp, getContextFilters, ICON, IconButton, isSourceCondition, isValidNewPropertyName, listTemplates, moveTopFilterEntries, enableSubItemsConfig, noteDisplayName, toast, type PropertyFilterRule, removeContextFilter, removeFilterEntry, removeGroupRule, SectionLabel, serializePropertyFilter, setGroupLogic, Switch, TextInput, type UIGroupItem, updateGroupRule, updateTopFilterRule } from "@plainva/ui";

/**
 * Per-view configuration sheet (R4.4, E6 "desktop-oriented"): view management
 * (add/rename/delete/type), visible columns + order, sort rules, simple
 * property filter rules (AND list; nested groups from the desktop are kept
 * untouched), board grouping and calendar/timeline date fields. Every change
 * goes through the caller's mutate() which serializes via the shared
 * baseFormat contract.
 */

/**
 * The view types come from the SHARED catalog since S22 — the phone used to
 * carry its own list of seven, which is exactly how `graph` ended up being a
 * type the phone could render but never choose.
 */
const VIEW_TYPES = BASE_VIEW_TYPES.map((v) => v.type);
const FILTER_OPS: FilterOp[] = ["==", "!=", "contains", "notContains", ">", "<", ">=", "<=", "empty", "notEmpty"];
/**
 * Authoring vocabulary for fresh properties. `relation` joined it in S21, when
 * the phone gained the three controls a relation actually needs; leaving it out
 * would mean a new relation still had to start on the desktop.
 */
const NEW_PROPERTY_TYPES = [
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "select",
  "status",
  "multiselect",
  "list",
  "tags",
  "relation",
  "url",
  "email",
  "phone",
] as const;
const DATE_FORMATS = ["default", "long", "iso", "relative"] as const;

export function BaseConfigSheet({
  basePath,
  config,
  viewIndex,
  columnsPool,
  columnLabel,
  vault,
  onMutate,
  onSelectView,
  onEditProperty,
  onClose,
}: {
  /** The base's own path — a sub-items relation points at itself. */
  basePath: string;
  config: any;
  viewIndex: number;
  /** Every known property (schema + observed), bare names without file.*. */
  columnsPool: string[];
  columnLabel: (col: string) => string;
  vault: MobileVault;
  /** Clone-mutate-save: the callback owns persistence + re-query. */
  onMutate: (mutate: (cfg: any) => void) => void;
  onSelectView: (idx: number) => void;
  /** Opens the property schema sheet (E3). */
  onEditProperty: (col: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  const view = views[viewIndex] ?? {};
  const [newFilterCol, setNewFilterCol] = useState("");

  // ── "This note" filters (S23) ─────────────────────────────────────────────
  // Any wiki-link-storing property can carry one — not just relations to the
  // host's base, which is what the automatic embed scope covers.
  const contextFilters = getContextFilters(config);
  const wikiLinkColumns = Object.entries((config?.columns ?? {}) as Record<string, any>)
    .filter(([, c]) => c && typeof c === "object" && (c.input === "relation" || c.input === "link" || c.reverseOf))
    .map(([k]) => k);

  // ── New entries: storage folder + template (S23) ──────────────────────────
  const newItemFolder: string = typeof config?.newItemFolder === "string" ? config.newItemFolder : "";
  const newItemTemplate: string = typeof config?.newItemTemplate === "string" ? config.newItemTemplate : "";
  const [pickItemFolder, setPickItemFolder] = useState(false);
  /**
   * The provider list row's state (C4, S17): `null` = do not show the row at
   * all (not a task database, or no account offers a list), `""` = shown with
   * nothing chosen, otherwise the chosen list's name. Resolved through the
   * shared rule, so a list that has since disappeared reads as "none" rather
   * than showing a raw stored key — the calendar picker's finding from July.
   */
  const [taskListName, setTaskListName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const rt = pimTaskListRuntime();
      // Same gate as the desktop: a task list belongs to a TASK database.
      if (!rt || !resolveTaskCompletionModel(config)) {
        if (alive) setTaskListName(null);
        return;
      }
      const [accounts, lists] = await Promise.all([rt.listAccounts(), rt.listTaskLists()]);
      const enabled = new Set(accounts.filter((a) => a.enabled !== false).map((a) => a.id));
      const usable = (lists as ReadonlyArray<{ id: string; accountId: string; name?: string }>).filter((l) =>
        enabled.has(l.accountId)
      );
      if (!alive) return;
      setTaskListName(usable.length === 0 ? null : (resolveTaskListName(config, usable) ?? ""));
    })();
    return () => {
      alive = false;
    };
  }, [config]);
  const pickTemplate = () => {
    void (async () => {
      const templates = await listTemplates(vault.files, getMobileSettings().templateFolder);
      const picked = await mSelect({
        title: t("database.templatesSection"),
        options: [
          { value: "", label: t("database.noTemplate") },
          ...templates.map((tp) => ({ value: tp.path, label: tp.title })),
        ],
      });
      if (picked === null) return;
      onMutate((cfg) => {
        if (picked) cfg.newItemTemplate = picked;
        else delete cfg.newItemTemplate;
      });
    })();
  };

  /**
   * The provider list this database's new tasks also go to (C4, S17). The row
   * only appears where the desktop shows it too: a task database, with an
   * account that actually offers a list — a picker over nothing is not a
   * choice. The rule that reads the stored key is the shared one, so a list
   * that is gone reads as "none" here and at creation time alike.
   */
  const pickTaskList = () => {
    void (async () => {
      const rt = pimTaskListRuntime();
      if (!rt) return;
      const [accounts, lists] = await Promise.all([rt.listAccounts(), rt.listTaskLists()]);
      const enabled = new Set(accounts.filter((a) => a.enabled !== false).map((a) => a.id));
      const usable = (lists as ReadonlyArray<{ id: string; accountId: string; name?: string }>).filter((l) =>
        enabled.has(l.accountId)
      );
      const labels = new Map(
        (await listPimAccounts()).map((a) => [a.id, a.label?.trim() || a.provider] as const)
      );
      const picked = await mSelect({
        title: t("tasks.alsoCreateIn"),
        options: [
          { value: "", label: t("tasks.noProviderList") },
          ...taskListPickerOptions(
            usable.map((l) => ({ id: l.id, name: l.name ?? l.id, accountId: l.accountId })),
            labels,
            new Set(usable.map((l) => l.accountId)).size > 1
          ),
        ],
      });
      if (picked === null) return;
      onMutate((cfg) => {
        if (picked) cfg.taskList = picked;
        else delete cfg.taskList;
      });
    })();
  };

  // ── Sub-items (S22) ───────────────────────────────────────────────────────
  // The nesting key is per view, the column pair is database-wide — turning it
  // on therefore writes both, exactly as the desktop does through the shared
  // `enableSubItemsConfig`.
  const subItemsProperty: string | null =
    typeof view.subItemsProperty === "string" && view.subItemsProperty ? view.subItemsProperty : null;
  const selfRelationColumns: string[] = Object.entries((config?.columns ?? {}) as Record<string, any>)
    .filter(([, c]) => c && typeof c === "object" && c.input === "relation" && !c.reverseOf && c.relationBase === basePath)
    .map(([k]) => k);
  const enableSubItems = () =>
    onMutate((cfg) => {
      const { config: withCols, parentProperty } = enableSubItemsConfig(cfg, basePath, {
        parentItem: t("database.parentItem"),
        subItems: t("database.subItems"),
      });
      Object.assign(cfg, withCols);
      // The key changes on ALL views: the hierarchy is a property of the
      // database, not of one way of looking at it (desktop rule).
      if (Array.isArray(cfg.views)) cfg.views = cfg.views.map((v: any) => ({ ...v, subItemsProperty: parentProperty }));
    });
  const setSubItemsProperty = (col: string | null) =>
    onMutate((cfg) => {
      if (!Array.isArray(cfg.views)) return;
      cfg.views = cfg.views.map((v: any) => {
        const next = { ...v };
        if (col) next.subItemsProperty = col;
        else delete next.subItemsProperty;
        return next;
      });
    });
  // Pre-selected top logic while the view has no filter yet (desktop pattern).
  const [emptyLogic, setEmptyLogic] = useState<"all" | "any">("all");
  // Data-source editing (R3.7): folder/tag clauses in filters.and/or —
  // identical contract to the desktop's source editor (base-global).
  const [pickSourceFolder, setPickSourceFolder] = useState<"and" | "or" | null>(null);
  // Master-detail (config redesign P6): null = the area master list, otherwise
  // the open detail area. "views" is the mobile-only view-management area (the
  // desktop keeps that in the view tab strip); the rest mirror the desktop tabs.
  const [activeArea, setActiveArea] = useState<string | null>(null);

  const sourceList = (logic: "and" | "or"): any[] =>
    Array.isArray(config?.filters?.[logic]) ? config.filters[logic] : [];
  const sourcesOf = (logic: "and" | "or") =>
    sourceList(logic)
      .map((clause, idx) => ({ clause, idx }))
      .filter((c): c is { clause: string; idx: number } => isSourceCondition(c.clause));

  const addSource = (logic: "and" | "or", clause: string) =>
    onMutate((cfg) => {
      if (!cfg.filters) cfg.filters = {};
      if (!Array.isArray(cfg.filters[logic])) cfg.filters[logic] = [];
      if (!cfg.filters[logic].includes(clause)) cfg.filters[logic].push(clause);
    });

  const removeSourceAt = (logic: "and" | "or", idx: number) =>
    onMutate((cfg) => {
      cfg.filters[logic].splice(idx, 1);
    });

  const addTagSource = (logic: "and" | "or") => {
    void (async () => {
      const rows = vault.queryService ? await vault.queryService.getAllTags() : [];
      const tags = rows.map((r: { tag: string }) => r.tag);
      if (tags.length === 0) return;
      const picked = await mSelect({
        title: t("database.tag"),
        options: tags.map((tag: string) => ({ value: tag, label: `#${tag}` })),
      });
      if (picked !== null) addSource(logic, buildSourceClause("tag", picked));
    })();
  };

  const viewTypeLabel = (type: string) => t(baseViewTypeMeta(type).labelKey);

  const order: string[] = Array.isArray(view.order)
    ? view.order.map((c: string) => c.replace(/^note\./, ""))
    : [];
  const shown = order.filter((c) => !c.startsWith("file."));
  const hidden = columnsPool.filter((c) => !shown.includes(c));

  const mutateView = (fn: (v: any) => void) =>
    onMutate((cfg) => {
      const target = cfg.views[viewIndex];
      if (target) fn(target);
    });

  const setOrder = (next: string[]) =>
    mutateView((v) => {
      v.order = ["file.name", ...next];
    });

  const moveColumn = (col: string, delta: -1 | 1) => {
    const idx = shown.indexOf(col);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= shown.length) return;
    const next = [...shown];
    next.splice(idx, 1);
    next.splice(to, 0, col);
    setOrder(next);
  };

  const sortRules: Array<{ property: string; direction: string }> = Array.isArray(view.sort)
    ? view.sort
    : [];
  // The shared query sorts file.* columns too (desktop parity, E2).
  const sortableColumns = ["file.name", "file.mtime", "file.size", ...columnsPool];
  const sortLabel = (col: string) =>
    col === "file.name"
      ? t("database.colFileName")
      : col === "file.mtime"
        ? t("database.colModified")
        : col === "file.size"
          ? t("database.colSize")
          : columnLabel(col.replace(/^note\./, ""));
  const moveSortRule = (idx: number, delta: -1 | 1) => {
    const to = idx + delta;
    if (to < 0 || to >= sortRules.length) return;
    mutateView((v) => {
      const [moved] = v.sort.splice(idx, 1);
      v.sort.splice(to, 0, moved);
    });
  };

  const filterModel = buildUIFilterModel(view);
  const filterLogic: "all" | "any" = filterModel.hasEntries ? filterModel.topLogic : emptyLogic;
  const setFilterLogic = (to: "all" | "any") => {
    if (filterModel.hasEntries) {
      mutateView((v) => {
        Object.assign(v, moveTopFilterEntries(v, to));
      });
    } else setEmptyLogic(to);
  };
  const simpleRules = filterModel.entries.filter((e) => e.kind === "rule") as Array<{
    kind: "rule";
    ref: FilterEntryRef;
    rule: PropertyFilterRule;
  }>;
  const groupEntries = filterModel.entries.filter((e) => e.kind === "group") as Array<{
    kind: "group";
    ref: FilterEntryRef;
    logic: "all" | "any";
    items: UIGroupItem[];
  }>;
  const leftoverEntries = filterModel.entries.filter(
    (e) => e.kind === "rawString" || e.kind === "opaque",
  );

  const addGroup = () => {
    void (async () => {
      const col = await mSelect({
        title: t("database.filterGroup"),
        options: columnsPool.map((c) => ({ value: c, label: columnLabel(c) })),
      });
      if (col === null) return;
      mutateView((v) => {
        Object.assign(
          v,
          addGroupWithRule(
            v,
            "all",
            serializePropertyFilter({ column: col, op: "notEmpty", value: "" }),
            filterLogic,
          ),
        );
      });
    })();
  };

  const addView = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("database.addView"),
        message: t("database.renameViewPrompt"),
      });
      const name = value?.trim();
      if (cancelled || !name) return;
      onMutate((cfg) => {
        cfg.views.push({ type: "table", name, order: ["file.name", ...shown.map((c) => c)] });
      });
      onSelectView(views.length);
    })();
  };

  const renameView = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("database.renameView"),
        message: t("database.renameViewPrompt"),
        initial: String(view.name ?? ""),
      });
      const name = value?.trim();
      if (cancelled || !name) return;
      mutateView((v) => {
        v.name = name;
      });
    })();
  };

  // Desktop parity (E2): duplicate inserts a deep copy right after the
  // source view and selects it; reorder moves the view within the file.
  const duplicateView = () => {
    const copy = JSON.parse(JSON.stringify(view));
    copy.name = `${String(view.name || viewTypeLabel(view.type ?? "table"))} ${t("database.copySuffix")}`;
    onMutate((cfg) => {
      cfg.views.splice(viewIndex + 1, 0, copy);
    });
    onSelectView(viewIndex + 1);
  };

  const moveView = (idx: number, delta: -1 | 1) => {
    const to = idx + delta;
    if (to < 0 || to >= views.length) return;
    onMutate((cfg) => {
      const [moved] = cfg.views.splice(idx, 1);
      cfg.views.splice(to, 0, moved);
    });
    if (idx === viewIndex) onSelectView(to);
    else if (to === viewIndex) onSelectView(idx);
  };

  const deleteView = () => {
    if (views.length <= 1) return;
    void (async () => {
      const ok = await mConfirm({
        title: t("database.deleteView"),
        message: String(view.name ?? ""),
        danger: true,
        confirmLabel: t("common.delete"),
      });
      if (!ok) return;
      onMutate((cfg) => {
        cfg.views.splice(viewIndex, 1);
      });
      onSelectView(Math.max(0, viewIndex - 1));
    })();
  };

  // New property (E3): name prompt → type pick → schema + active view order.
  const addProperty = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("properties.addProperty"),
        message: t("properties.namePlaceholder"),
      });
      const name = value?.trim();
      if (cancelled || !name) return;
      if (!isValidNewPropertyName(name, columnsPool, "")) {
        toast.error(t("properties.renameInvalid"));
        return;
      }
      const type = await mSelect({
        title: t("properties.chooseType"),
        options: NEW_PROPERTY_TYPES.map((tp) => ({ value: tp, label: t(`properties.type_${tp}`) })),
      });
      if (type === null) return;
      onMutate((cfg) => {
        if (!cfg.columns || Array.isArray(cfg.columns)) cfg.columns = {};
        cfg.columns[name] = { input: type };
        const v = cfg.views[viewIndex];
        if (v) {
          if (!Array.isArray(v.order)) v.order = ["file.name"];
          if (!v.order.includes(name)) v.order.push(name);
        }
      });
    })();
  };

  // View-specific selectors offer only the property types they can display
  // (maintainer 2026-07-18), via the shared helper so desktop + mobile agree.
  // The active value is always kept so an existing config never silently drops.
  const getColInput = (c: string): string | undefined => config?.columns?.[c]?.input;
  const dateColumns = columnsForBaseSelector("dateField", columnsPool, getColInput, { current: view.dateField });
  const endColumns = columnsForBaseSelector("dateField", columnsPool.filter((c) => c !== view.dateField), getColInput, { current: view.endField });
  const colorColumns = columnsForBaseSelector("boardGroup", columnsPool, getColInput, { current: view.colorBy });
  const groupColumns = columnsForBaseSelector("boardGroup", columnsPool, getColInput, { current: view.groupBy });
  const coverColumns = columnsForBaseSelector("galleryCover", columnsPool, getColInput, { current: view.coverImage });

  // Master list (config redesign P6): "views" (mobile-only view management)
  // first, then the five config areas from the shared catalog. Each row shows a
  // live one-glance summary.
  const filterCount = simpleRules.length + groupEntries.length + leftoverEntries.length;
  const sourceCount = sourcesOf("and").length + sourcesOf("or").length;
  const masterAreas: { id: string; icon: typeof Layers; labelKey: string; summary: string }[] = [
    { id: "views", icon: Layers, labelKey: "database.viewOptions", summary: String(views.length) },
    ...BASE_CONFIG_AREAS.map((a) => ({
      id: a.id,
      icon: a.icon,
      labelKey: a.labelKey,
      summary:
        a.id === "view" ? viewTypeLabel(view.type ?? "table")
          : a.id === "columns" ? String(shown.length)
            : a.id === "filter" ? (filterCount > 0 ? String(filterCount) : "—")
              : a.id === "sort" ? (sortRules.length > 0 ? String(sortRules.length) : "—")
                : sourceCount > 0 ? String(sourceCount) : "—",
    })),
  ];
  const detailLabel =
    activeArea === "views" ? t("database.viewOptions") : t(baseConfigArea(activeArea ?? "")?.labelKey ?? "database.configure");

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet m-sheet--config" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />

        {activeArea === null && (
          <>
            <p className="m-sheet-title">{t("database.configure")}</p>
            {masterAreas.map((a) => {
              const AreaIcon = a.icon;
              return (
                <button className="m-row m-row--split" key={a.id} onClick={() => setActiveArea(a.id)}>
                  <span className="m-row-main m-row--static"><AreaIcon size={ICON.head} /><span>{t(a.labelKey)}</span></span>
                  <span className="m-cfg-summary">{a.summary}</span>
                  <ChevronRight size={ICON.head} />
                </button>
              );
            })}
          </>
        )}

        {activeArea !== null && (
          <div className="m-cfg-detailhead">
            <IconButton label={t("editor.back")} onClick={() => setActiveArea(null)}><ChevronLeft size={ICON.head} /></IconButton>
            <span className="m-sheet-title" style={{ margin: 0 }}>{detailLabel}</span>
          </div>
        )}

        {/* Data source (base-global, desktop contract: filters.and/or) */}
        {activeArea === "source" && (
        <>
        <SectionLabel className="m-sectionlabel--inset">{t("database.sourceConfig")}</SectionLabel>
        {sourcesOf("and").length + sourcesOf("or").length === 0 && (
          <p className="m-hint">{t("database.noSources")}</p>
        )}
        {(["and", "or"] as const).map((logic) =>
          sourcesOf(logic).length === 0 ? null : (
            <div key={logic}>
              <p className="m-hint">
                {t(logic === "and" ? "database.matchAll" : "database.matchAny")}
              </p>
              {sourcesOf(logic).map(({ clause, idx }) => {
                const parsed = parseSourceClause(clause);
                const label = parsed?.type === "tag" ? t("database.tag") : t("database.folder");
                let display = parsed?.value ?? clause;
                if (parsed?.type === "tag" && !display.startsWith("#")) display = `#${display}`;
                if (parsed?.type === "folder" && display === "/") display = `/ (${t("database.rootFolder")})`;
                return (
                  <div className="m-row m-row--split" key={`${logic}-${idx}`}>
                    <span className="m-row-main m-row--static">
                      {parsed?.type === "tag" ? <Hash size={ICON.head} /> : <Folder size={ICON.head} />}
                      <span>
                        {label}: {display}
                      </span>
                    </span>
                    <IconButton label={t("common.delete")} onClick={() => removeSourceAt(logic, idx)}>
                      <X size={ICON.head} />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          ),
        )}
        {/* One add set (defaults to AND — the common case; existing OR sources
            from the desktop still show above and stay deletable). */}
        <div className="m-config-actions">
          <Button variant="ghost" size="sm" onClick={() => setPickSourceFolder("and")}>
            + {t("database.folder")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => addTagSource("and")}>
            + {t("database.tag")}
          </Button>
        </div>

        {/* New entries (S23): where they are stored and which template seeds
            them. Both are database-wide settings the phone could READ but never
            set — a database created here kept asking the folder dialog. */}
        <SectionLabel className="m-sectionlabel--inset">{t("database.newItem")}</SectionLabel>
        <button className="m-row m-row--split" onClick={() => setPickItemFolder(true)}>
          <span className="m-peeklabel">{t("database.changeNewItemFolder")}</span>
          <span className="m-peekvalue">{newItemFolder || t("database.storageFolderUnset")}</span>
        </button>
        <button className="m-row m-row--split" onClick={pickTemplate}>
          <span className="m-peeklabel">{t("database.templatesSection")}</span>
          <span className="m-peekvalue">
            {newItemTemplate ? noteDisplayName(newItemTemplate.split("/").pop() ?? "") : t("database.noTemplate")}
          </span>
        </button>
        {taskListName !== null && (
          <button className="m-row m-row--split" onClick={pickTaskList}>
            <span className="m-peeklabel">{t("tasks.alsoCreateIn")}</span>
            <span className="m-peekvalue">{taskListName || t("tasks.noProviderList")}</span>
          </button>
        )}

        {/* Sub-items (S22): structure, not presentation — it creates a
            self-relation column pair in the database, so it sits with the data
            source exactly as it does on the desktop. */}
        <SectionLabel className="m-sectionlabel--inset">{t("database.subItems")}</SectionLabel>
        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("database.enableSubItems")}</span>
          <Switch
            checked={!!subItemsProperty}
            label={t("database.enableSubItems")}
            onChange={(on) => (on ? enableSubItems() : setSubItemsProperty(null))}
          />
        </div>
        {subItemsProperty && selfRelationColumns.length > 1 && (
          <div className="m-turninto">
            {selfRelationColumns.map((c) => (
              <Chip key={c} selected={subItemsProperty === c} onClick={() => setSubItemsProperty(c)}>
                {columnLabel(c)}
              </Chip>
            ))}
          </div>
        )}
        <p className="m-hint">{t("database.subItemsHint")}</p>
        </>
        )}

        {/* Views — mobile-only view management (desktop: view tab strip) */}
        {activeArea === "views" && (
        <>
        {views.map((v, i) => (
          <div className="m-row m-row--split" key={`${v.name ?? ""}-${i}`}>
            <button className="m-row-main" onClick={() => onSelectView(i)}>
              <span>{v.name || viewTypeLabel(v.type ?? "table")}</span>
              <span className={`m-slotmark${i === viewIndex ? " is-on" : ""}`} />
            </button>
            <IconButton label={t("block.moveUp")} disabled={i === 0} onClick={() => moveView(i, -1)}>
              <ArrowUp size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("block.moveDown")}
              disabled={i === views.length - 1}
              onClick={() => moveView(i, 1)}
            >
              <ArrowDown size={ICON.head} />
            </IconButton>
          </div>
        ))}
        <button className="m-row" onClick={addView}>
          <Plus size={ICON.head} />
          <span>{t("database.addView")}</span>
        </button>
        <div className="m-config-actions">
          <Button variant="ghost" size="sm" onClick={renameView}>
            {t("database.renameView")}
          </Button>
          <Button variant="ghost" size="sm" onClick={duplicateView}>
            <Copy size={ICON.meta} /> {t("database.duplicateView")}
          </Button>
          {views.length > 1 && (
            <Button variant="danger" size="sm" onClick={deleteView}>
              {t("database.deleteView")}
            </Button>
          )}
        </div>
        </>
        )}

        {/* View — type + type-specific options + date format */}
        {activeArea === "view" && (
        <>
        <SectionLabel className="m-sectionlabel--inset">{t("database.viewType")}</SectionLabel>
        <div className="m-turninto">
          {VIEW_TYPES.map((type) => (
            <Chip
              selected={(view.type ?? "table") === type}
              key={type}
              onClick={() =>
                mutateView((v) => {
                  v.type = type;
                })
              }
            >
              {viewTypeLabel(type)}
            </Chip>
          ))}
        </div>

        {/* Board grouping / calendar+timeline date fields */}
        {view.type === "board" && (
          <>
            <SectionLabel className="m-sectionlabel--inset">{t("database.groupBy")}</SectionLabel>
            <div className="m-turninto">
              {groupColumns.map((c) => (
                <Chip
                  selected={view.groupBy === c}
                  key={c}
                  onClick={() =>
                    mutateView((v) => {
                      v.groupBy = c;
                    })
                  }
                >
                  {columnLabel(c)}
                </Chip>
              ))}
            </div>
            {/* Column color mode (E1, WP3 parity): chip only vs. whole list. */}
            <SectionLabel className="m-sectionlabel--inset">{t("database.boardColor")}</SectionLabel>
            <div className="m-turninto">
              {(["chip", "column"] as const).map((mode) => (
                <Chip
                  selected={(view.boardColorMode === "column" ? "column" : "chip") === mode}
                  key={mode}
                  onClick={() =>
                    mutateView((v) => {
                      if (mode === "column") v.boardColorMode = "column";
                      else delete v.boardColorMode;
                    })
                  }
                >
                  {t(mode === "column" ? "database.boardColorColumn" : "database.boardColorChip")}
                </Chip>
              ))}
            </div>
          </>
        )}
        {(view.type === "calendar" || view.type === "timeline") && (
          <>
            <SectionLabel className="m-sectionlabel--inset">{t("database.dateField")}</SectionLabel>
            <div className="m-turninto">
              {dateColumns.length === 0 && (
                <span className="m-sectionlabel m-sectionlabel--inset" style={{ fontWeight: 400, textTransform: "none" }}>{t("database.noDateColumn")}</span>
              )}
              {dateColumns.map((c) => (
                <Chip
                  selected={view.dateField === c}
                  key={c}
                  onClick={() =>
                    mutateView((v) => {
                      v.dateField = c;
                    })
                  }
                >
                  {columnLabel(c)}
                </Chip>
              ))}
            </div>
            {view.type === "timeline" && (
              <>
                <SectionLabel className="m-sectionlabel--inset">{t("database.endDateField")}</SectionLabel>
                <div className="m-turninto">
                  <Chip
                    selected={!view.endField}
                    onClick={() =>
                      mutateView((v) => {
                        delete v.endField;
                      })
                    }
                  >
                    {t("database.noEndDate")}
                  </Chip>
                  {endColumns.map((c) => (
                    <Chip
                      selected={view.endField === c}
                      key={c}
                      onClick={() =>
                        mutateView((v) => {
                          v.endField = c;
                        })
                      }
                    >
                      {columnLabel(c)}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            {view.type === "timeline" && (
              <>
                {/* Colour by property (S21b): the same field the desktop
                    timeline reads, written into the same `colorBy` key. */}
                <SectionLabel className="m-sectionlabel--inset">{t("database.colorField")}</SectionLabel>
                <div className="m-turninto">
                  <Chip
                    selected={!view.colorBy}
                    onClick={() =>
                      mutateView((v) => {
                        delete v.colorBy;
                      })
                    }
                  >
                    {t("database.noColorField")}
                  </Chip>
                  {colorColumns.map((c) => (
                    <Chip
                      selected={view.colorBy === c}
                      key={c}
                      data-testid={`base-cfg-color-${c}`}
                      onClick={() =>
                        mutateView((v) => {
                          v.colorBy = c;
                        })
                      }
                    >
                      {columnLabel(c)}
                    </Chip>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {view.type === "gallery" && (
          <>
            {/* Cover image column (E3, desktop views[i].coverImage contract) */}
            <SectionLabel className="m-sectionlabel--inset">{t("database.coverImage")}</SectionLabel>
            <div className="m-turninto">
              <Chip
                selected={!view.coverImage}
                onClick={() =>
                  mutateView((v) => {
                    delete v.coverImage;
                  })
                }
              >
                {t("database.noCover")}
              </Chip>
              {coverColumns.map((c) => (
                <Chip
                  selected={view.coverImage === c}
                  key={c}
                  onClick={() =>
                    mutateView((v) => {
                      v.coverImage = c;
                    })
                  }
                >
                  {columnLabel(c)}
                </Chip>
              ))}
            </div>
          </>
        )}
        {dateColumns.length > 0 && (
          <>
            {/* Per-view date format (E3, desktop views[i].dateFormat contract) */}
            <SectionLabel className="m-sectionlabel--inset">{t("database.dateFormat")}</SectionLabel>
            <div className="m-turninto">
              {DATE_FORMATS.map((fmt) => (
                <Chip
                  selected={(view.dateFormat ?? "default") === fmt}
                  key={fmt}
                  onClick={() =>
                    mutateView((v) => {
                      if (fmt === "default") delete v.dateFormat;
                      else v.dateFormat = fmt;
                    })
                  }
                >
                  {t(
                    fmt === "default"
                      ? "database.dateFormatDefault"
                      : fmt === "long"
                        ? "database.dateFormatLong"
                        : fmt === "iso"
                          ? "database.dateFormatIso"
                          : "database.dateFormatRelative",
                  )}
                </Chip>
              ))}
            </div>
          </>
        )}

        </>
        )}

        {/* Columns (E3: pencil opens the schema sheet, + adds a property) */}
        {activeArea === "columns" && (
        <>
        <SectionLabel className="m-sectionlabel--inset">{t("database.properties")}</SectionLabel>
        {shown.map((c, idx) => (
          <div className="m-row m-row--split" key={c}>
            <button
              className="m-row-main"
              onClick={() => setOrder(shown.filter((x) => x !== c))}
            >
              <span>{columnLabel(c)}</span>
              <span className="m-slotmark is-on" />
            </button>
            <IconButton
              label={t("properties.editColumn", { column: columnLabel(c) })}
              onClick={() => onEditProperty(c)}
            >
              <Pencil size={ICON.head} />
            </IconButton>
            <IconButton label={t("block.moveUp")} disabled={idx === 0} onClick={() => moveColumn(c, -1)}>
              <ArrowUp size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("block.moveDown")}
              disabled={idx === shown.length - 1}
              onClick={() => moveColumn(c, 1)}
            >
              <ArrowDown size={ICON.head} />
            </IconButton>
          </div>
        ))}
        {hidden.map((c) => (
          <div className="m-row m-row--split" key={c}>
            <button className="m-row-main" onClick={() => setOrder([...shown, c])}>
              <span>{columnLabel(c)}</span>
              <span className="m-slotmark" />
            </button>
            <IconButton
              label={t("properties.editColumn", { column: columnLabel(c) })}
              onClick={() => onEditProperty(c)}
            >
              <Pencil size={ICON.head} />
            </IconButton>
          </div>
        ))}
        <button className="m-row" onClick={addProperty}>
          <Plus size={ICON.head} />
          <span>{t("properties.addProperty")}</span>
        </button>
        </>
        )}

        {/* Sort (E2: priorities reorder, file.* columns join the pool) */}
        {activeArea === "sort" && (
        <>
        {sortRules.map((rule, idx) => (
          <div className="m-row m-row--split" key={`${rule.property}-${idx}`}>
            <button
              className="m-row-main"
              onClick={() =>
                mutateView((v) => {
                  v.sort[idx].direction = rule.direction === "DESC" ? "ASC" : "DESC";
                })
              }
            >
              <ArrowUpDown size={ICON.head} />
              <span>
                {sortLabel(rule.property)} · {rule.direction === "DESC" ? "↓" : "↑"}
              </span>
            </button>
            <IconButton label={t("block.moveUp")} disabled={idx === 0} onClick={() => moveSortRule(idx, -1)}>
              <ArrowUp size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("block.moveDown")}
              disabled={idx === sortRules.length - 1}
              onClick={() => moveSortRule(idx, 1)}
            >
              <ArrowDown size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("database.deleteView")}
              onClick={() =>
                mutateView((v) => {
                  v.sort.splice(idx, 1);
                })
              }
            >
              <X size={ICON.head} />
            </IconButton>
          </div>
        ))}
        <div className="m-turninto">
          {sortableColumns
            .filter(
              (c) =>
                !sortRules.some(
                  (r) => r.property === c || r.property.replace(/^note\./, "") === c,
                ),
            )
            .map((c) => (
              <Chip
                key={c}
                onClick={() =>
                  mutateView((v) => {
                    if (!Array.isArray(v.sort)) v.sort = [];
                    v.sort.push({ property: c, direction: "ASC" });
                  })
                }
              >
                + {sortLabel(c)}
              </Chip>
            ))}
        </div>
        </>
        )}

        {/* Property filters on THIS view (desktop per-view contract, E2:
            top logic toggle + Notion-style groups + raw leftovers). */}
        {activeArea === "filter" && (
        <>
        <p className="m-sectionlabel m-sectionlabel--inset">
          {t("database.filterPerViewHint")}
        </p>

        {/* "This note" (S23): a self-reference filter for an EMBEDDED database
            — the project note lists its own tasks. Stored plainva-side, so
            Obsidian and the standalone view show every row. */}
        {wikiLinkColumns.length > 0 && (
          <>
            <SectionLabel className="m-sectionlabel--inset">{t("database.filterThisNote")}</SectionLabel>
            {wikiLinkColumns.map((c) => (
              <div className="m-row m-row--split" key={c}>
                <span className="m-peeklabel">{columnLabel(c)}</span>
                <Switch
                  checked={contextFilters.includes(c)}
                  label={`${columnLabel(c)} — ${t("database.filterThisNote")}`}
                  onChange={(on) =>
                    onMutate((cfg) => Object.assign(cfg, on ? addContextFilter(cfg, c) : removeContextFilter(cfg, c)))
                  }
                />
              </div>
            ))}
            <p className="m-hint">{t("database.filterThisNoteTip")}</p>
          </>
        )}
        <div className="m-turninto">
          {(["all", "any"] as const).map((logic) => (
            <Chip selected={filterLogic === logic} key={logic} onClick={() => setFilterLogic(logic)}>
              {t(logic === "all" ? "database.filterMatchAll" : "database.filterMatchAny")}
            </Chip>
          ))}
        </div>
        {simpleRules.map((entry, idx) => (
          <FilterRuleRow
            columnLabel={columnLabel}
            key={idx}
            onChange={(rule) =>
              onMutate((cfg) => {
                const v = cfg.views[viewIndex];
                Object.assign(v, updateTopFilterRule(v, entry.ref, serializePropertyFilter(rule)));
              })
            }
            onRemove={() =>
              onMutate((cfg) => {
                const v = cfg.views[viewIndex];
                Object.assign(v, removeFilterEntry(v, entry.ref));
              })
            }
            rule={entry.rule}
          />
        ))}
        {groupEntries.map((group, gi) => (
          <div className="m-filtergroup" key={`group-${gi}`}>
            <div className="m-filterrule-head">
              <span className="m-filterrule-col">{t("database.filterGroup")}</span>
              <span className="m-headactions">
                {(["all", "any"] as const).map((logic) => (
                  <Chip
                    selected={group.logic === logic}
                    key={logic}
                    onClick={() =>
                      onMutate((cfg) => {
                        const v = cfg.views[viewIndex];
                        Object.assign(v, setGroupLogic(v, group.ref, logic));
                      })
                    }
                  >
                    {t(logic === "all" ? "database.filterMatchAll" : "database.filterMatchAny")}
                  </Chip>
                ))}
                <IconButton
                  label={t("common.delete")}
                  onClick={() =>
                    onMutate((cfg) => {
                      const v = cfg.views[viewIndex];
                      Object.assign(v, removeFilterEntry(v, group.ref));
                    })
                  }
                >
                  <Trash2 size={ICON.head} />
                </IconButton>
              </span>
            </div>
            {group.items.map((item, ii) =>
              item.rule ? (
                <FilterRuleRow
                  columnLabel={columnLabel}
                  key={ii}
                  onChange={(rule) =>
                    onMutate((cfg) => {
                      const v = cfg.views[viewIndex];
                      Object.assign(
                        v,
                        updateGroupRule(v, group.ref, item.idx, serializePropertyFilter(rule)),
                      );
                    })
                  }
                  onRemove={() =>
                    onMutate((cfg) => {
                      const v = cfg.views[viewIndex];
                      Object.assign(v, removeGroupRule(v, group.ref, item.idx));
                    })
                  }
                  rule={item.rule}
                />
              ) : (
                <RawFilterRow
                  key={ii}
                  onRemove={() =>
                    onMutate((cfg) => {
                      const v = cfg.views[viewIndex];
                      Object.assign(v, removeGroupRule(v, group.ref, item.idx));
                    })
                  }
                  raw={item.raw}
                />
              ),
            )}
            <div className="m-turninto">
              {columnsPool.map((c) => (
                <Chip
                  key={c}
                  onClick={() =>
                    onMutate((cfg) => {
                      const v = cfg.views[viewIndex];
                      Object.assign(
                        v,
                        addRuleToGroup(
                          v,
                          group.ref,
                          serializePropertyFilter({ column: c, op: "notEmpty", value: "" }),
                        ),
                      );
                    })
                  }
                >
                  + {columnLabel(c)}
                </Chip>
              ))}
            </div>
          </div>
        ))}
        {leftoverEntries.map((entry, idx) => (
          <RawFilterRow
            key={`raw-${idx}`}
            onRemove={() =>
              onMutate((cfg) => {
                const v = cfg.views[viewIndex];
                Object.assign(v, removeFilterEntry(v, entry.ref));
              })
            }
            raw={entry.kind === "rawString" ? entry.raw : JSON.stringify(entry.raw)}
          />
        ))}
        <div className="m-turninto">
          {columnsPool.map((c) => (
            <Chip
              selected={newFilterCol === c}
              key={c}
              onClick={() => {
                setNewFilterCol("");
                onMutate((cfg) => {
                  const v = cfg.views[viewIndex];
                  Object.assign(
                    v,
                    addTopFilterRule(
                      v,
                      serializePropertyFilter({ column: c, op: "notEmpty", value: "" }),
                      filterLogic,
                    ),
                  );
                });
              }}
            >
              + {columnLabel(c)}
            </Chip>
          ))}
          {columnsPool.length > 0 && (
            <Button variant="ghost" size="sm" onClick={addGroup}>
              + {t("database.filterGroup")}
            </Button>
          )}
        </div>
          </>
        )}
      </div>

      {pickSourceFolder && (
        <FolderPickerSheet
          onClose={() => setPickSourceFolder(null)}
          onPick={(path) => {
            // The desktop stores the vault root as "/".
            addSource(pickSourceFolder, buildSourceClause("folder", path || "/"));
          }}
          title={t("database.folder")}
          vault={vault}
        />
      )}
      {pickItemFolder && (
        <FolderPickerSheet
          onClose={() => setPickItemFolder(false)}
          onPick={(path) => {
            setPickItemFolder(false);
            onMutate((cfg) => {
              if (path) cfg.newItemFolder = path;
              else delete cfg.newItemFolder;
            });
          }}
          title={t("database.newItemFolderTitle")}
          vault={vault}
        />
      )}
    </div>
  );
}

function FilterRuleRow({
  rule,
  columnLabel,
  onChange,
  onRemove,
}: {
  rule: PropertyFilterRule;
  columnLabel: (col: string) => string;
  onChange: (rule: PropertyFilterRule) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const needsValue = rule.op !== "empty" && rule.op !== "notEmpty";
  const opLabel = (op: FilterOp) =>
    op === "empty" ? t("database.opEmpty") : op === "notEmpty" ? t("database.opNotEmpty") : op;
  return (
    <div className="m-filterrule">
      <div className="m-filterrule-head">
        <span className="m-filterrule-col">{columnLabel(rule.column)}</span>
        <IconButton label={t("database.deleteView")} onClick={onRemove}>
          <Trash2 size={ICON.head} />
        </IconButton>
      </div>
      <div className="m-turninto">
        {FILTER_OPS.map((op) => (
          <Chip
            selected={rule.op === op}
            key={op}
            onClick={() => onChange({ ...rule, op, value: needsValue ? rule.value : "" })}
          >
            {opLabel(op)}
          </Chip>
        ))}
      </div>
      {needsValue && (
        <TextInput
          
          defaultValue={rule.value}
          onBlur={(e) => {
            if (e.target.value !== rule.value) onChange({ ...rule, value: e.target.value });
          }}
          placeholder={t("database.selectValue")}
        />
      )}
    </div>
  );
}

/** Filter entry the mobile editor cannot parse: shown verbatim, removable. */
function RawFilterRow({ raw, onRemove }: { raw: string; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-row m-row--split">
      <span className="m-row-main m-row--static m-rawfilter">{raw}</span>
      <IconButton label={t("common.delete")} onClick={onRemove}>
        <X size={ICON.head} />
      </IconButton>
    </div>
  );
}

/** Serializable check reused by the parent for validation. */
export function isSimpleRule(clause: string): boolean {
  return parsePropertyFilter(clause) !== null;
}
