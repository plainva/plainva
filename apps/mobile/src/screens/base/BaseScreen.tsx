import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Database, Plus, Settings2 } from "lucide-react";
import {
  capitalizeFirst,
  EmptyState,
  inferType,
  orderBoardGroups,
  splitMultiValue,
  toPropId,
  UNGROUPED_KEY,
  parseWikiLinkValue,
} from "@plainva/ui";
import { toast } from "@plainva/ui";
import {
  commitCellValue,
  createBaseItem,
  loadBase,
  queryView,
  saveBaseConfig,
  type LoadedBase,
} from "../../services/baseOps";
import { vaultOps, type MobileVault } from "../../services/vaultService";
import { CellEditSheet, type CellEditTarget } from "./CellEditSheet";
import { BaseConfigSheet } from "./BaseConfigSheet";
import { isoOf } from "../../lib/dates";
import { buildMonthCells, startOfMonth } from "@plainva/ui";

type Row = Record<string, any>;

/**
 * Full .base experience on mobile (R4, E5 "all views"): table/list/cards/
 * board/calendar/timeline render natively over the shared core query;
 * cells edit through typed sheets, the view configures desktop-style and
 * every write goes through the shared serialize contract + sync chain.
 * `graph` (canvas engine, desktop-only for now) falls back to the table.
 */
