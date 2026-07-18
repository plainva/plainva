import { useState } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Copy, Folder, Hash, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { mConfirm, mPrompt, mSelect } from "../../services/mobileDialogs";
import { FolderPickerSheet } from "../../components/FolderPickerSheet";
import type { MobileVault } from "../../services/vaultService";
import {
  addGroupWithRule,
  addRuleToGroup,
  addTopFilterRule,
  BASE_CONFIG_AREAS,
  baseConfigArea,
  buildSourceClause,
  buildUIFilterModel,
  isSourceCondition,
  isValidNewPropertyName,
  moveTopFilterEntries,
  parsePropertyFilter,
  parseSourceClause,
  removeFilterEntry,
  removeGroupRule,
  serializePropertyFilter,
  setGroupLogic,
  toast,
  updateGroupRule,
  updateTopFilterRule,
  type FilterEntryRef,
  type FilterOp,
  type PropertyFilterRule,
  type UIGroupItem,
} from "@plainva/ui";

/**
 * Per-view configuration sheet (R4.4, E6 "desktop-oriented"): view management
 * (add/rename/delete/type), visible columns + order, sort rules, simple
 * property filter rules (AND list; nested groups from the desktop are kept
 * untouched), board grouping and calendar/timeline date fields. Every change
 * goes through the caller's mutate() which serializes via the shared
 * baseFormat contract.
 */

const VIEW_TYPES = ["table", "list", "gallery", "board", "calendar", "timeline", "pinboard"] as const;
const FILTER_OPS: FilterOp[] = ["==", "!=", "contains", "notContains", ">", "<", ">=", "<=", "empty", "notEmpty"];
/** Authoring vocabulary for fresh properties — relation stays desktop (E3). */
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
  "url",
  "email",
  "phone",
] as const;
const DATE_FORMATS = ["default", "long", "iso", "relative"] as const;

