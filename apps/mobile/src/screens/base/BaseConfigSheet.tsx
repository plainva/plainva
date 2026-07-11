import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2, X } from "lucide-react";
import { mConfirm, mPrompt } from "../../services/mobileDialogs";
import {
  addTopFilterRule,
  buildUIFilterModel,
  parsePropertyFilter,
  removeFilterEntry,
  serializePropertyFilter,
  updateTopFilterRule,
  type FilterOp,
  type PropertyFilterRule,
} from "@plainva/ui";

/**
 * Per-view configuration sheet (R4.4, E6 "desktop-oriented"): view management
 * (add/rename/delete/type), visible columns + order, sort rules, simple
 * property filter rules (AND list; nested groups from the desktop are kept
 * untouched), board grouping and calendar/timeline date fields. Every change
 * goes through the caller's mutate() which serializes via the shared
 * baseFormat contract.
 */

const VIEW_TYPES = ["table", "list", "gallery", "board", "calendar", "timeline"] as const;
const FILTER_OPS: FilterOp[] = ["==", "!=", "contains", "notContains", ">", "<", ">=", "<=", "empty", "notEmpty"];

export function BaseConfigSheet({
  config,
  viewIndex,
  columnsPool,
  columnLabel,
  onMutate,
  onSelectView,
  onClose,
}: {
  config: any;
  viewIndex: number;
  /** Every known property (schema + observed), bare names without file.*. */
  columnsPool: string[];
  columnLabel: (col: string) => string;
  /** Clone-mutate-save: the callback owns persistence + re-query. */
  onMutate: (mutate: (cfg: any) => void) => void;
  onSelectView: (idx: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  const view = views[viewIndex] ?? {};
  const [newFilterCol, setNewFilterCol] = useState("");

  const viewTypeLabel = (type: string) =>
    t(
      {
        table: "database.viewTable",
        list: "database.viewList",
        gallery: "database.viewGallery",
        board: "database.viewBoard",
        calendar: "database.viewCalendar",
        timeline: "database.viewTimeline",
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

  const filterModel = buildUIFilterModel(view);
  const simpleRules = filterModel.entries.filter((e) => e.kind === "rule") as Array<{
    kind: "rule";
    ref: any;
    rule: PropertyFilterRule;
  }>;
  const groupCount = filterModel.entries.length - simpleRules.length;

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

  const dateColumns = columnsPool.filter((c) => {
    const input = config?.columns?.[c]?.input;
    return input === "date" || input === "datetime";
  });
  const groupColumns = columnsPool.filter((c) => {
    const input = config?.columns?.[c]?.input;
    return input === "select" || input === "status" || input === "multiselect" || input === "relation" || input === "link";
  });

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{t("database.configure")}</p>

        {/* Views */}
        <p className="m-sectionlabel m-sectionlabel--inset">{t("database.viewOptions")}</p>
        {views.map((v, i) => (
          <div className="m-row m-row--split" key={`${v.name ?? ""}-${i}`}>
            <button className="m-row-main" onClick={() => onSelectView(i)}>
              <span>{v.name || viewTypeLabel(v.type ?? "table")}</span>
              <span className={`m-slotmark${i === viewIndex ? " is-on" : ""}`} />
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
          {views.length > 1 && (
            <button className="m-chip m-danger" onClick={deleteView}>
              {t("database.deleteView")}
            </button>
          )}
        </div>

        {/* View type */}
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

        {/* Columns */}
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
          <button className="m-row" key={c} onClick={() => setOrder([...shown, c])}>
            <span>{columnLabel(c)}</span>
            <span className="m-slotmark" />
          </button>
        ))}

        {/* Sort */}
        <p className="m-sectionlabel m-sectionlabel--inset">{t("database.sort")}</p>
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
                {columnLabel(rule.property.replace(/^note\./, ""))} · {rule.direction === "DESC" ? "↓" : "↑"}
              </span>
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
          {columnsPool
            .filter((c) => !sortRules.some((r) => r.property.replace(/^note\./, "") === c))
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
                + {columnLabel(c)}
              </button>
            ))}
        </div>

        {/* Simple property filters on THIS view (desktop per-view contract) */}
        <p className="m-sectionlabel m-sectionlabel--inset">
          {t("database.addFilter")} · {t("database.filterPerViewHint")}
        </p>
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
        {groupCount > 0 && (
          <p className="m-hint m-hint--inset">{t("database.filterPerViewHint")} (+{groupCount})</p>
        )}
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
                      "all",
                    ),
                  );
                });
              }}
            >
              + {columnLabel(c)}
            </button>
          ))}
        </div>
      </div>
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

/** Serializable check reused by the parent for validation. */
export function isSimpleRule(clause: string): boolean {
  return parsePropertyFilter(clause) !== null;
}