export function BaseScreen({
  vault,
  path,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.base$/i, "");
  const [loaded, setLoaded] = useState<LoadedBase | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cellEdit, setCellEdit] = useState<CellEditTarget | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()));

  const config = loaded?.config;
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  const view: any = views[viewIndex] ?? {};

  useEffect(() => {
    let stale = false;
    setLoaded(null);
    setRows(null);
    setViewIndex(0);
    void loadBase(vault, path)
      .then((l) => {
        if (!stale) setLoaded(l);
      })
      .catch(() => {
        if (!stale) setLoaded({ config: { columns: {}, views: [] }, stem: title });
      });
    return () => {
      stale = true;
    };
  }, [vault, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const requery = useCallback(
    (cfg: any, idx: number) => {
      void queryView(vault, cfg, idx)
        .then(setRows)
        .catch(() => setRows([]));
    },
    [vault],
  );

  useEffect(() => {
    if (!config) return;
    requery(config, viewIndex);
  }, [config, viewIndex, requery]);

  // External updates (sync pull, counterpart edits) land here.
  useEffect(() => {
    const onChanged = () => {
      if (config) requery(config, viewIndex);
    };
    window.addEventListener("m-vault-changed", onChanged);
    return () => window.removeEventListener("m-vault-changed", onChanged);
  }, [config, viewIndex, requery]);

  /** Clone-mutate-save-requery — the single write path for config changes. */
  const mutateConfig = (mutate: (cfg: any) => void) => {
    if (!loaded) return;
    const next = JSON.parse(JSON.stringify(loaded.config));
    mutate(next);
    setLoaded({ ...loaded, config: next });
    void saveBaseConfig(vault, path, next).catch(() => toast.warning(t("mobile.saveRetry")));
  };

  const columnsPool = useMemo(() => {
    const set = new Set<string>(Object.keys(config?.columns ?? {}));
    for (const r of rows ?? []) {
      for (const k of Object.keys(r)) if (!k.startsWith("file.")) set.add(k);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [config, rows]);

  const columnLabel = useCallback(
    (col: string): string => {
      const display = config?._obsidian?.properties?.[toPropId(col)]?.displayName;
      return typeof display === "string" && display.trim() ? display : capitalizeFirst(col);
    },
    [config],
  );

  const orderedColumns: string[] = useMemo(
    () =>
      (Array.isArray(view.order) ? view.order : [])
        .map((key: string) => key.replace(/^note\./, ""))
        .filter((key: string) => key !== "file.name" && !key.startsWith("file.")),
    [view],
  );

  const rowTitle = (r: Row) => String(r["file.name"] ?? "");
  const rowPath = (r: Row) => String(r["file.path"] ?? "");

  /**
   * Column input type: the schema wins; untyped columns infer from the
   * tapped value (desktop parity — a bare `done: false` edits as a checkbox,
   * a bare wiki-link column as a relation, not as free text).
   */
  const columnInput = (col: string, sample?: unknown): string => {
    const schema = config?.columns?.[col]?.input;
    if (schema) return String(schema);
    if (sample !== undefined && sample !== null) {
      const inferred = inferType(sample, col);
      if (inferred === "link") return "relation";
      return inferred;
    }
    return "text";
  };
  const isReverse = (col: string) => !!config?.columns?.[col]?.reverseOf;

  const cellText = (v: unknown): string => {
    if (v == null) return "";
    if (v === true) return "☑";
    if (v === false) return "☐";
    if (Array.isArray(v)) return v.map((x) => cellText(x)).join(", ");
    const s = String(v);
    const wiki = parseWikiLinkValue(s);
    return wiki ? wiki.display : s;
  };

  const openCellEditor = (r: Row, col: string) => {
    if (col.startsWith("file.")) return;
    // Computed reverse columns live in the counterpart notes — tapping opens
    // the first linked note instead of editing a derived value.
    if (isReverse(col)) {
      const first = Array.isArray(r[col]) ? r[col][0] : r[col];
      const target = first ? parseWikiLinkValue(String(first))?.target : null;
      if (target) {
        void vaultOps.resolveWikiTarget(vault, target).then((p) => {
          if (p) onOpenNote(p);
        });
      }
      return;
    }
    const input = columnInput(col, r[col]);
    // Checkboxes toggle in place (no sheet).
    if (input === "checkbox") {
      const next = !(r[col] === true);
      void commitCellValue(vault, rowPath(r), col, next).then(() => requery(config, viewIndex));
      return;
    }
    setCellEdit({
      notePath: rowPath(r),
      col,
      input,
      value: r[col],
      options: config?.columns?.[col]?.options ?? [],
      relationBase: config?.columns?.[col]?.relationBase,
      relationLimit: config?.columns?.[col]?.relationLimit,
    });
  };

  const commitCell = (value: unknown) => {
    const target = cellEdit;
    setCellEdit(null);
    if (!target) return;
    void commitCellValue(vault, target.notePath, target.col, value)
      .then(() => requery(config, viewIndex))
      .catch(() => toast.warning(t("mobile.saveRetry")));
  };

  const newItem = () => {
    if (!config) return;
    void createBaseItem(vault, path, config, rows?.length ?? 0).then((p) => {
      if (p) onOpenNote(p);
      else setShowConfig(true); // no folder source to store into
    });
  };

  /** Desktop getDateProperty: views[i].dateField, else first date column. */
  const dateProp = useMemo(() => {
    if (view.dateField) return String(view.dateField);
    return (
      columnsPool.find((c) => columnInput(c) === "date" || columnInput(c) === "datetime") ?? null
    );
  }, [view, columnsPool]); // eslint-disable-line react-hooks/exhaustive-deps
  const endProp = view.endField ? String(view.endField) : null;

  const render = String(view.plainva?.render ?? view.type ?? "table");
  const effectiveRender = render === "graph" ? "table" : render === "cards" || render === "card" ? "gallery" : render;

  /* ---------------- renderers ---------------- */

  const propLine = (r: Row, cols: string[], max: number) =>
    cols.slice(0, max).map((c) =>
      cellText(r[c]) ? (
        <button
          className="m-basecard-prop"
          key={c}
          onClick={(e) => {
            e.stopPropagation();
            openCellEditor(r, c);
          }}
        >
          <span className="m-prop-key">{columnLabel(c)}</span> {cellText(r[c])}
        </button>
      ) : null,
    );

  const renderTable = () => (
    <div className="m-basetable-wrap">
      <table className="m-basetable">
        <thead>
          <tr>
            <th>{t("mobile.baseName")}</th>
            {orderedColumns.map((c) => (
              <th key={c}>{columnLabel(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows!.map((r) => (
            <tr key={rowPath(r)}>
              <td onClick={() => onOpenNote(rowPath(r))}>{rowTitle(r)}</td>
              {orderedColumns.map((c) => (
                <td key={c} onClick={() => openCellEditor(r, c)}>
                  {cellText(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderList = () => (
    <>
      {rows!.map((r) => (
        <div className="m-row m-row--split" key={rowPath(r)}>
          <button className="m-row-main" onClick={() => onOpenNote(rowPath(r))}>
            <span>{rowTitle(r)}</span>
          </button>
          {orderedColumns[0] && (
            <button className="m-cellchip" onClick={() => openCellEditor(r, orderedColumns[0])}>
              {cellText(r[orderedColumns[0]]) || "—"}
            </button>
          )}
        </div>
      ))}
    </>
  );

  const renderCards = () => (
    <div className="m-basecards">
      {rows!.map((r) => (
        <div className="m-basecard" key={rowPath(r)}>
          <button className="m-basecard-title" onClick={() => onOpenNote(rowPath(r))}>
            {rowTitle(r)}
          </button>
          {propLine(r, orderedColumns, 3)}
        </div>
      ))}
    </div>
  );

  const renderBoard = () => {
    const groupBy: string | null =
      view.groupBy ??
      columnsPool.find((c) => columnInput(c) === "select" && c.toLowerCase() === "status") ??
      columnsPool.find((c) => columnInput(c) === "select") ??
      null;
    if (!groupBy) return renderTable();
    const groups = new Map<string, Row[]>();
    for (const r of rows!) {
      const raw = r[groupBy];
      const keys =
        raw == null || raw === ""
          ? [UNGROUPED_KEY]
          : Array.isArray(raw)
            ? raw.map(String)
            : splitMultiValue(String(raw));
      for (const k of keys.length ? keys : [UNGROUPED_KEY]) {
        const key = k === UNGROUPED_KEY ? k : cellText(k);
        const list = groups.get(key) ?? [];
        list.push(r);
        groups.set(key, list);
      }
    }
    const options = (config?.columns?.[groupBy]?.options ?? []).map((o: any) => String(o.value));
    for (const o of options) if (!groups.has(o)) groups.set(o, []);
    const orderKeys = orderBoardGroups([...groups.keys()], {
      optionOrder: options.length ? options : undefined,
      savedOrder: Array.isArray(view.boardColumnOrder) ? view.boardColumnOrder : undefined,
    });
    return (
      <div className="m-board">
        {orderKeys.map((key) => (
          <div className="m-board-col" key={key}>
            <p className="m-board-head">
              {key === UNGROUPED_KEY ? t("database.noEndDate") : key}
              <span className="m-board-count">{groups.get(key)!.length}</span>
            </p>
            {groups.get(key)!.map((r) => (
              <div className="m-basecard" key={rowPath(r)}>
                <button className="m-basecard-title" onClick={() => onOpenNote(rowPath(r))}>
                  {rowTitle(r)}
                </button>
                <button className="m-cellchip" onClick={() => openCellEditor(r, groupBy)}>
                  {cellText(r[groupBy]) || "—"}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderCalendar = () => {
    if (!dateProp) return renderTable();
    const cells = buildMonthCells(calMonth);
    const month = calMonth.getMonth();
    const todayIso = isoOf(new Date());
    const monthLabel = new Intl.DateTimeFormat(i18nInstance.language, {
      month: "long",
      year: "numeric",
    }).format(calMonth);
    const weekday = new Intl.DateTimeFormat(i18nInstance.language, { weekday: "short" });
    const byDay = (iso: string) =>
      rows!.filter((r) => r[dateProp] != null && String(r[dateProp]).startsWith(iso));
    return (
      <>
        <div className="m-cal-head">
          <span className="m-cal-month">{monthLabel}</span>
          <span className="m-headactions">
            <button aria-label={t("calendar.prevMonth")} className="m-iconbtn" onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
              <ChevronLeft size={20} />
            </button>
            <button className="m-cal-today" onClick={() => setCalMonth(startOfMonth(new Date()))}>
              {t("calendar.today")}
            </button>
            <button aria-label={t("calendar.nextMonth")} className="m-iconbtn" onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
              <ChevronRight size={20} />
            </button>
          </span>
        </div>
        <div className="m-cal-grid">
          {cells.slice(0, 7).map((d) => (
            <span className="m-cal-wd" key={`wd-${d.getDay()}`}>
              {weekday.format(d)}
            </span>
          ))}
          {cells.map((d) => {
            const iso = isoOf(d);
            const dayRows = byDay(iso);
            const classes = [
              "m-cal-day",
              d.getMonth() === month ? "" : "is-outside",
              iso === todayIso ? "is-today" : "",
              dayRows.length > 0 ? "has-daily" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                className={classes}
                key={iso}
                onClick={() => {
                  if (dayRows.length === 1) onOpenNote(rowPath(dayRows[0]));
                  else if (dayRows.length > 1) setDaySheet({ iso, rows: dayRows });
                }}
              >
                <span>{d.getDate()}</span>
                <span className="m-cal-dot" />
              </button>
            );
          })}
        </div>
        <p className="m-hint">{`${columnLabel(dateProp)}`}</p>
      </>
    );
  };

  const [daySheet, setDaySheet] = useState<{ iso: string; rows: Row[] } | null>(null);

  const renderTimeline = () => {
    if (!dateProp) return renderTable();
    const dated = rows!
      .filter((r) => r[dateProp] != null && String(r[dateProp]).trim() !== "")
      .map((r) => ({ r, start: String(r[dateProp]).slice(0, 10), end: endProp && r[endProp] ? String(r[endProp]).slice(0, 10) : null }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const undated = rows!.filter((r) => r[dateProp] == null || String(r[dateProp]).trim() === "");
    let lastDate = "";
    return (
      <>
        {dated.map(({ r, start, end }) => {
          const header = start !== lastDate ? start : null;
          lastDate = start;
          return (
            <div key={rowPath(r)}>
              {header && <p className="m-sectionlabel">{header}</p>}
              <div className="m-row m-row--split">
                <button className="m-row-main" onClick={() => onOpenNote(rowPath(r))}>
                  <span className="m-tl-dot" />
                  <span>{rowTitle(r)}</span>
                </button>
                {end && <span className="m-soon">→ {end}</span>}
              </div>
            </div>
          );
        })}
        {undated.length > 0 && (
          <>
            <p className="m-sectionlabel">{t("database.noEndDate")}</p>
            {undated.map((r) => (
              <button className="m-row" key={rowPath(r)} onClick={() => onOpenNote(rowPath(r))}>
                <span>{rowTitle(r)}</span>
              </button>
            ))}
          </>
        )}
      </>
    );
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1>{title}</h1>
        <span className="m-headactions">
          <button aria-label={t("mobile.newNote")} className="m-iconbtn" onClick={newItem}>
            <Plus size={22} />
          </button>
          <button
            aria-label={t("database.configure")}
            className="m-iconbtn"
            onClick={() => setShowConfig(true)}
          >
            <Settings2 size={22} />
          </button>
        </span>
      </header>

      {render === "graph" && <p className="m-hint">{t("mobile.baseGraphFallback")}</p>}

      {views.length > 1 && (
        <div className="m-viewpills">
          {views.map((v, i) => (
            <button
              className={`m-viewpill${i === viewIndex ? " is-active" : ""}`}
              key={`${v.name ?? ""}-${i}`}
              onClick={() => setViewIndex(i)}
            >
              {v.name || v.type || String(i + 1)}
            </button>
          ))}
        </div>
      )}

      {rows === null ? null : !vault.queryService ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.baseEmpty")}</EmptyState>
      ) : effectiveRender === "gallery" ? (
        renderCards()
      ) : effectiveRender === "list" ? (
        renderList()
      ) : effectiveRender === "board" ? (
        renderBoard()
      ) : effectiveRender === "calendar" ? (
        renderCalendar()
      ) : effectiveRender === "timeline" ? (
        renderTimeline()
      ) : (
        renderTable()
      )}

      {daySheet && (
        <div className="m-sheet-backdrop" onClick={() => setDaySheet(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <p className="m-sheet-title">{daySheet.iso}</p>
            {daySheet.rows.map((r) => (
              <button
                className="m-row"
                key={rowPath(r)}
                onClick={() => {
                  setDaySheet(null);
                  onOpenNote(rowPath(r));
                }}
              >
                <span>{rowTitle(r)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {cellEdit && (
        <CellEditSheet
          onClose={() => setCellEdit(null)}
          onCommit={commitCell}
          rows={rows ?? []}
          target={cellEdit}
          vault={vault}
        />
      )}

      {showConfig && config && (
        <BaseConfigSheet
          columnLabel={columnLabel}
          columnsPool={columnsPool}
          config={config}
          onClose={() => setShowConfig(false)}
          onMutate={mutateConfig}
          onSelectView={setViewIndex}
          vault={vault}
          viewIndex={viewIndex}
        />
      )}
    </div>
  );
}