export function BaseConfigSheet({
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

  const viewTypeLabel = (type: string) =>
    t(
      {
        table: "database.viewTable",
        list: "database.viewList",
        gallery: "database.viewGallery",
        board: "database.viewBoard",
        calendar: "database.viewCalendar",
        timeline: "database.viewTimeline",
        pinboard: "database.viewPinboard",
      }[type] ?? "database.viewTable",
    );

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

  const dateColumns = columnsPool.filter((c) => {
    const input = config?.columns?.[c]?.input;
    return input === "date" || input === "datetime";
  });
  const groupColumns = columnsPool.filter((c) => {
    const input = config?.columns?.[c]?.input;
    return input === "select" || input === "status" || input === "multiselect" || input === "relation" || input === "link";
  });

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
      <div className="m-sheet m-sheet--config" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />

        {activeArea === null && (
          <>
            <p className="m-sheet-title">{t("database.configure")}</p>
            {masterAreas.map((a) => {
              const AreaIcon = a.icon;
              return (
                <button className="m-row m-row--split" key={a.id} onClick={() => setActiveArea(a.id)}>
                  <span className="m-row-main m-row--static"><AreaIcon size={18} /><span>{t(a.labelKey)}</span></span>
                  <span className="m-cfg-summary">{a.summary}</span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </>
        )}

        {activeArea !== null && (
          <div className="m-cfg-detailhead">
            <button className="m-iconbtn" aria-label={t("editor.back")} onClick={() => setActiveArea(null)}><ChevronLeft size={20} /></button>
            <span className="m-sheet-title" style={{ margin: 0 }}>{detailLabel}</span>
          </div>
        )}

        {/* Data source (base-global, desktop contract: filters.and/or) */}
        {activeArea === "source" && (
        <>
        <p className="m-sectionlabel m-sectionlabel--inset">{t("database.sourceConfig")}</p>
        {sourcesOf("and").length + sourcesOf("or").length === 0 && (
          <p className="m-hint m-hint--inset">{t("database.noSources")}</p>
        )}
        {(["and", "or"] as const).map((logic) =>
          sourcesOf(logic).length === 0 ? null : (
            <div key={logic}>
              <p className="m-hint m-hint--inset">
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
                      {parsed?.type === "tag" ? <Hash size={18} /> : <Folder size={18} />}
                      <span>
                        {label}: {display}
                      </span>
                    </span>
                    <button
                      aria-label={t("common.delete")}
                      className="m-iconbtn"
                      onClick={() => removeSourceAt(logic, idx)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          ),
        )}
        {/* One add set (defaults to AND — the common case; existing OR sources
            from the desktop still show above and stay deletable). */}
        <div className="m-config-actions">
          <button className="m-chip" onClick={() => setPickSourceFolder("and")}>
            + {t("database.folder")}
          </button>
          <button className="m-chip" onClick={() => addTagSource("and")}>
            + {t("database.tag")}
          </button>
        </div>
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
            <button
              aria-label={t("block.moveUp")}
              className="m-iconbtn"
              disabled={i === 0}
              onClick={() => moveView(i, -1)}
            >
              <ArrowUp size={18} />
            </button>
            <button
              aria-label={t("block.moveDown")}
              className="m-iconbtn"
              disabled={i === views.length - 1}
              onClick={() => moveView(i, 1)}
            >
              <ArrowDown size={18} />
            </button>
          </div>
        ))}
        <button className="m-row" onClick={addView}>
          <Plus size={18} />
          <span>{t("database.addView")}</span>
        </button>
        <div className="m-config-actions">
          <button className="m-chip" onClick={renameView}>
            {t("database.renameView")}
          </button>
          <button className="m-chip" onClick={duplicateView}>
            <Copy size={14} /> {t("database.duplicateView")}
          </button>
          {views.length > 1 && (
            <button className="m-chip m-danger" onClick={deleteView}>
              {t("database.deleteView")}
            </button>
          )}
        </div>
        </>
        )}

        {/* View — type + type-specific options + date format */}
        {activeArea === "view" && (
        <>
        <p className="m-sectionlabel m-sectionlabel--inset">{t("database.viewType")}</p>
        <div className="m-turninto">
          {VIEW_TYPES.map((type) => (
            <button
              className={`m-chip${(view.type ?? "table") === type ? " is-on" : ""}`}
              key={type}
              onClick={() =>
                mutateView((v) => {
                  v.type = type;
                })
              }
            >
              {viewTypeLabel(type)}
            </button>
          ))}
        </div>

        {/* Board grouping / calendar+timeline date fields */}
        {view.type === "board" && (
          <>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("database.groupBy")}</p>
            <div className="m-turninto">
              {groupColumns.map((c) => (
                <button
                  className={`m-chip${view.groupBy === c ? " is-on" : ""}`}
                  key={c}
                  onClick={() =>
                    mutateView((v) => {
                      v.groupBy = c;
                    })
                  }
                >
                  {columnLabel(c)}
                </button>
              ))}
            </div>
            {/* Column color mode (E1, WP3 parity): chip only vs. whole list. */}
            <p className="m-sectionlabel m-sectionlabel--inset">{t("database.boardColor")}</p>
            <div className="m-turninto">
              {(["chip", "column"] as const).map((mode) => (
                <button
                  className={`m-chip${(view.boardColorMode === "column" ? "column" : "chip") === mode ? " is-on" : ""}`}
                  key={mode}
                  onClick={() =>
                    mutateView((v) => {
                      if (mode === "column") v.boardColorMode = "column";
                      else delete v.boardColorMode;
                    })
                  }
                >
                  {t(mode === "column" ? "database.boardColorColumn" : "database.boardColorChip")}
                </button>
              ))}
            </div>
          </>
        )}
        {(view.type === "calendar" || view.type === "timeline") && (
          <>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("database.dateField")}</p>
            <div className="m-turninto">
              {(dateColumns.length > 0 ? dateColumns : columnsPool).map((c) => (
                <button
                  className={`m-chip${view.dateField === c ? " is-on" : ""}`}
                  key={c}
                  onClick={() =>
                    mutateView((v) => {
                      v.dateField = c;
                    })
                  }
                >
                  {columnLabel(c)}
                </button>
              ))}
            </div>
            {view.type === "timeline" && (
              <>
                <p className="m-sectionlabel m-sectionlabel--inset">{t("database.endDateField")}</p>
                <div className="m-turninto">
                  <button
                    className={`m-chip${!view.endField ? " is-on" : ""}`}
                    onClick={() =>
                      mutateView((v) => {
                        delete v.endField;
                      })
                    }
                  >
                    {t("database.noEndDate")}
                  </button>
                  {(dateColumns.length > 0 ? dateColumns : columnsPool).map((c) => (
                    <button
                      className={`m-chip${view.endField === c ? " is-on" : ""}`}
                      key={c}
                      onClick={() =>
                        mutateView((v) => {
                          v.endField = c;
                        })
                      }
                    >
                      {columnLabel(c)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {view.type === "gallery" && (
          <>
            {/* Cover image column (E3, desktop views[i].coverImage contract) */}
            <p className="m-sectionlabel m-sectionlabel--inset">{t("database.coverImage")}</p>
            <div className="m-turninto">
              <button
                className={`m-chip${!view.coverImage ? " is-on" : ""}`}
                onClick={() =>
                  mutateView((v) => {
                    delete v.coverImage;
                  })
                }
              >
                {t("database.noCover")}
              </button>
              {columnsPool.map((c) => (
                <button
                  className={`m-chip${view.coverImage === c ? " is-on" : ""}`}
                  key={c}
                  onClick={() =>
                    mutateView((v) => {
                      v.coverImage = c;
                    })
                  }
                >
                  {columnLabel(c)}
                </button>
              ))}
            </div>
          </>
        )}
        {dateColumns.length > 0 && (
          <>
            {/* Per-view date format (E3, desktop views[i].dateFormat contract) */}
            <p className="m-sectionlabel m-sectionlabel--inset">{t("database.dateFormat")}</p>
            <div className="m-turninto">
              {DATE_FORMATS.map((fmt) => (
                <button
                  className={`m-chip${(view.dateFormat ?? "default") === fmt ? " is-on" : ""}`}
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
                </button>
              ))}
            </div>
          </>
        )}

        </>
        )}

        {/* Columns (E3: pencil opens the schema sheet, + adds a property) */}
        {activeArea === "columns" && (
        <>
        <p className="m-sectionlabel m-sectionlabel--inset">{t("database.properties")}</p>
        {shown.map((c, idx) => (
          <div className="m-row m-row--split" key={c}>
            <button
              className="m-row-main"
              onClick={() => setOrder(shown.filter((x) => x !== c))}
            >
              <span>{columnLabel(c)}</span>
              <span className="m-slotmark is-on" />
            </button>
            <button
              aria-label={t("properties.editColumn", { column: columnLabel(c) })}
              className="m-iconbtn"
              onClick={() => onEditProperty(c)}
            >
              <Pencil size={18} />
            </button>
            <button
              aria-label={t("block.moveUp")}
              className="m-iconbtn"
              disabled={idx === 0}
              onClick={() => moveColumn(c, -1)}
            >
              <ArrowUp size={18} />
            </button>
            <button
              aria-label={t("block.moveDown")}
              className="m-iconbtn"
              disabled={idx === shown.length - 1}
              onClick={() => moveColumn(c, 1)}
            >
              <ArrowDown size={18} />
            </button>
          </div>
        ))}
        {hidden.map((c) => (
          <div className="m-row m-row--split" key={c}>
            <button className="m-row-main" onClick={() => setOrder([...shown, c])}>
              <span>{columnLabel(c)}</span>
              <span className="m-slotmark" />
            </button>
            <button
              aria-label={t("properties.editColumn", { column: columnLabel(c) })}
              className="m-iconbtn"
              onClick={() => onEditProperty(c)}
            >
              <Pencil size={18} />
            </button>
          </div>
        ))}
        <button className="m-row" onClick={addProperty}>
          <Plus size={18} />
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
              <ArrowUpDown size={18} />
              <span>
                {sortLabel(rule.property)} · {rule.direction === "DESC" ? "↓" : "↑"}
              </span>
            </button>
            <button
              aria-label={t("block.moveUp")}
              className="m-iconbtn"
              disabled={idx === 0}
              onClick={() => moveSortRule(idx, -1)}
            >
              <ArrowUp size={18} />
            </button>
            <button
              aria-label={t("block.moveDown")}
              className="m-iconbtn"
              disabled={idx === sortRules.length - 1}
              onClick={() => moveSortRule(idx, 1)}
            >
              <ArrowDown size={18} />
            </button>
            <button
              aria-label={t("database.deleteView")}
              className="m-iconbtn"
              onClick={() =>
                mutateView((v) => {
                  v.sort.splice(idx, 1);
                })
              }
            >
              <X size={18} />
            </button>
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
              <button
                className="m-chip"
                key={c}
                onClick={() =>
                  mutateView((v) => {
                    if (!Array.isArray(v.sort)) v.sort = [];
                    v.sort.push({ property: c, direction: "ASC" });
                  })
                }
              >
                + {sortLabel(c)}
              </button>
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
        <div className="m-turninto">
          {(["all", "any"] as const).map((logic) => (
            <button
              className={`m-chip${filterLogic === logic ? " is-on" : ""}`}
              key={logic}
              onClick={() => setFilterLogic(logic)}
            >
              {t(logic === "all" ? "database.filterMatchAll" : "database.filterMatchAny")}
            </button>
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
                  <button
                    className={`m-chip${group.logic === logic ? " is-on" : ""}`}
                    key={logic}
                    onClick={() =>
                      onMutate((cfg) => {
                        const v = cfg.views[viewIndex];
                        Object.assign(v, setGroupLogic(v, group.ref, logic));
                      })
                    }
                  >
                    {t(logic === "all" ? "database.filterMatchAll" : "database.filterMatchAny")}
                  </button>
                ))}
                <button
                  aria-label={t("common.delete")}
                  className="m-iconbtn"
                  onClick={() =>
                    onMutate((cfg) => {
                      const v = cfg.views[viewIndex];
                      Object.assign(v, removeFilterEntry(v, group.ref));
                    })
                  }
                >
                  <Trash2 size={18} />
                </button>
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
                <button
                  className="m-chip"
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
                </button>
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
            <button
              className={`m-chip${newFilterCol === c ? " is-on" : ""}`}
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
            </button>
          ))}
          {columnsPool.length > 0 && (
            <button className="m-chip" onClick={addGroup}>
              + {t("database.filterGroup")}
            </button>
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
        <button aria-label={t("database.deleteView")} className="m-iconbtn" onClick={onRemove}>
          <Trash2 size={18} />
        </button>
      </div>
      <div className="m-turninto">
        {FILTER_OPS.map((op) => (
          <button
            className={`m-chip${rule.op === op ? " is-on" : ""}`}
            key={op}
            onClick={() => onChange({ ...rule, op, value: needsValue ? rule.value : "" })}
          >
            {opLabel(op)}
          </button>
        ))}
      </div>
      {needsValue && (
        <input
          className="m-searchfield"
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
      <button aria-label={t("common.delete")} className="m-iconbtn" onClick={onRemove}>
        <X size={18} />
      </button>
    </div>
  );
}

/** Serializable check reused by the parent for validation. */
export function isSimpleRule(clause: string): boolean {
  return parsePropertyFilter(clause) !== null;
}
