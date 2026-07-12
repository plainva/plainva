import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  GanttChart,
  LayoutGrid,
  List,
  Plus,
  Settings2,
  Table,
  Waypoints,
} from "lucide-react";
import {
  capitalizeFirst,
  chipPaletteIndex,
  EmptyState,
  inferType,
  orderBoardGroups,
  splitMultiValue,
  formatDateValue,
  toPropId,
  UNGROUPED_KEY,
  parseWikiLinkValue,
} from "@plainva/ui";
import { haptics } from "../../services/haptics";
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
import { boardDropValue } from "./boardDrag";
import { MobileBaseGraph } from "./MobileBaseGraph";
import { CellEditSheet, type CellEditTarget } from "./CellEditSheet";
import { PropertyEditSheet } from "./PropertyEditSheet";
import { BaseConfigSheet } from "./BaseConfigSheet";
import { isoOf } from "../../lib/dates";
import { usePullToRefresh } from "../../lib/usePullToRefresh";
import { buildMonthCells, startOfMonth } from "@plainva/ui";

type Row = Record<string, any>;

/**
 * Full .base experience on mobile (R4, E5 "all views"): table/list/cards/
 * board/calendar/timeline render natively over the shared core query;
 * cells edit through typed sheets, the view configures desktop-style and
 * every write goes through the shared serialize contract + sync chain.
 * `graph` (canvas engine, desktop-only for now) falls back to the table.
 */
const VIEW_ICON: Record<string, typeof Table> = {
  table: Table,
  list: List,
  cards: LayoutGrid,
  board: Columns3,
  calendar: CalendarDays,
  timeline: GanttChart,
  graph: Waypoints,
};

export function BaseScreen({
  vault,
  path,
  onBack,
  onOpenNote,
  initialConfigOpen,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
  /** Fresh databases open with the configure sheet up (E3 mini wizard). */
  initialConfigOpen?: boolean;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.base$/i, "");
  const [loaded, setLoaded] = useState<LoadedBase | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cellEdit, setCellEdit] = useState<CellEditTarget | null>(null);
  const [showConfig, setShowConfig] = useState(!!initialConfigOpen);
  const [propEdit, setPropEdit] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()));
  // Pull-to-refresh re-queries through the m-vault-changed listener below.
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

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

  /** Cell display honoring the per-view date format (E3, desktop contract). */
  const displayCell = (col: string, v: unknown): string => {
    if (v == null || v === "") return "";
    const input = columnInput(col, v);
    if (input === "date" || input === "datetime") {
      const fmt = (view.dateFormat ?? "default") as "default" | "long" | "iso" | "relative";
      return formatDateValue(String(v), input === "datetime", i18nInstance.language, fmt);
    }
    return cellText(v);
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
    void createBaseItem(vault, path, config, rows?.length ?? 0, viewIndex).then((p) => {
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
  // Package F: the graph view renders natively over the shared engine now;
  // it needs the resolved vault graph (relation edges) from the core service.
  const [vaultGraph, setVaultGraph] = useState<any | null>(null);
  useEffect(() => {
    if (render !== "graph" || !vault.queryService) return;
    let stale = false;
    void import("@plainva/core").then(({ GraphService }) =>
      new GraphService(vault.queryService!.db).loadGraph().then((g) => {
        if (!stale) setVaultGraph(g);
      }),
    );
    return () => {
      stale = true;
    };
  }, [render, vault, rows]);
  const effectiveRender = render === "graph" ? (vaultGraph ? "graph" : "table") : render === "cards" || render === "card" ? "gallery" : render;

  // Gallery cover images (E3, desktop views[i].coverImage contract): the
  // cover column's value resolves to a vault file and loads as a blob URL.
  const coverCol =
    effectiveRender === "gallery" && view.coverImage ? String(view.coverImage) : null;
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const coverUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!coverCol || !rows || rows.length === 0) {
      coverUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      coverUrlsRef.current = [];
      setCoverUrls({});
      return;
    }
    let stale = false;
    const created: string[] = [];
    const MIME: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      avif: "image/avif",
    };
    void (async () => {
      const next: Record<string, string> = {};
      for (const r of rows.slice(0, 60)) {
        const raw = r[coverCol];
        const first = Array.isArray(raw) ? raw[0] : raw;
        if (!first) continue;
        let rel = String(first)
          .trim()
          .replace(/^!?\[\[/, "")
          .replace(/\]\]$/, "")
          .split("|")[0];
        if (!rel) continue;
        try {
          if (!(await vault.files.exists(rel))) {
            const resolved = await vaultOps.resolveWikiTarget(vault, rel);
            if (!resolved) continue;
            rel = resolved;
          }
          const ext = rel.split(".").pop()?.toLowerCase() ?? "";
          if (!(ext in MIME)) continue;
          const bin = await vault.adapter.readBinaryFile(rel);
          const url = URL.createObjectURL(new Blob([bin as BlobPart], { type: MIME[ext] }));
          created.push(url);
          next[rowPath(r)] = url;
        } catch {
          /* not an image or unreadable — the card just shows no cover */
        }
      }
      if (stale) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      coverUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      coverUrlsRef.current = created;
      setCoverUrls(next);
    })();
    return () => {
      stale = true;
    };
  }, [coverCol, rows, vault]);
  useEffect(
    () => () => {
      coverUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  /* ---------------- renderers ---------------- */

  const propLine = (r: Row, cols: string[], max: number) =>
    cols.slice(0, max).map((c) =>
      displayCell(c, r[c]) ? (
        <button
          className="m-basecard-prop"
          key={c}
          onClick={(e) => {
            e.stopPropagation();
            openCellEditor(r, c);
          }}
        >
          <span className="m-prop-key">{columnLabel(c)}</span> {displayCell(c, r[c])}
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
                  {displayCell(c, r[c])}
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
              {displayCell(orderedColumns[0], r[orderedColumns[0]]) || "—"}
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
          {coverUrls[rowPath(r)] && (
            <img alt="" className="m-basecard-cover" src={coverUrls[rowPath(r)]} />
          )}
          <button className="m-basecard-title" onClick={() => onOpenNote(rowPath(r))}>
            {rowTitle(r)}
          </button>
          {propLine(r, orderedColumns, 3)}
        </div>
      ))}
    </div>
  );

  const boardGroupBy: string | null =
    view.groupBy ??
    columnsPool.find((c) => columnInput(c) === "select" && c.toLowerCase() === "status") ??
    columnsPool.find((c) => columnInput(c) === "select") ??
    null;

  // Board card drag (E1, desktop parity): long-press arms, moving carries a
  // ghost, dropping on another column rewrites the groupBy value through the
  // same commit path as the cell editor. One delegated listener set on the
  // board container — cards stay scrollable until the press arms.
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardDrag, setBoardDrag] = useState<{
    path: string;
    fromKey: string;
    title: string;
    x: number;
    y: number;
    overKey: string | null;
  } | null>(null);
  const dragRef = useRef<{ armed: boolean; timer: ReturnType<typeof setTimeout> | null; startX: number; startY: number }>(
    { armed: false, timer: null, startX: 0, startY: 0 },
  );
  const boardDragRef = useRef(boardDrag);
  useEffect(() => {
    boardDragRef.current = boardDrag;
  }, [boardDrag]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el || view.type !== "board" || !boardGroupBy || !rows) return;
    const d = dragRef.current;
    const clear = () => {
      if (d.timer) clearTimeout(d.timer);
      d.timer = null;
      d.armed = false;
      setBoardDrag(null);
    };
    const onDown = (e: PointerEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".m-basecard");
      if (!card || !card.dataset.rowPath) return;
      d.startX = e.clientX;
      d.startY = e.clientY;
      const payload = {
        path: card.dataset.rowPath,
        fromKey: card.dataset.groupKey ?? UNGROUPED_KEY,
        title: card.dataset.rowTitle ?? "",
      };
      d.timer = setTimeout(() => {
        d.armed = true;
        haptics.medium();
        setBoardDrag({ ...payload, x: d.startX, y: d.startY, overKey: null });
      }, 350);
    };
    const onMove = (e: PointerEvent) => {
      if (!d.armed) {
        // Real movement before the arm = a scroll; give the gesture back.
        if (d.timer && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) {
          clearTimeout(d.timer);
          d.timer = null;
        }
        return;
      }
      const colEl = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-board-key]");
      setBoardDrag((prev) =>
        prev ? { ...prev, x: e.clientX, y: e.clientY, overKey: colEl?.dataset.boardKey ?? null } : prev,
      );
      // Auto-scroll the horizontal board near its edges.
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left + 48) el.scrollLeft -= 12;
      else if (e.clientX > rect.right - 48) el.scrollLeft += 12;
    };
    const onTouchMove = (e: TouchEvent) => {
      // Own the gesture once armed; before that the board scrolls normally.
      if (d.armed && e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      const drag = boardDragRef.current;
      if (d.armed && drag && drag.overKey && drag.overKey !== drag.fromKey) {
        const row = rows.find((r) => rowPath(r) === drag.path);
        if (row) {
          const next = boardDropValue(row[boardGroupBy], drag.fromKey, drag.overKey);
          haptics.light();
          void commitCellValue(vault, drag.path, boardGroupBy, next).then(() => requery(config, viewIndex));
        }
      }
      clear();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("touchmove", onTouchMove);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, boardGroupBy, view.type, config, viewIndex, vault]);

  const renderBoard = () => {
    const groupBy = boardGroupBy;
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
    const optionMeta: any[] = config?.columns?.[groupBy]?.options ?? [];
    const options = optionMeta.map((o: any) => String(o.value));
    for (const o of options) if (!groups.has(o)) groups.set(o, []);
    const orderKeys = orderBoardGroups([...groups.keys()], {
      optionOrder: options.length ? options : undefined,
      savedOrder: Array.isArray(view.boardColumnOrder) ? view.boardColumnOrder : undefined,
    });
    // Column color mode (E1, WP3 parity): "column" tints the whole list with
    // the option's chip palette color; only option-backed group columns tint.
    const colorMode: "chip" | "column" = view.boardColorMode === "column" ? "column" : "chip";
    const groupInput = columnInput(groupBy);
    const tintable =
      colorMode === "column" && (groupInput === "select" || groupInput === "status" || groupInput === "multiselect");
    const tintFor = (key: string): string | undefined => {
      if (!tintable || key === UNGROUPED_KEY) return undefined;
      const opt = optionMeta.find((o: any) => String(o.value) === key);
      return `var(--chip-${chipPaletteIndex(key, opt?.color)}-bg)`;
    };
    const dotFor = (key: string): string | undefined => {
      if (key === UNGROUPED_KEY) return undefined;
      if (groupInput !== "select" && groupInput !== "status" && groupInput !== "multiselect") return undefined;
      const opt = optionMeta.find((o: any) => String(o.value) === key);
      return `var(--chip-${chipPaletteIndex(key, opt?.color)}-fg)`;
    };
    const tintForChip = (key: string): string | undefined => {
      const opt = optionMeta.find((o: any) => String(o.value) === key);
      return `var(--chip-${chipPaletteIndex(key, opt?.color)}-bg)`;
    };
    const boardMiniChips = (r: Record<string, unknown>, group: string) => {
      const cols = orderedColumns.filter((c: string) => c !== group).slice(0, 2);
      const chips = cols
        .map((c: string) => ({ c, text: cellText(r[c]) }))
        .filter((x: { c: string; text: string }) => x.text);
      if (chips.length === 0) return null;
      return (
        <span className="m-basecard-mini">
          {chips.map((x: { c: string; text: string }) => (
            <span className="m-minichip" key={x.c}>
              {x.text.length > 16 ? `${x.text.slice(0, 16)}…` : x.text}
            </span>
          ))}
        </span>
      );
    };
    return (
      <div className="m-board" ref={boardRef}>
        {orderKeys.map((key) => {
          const tint = tintFor(key);
          return (
            <div
              className={`m-board-col${boardDrag?.overKey === key && boardDrag.fromKey !== key ? " is-over" : ""}`}
              data-board-key={key}
              key={key}
              style={tint ? { background: tint } : undefined}
            >
              <p className="m-board-head">
                {dotFor(key) && <span className="m-board-dot" style={{ background: dotFor(key) }} />}
                {key === UNGROUPED_KEY ? t("database.noEndDate") : key}
                <span className="m-board-count">· {groups.get(key)!.length}</span>
              </p>
              {groups.get(key)!.map((r) => (
                <div
                  className={`m-basecard${boardDrag?.path === rowPath(r) ? " is-dragging" : ""}`}
                  data-group-key={key}
                  data-row-path={rowPath(r)}
                  data-row-title={rowTitle(r)}
                  key={rowPath(r)}
                >
                  <button className="m-basecard-title" onClick={() => onOpenNote(rowPath(r))}>
                    {rowTitle(r)}
                  </button>
                  <button
                    className="m-cellchip"
                    onClick={() => openCellEditor(r, groupBy)}
                    style={
                      dotFor(key) && key !== UNGROUPED_KEY
                        ? { background: tintForChip(key), color: "var(--text-main)" }
                        : undefined
                    }
                  >
                    {cellText(r[groupBy]) || "—"}
                  </button>
                  {boardMiniChips(r, groupBy)}
                </div>
              ))}
            </div>
          );
        })}
        {boardDrag && (
          <div aria-hidden className="m-board-ghost" style={{ left: boardDrag.x, top: boardDrag.y }}>
            {boardDrag.title}
          </div>
        )}
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
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      <button className="m-fab-float m-fab-float--above-tabs m-fab-float--pill" onClick={newItem}>
        <Plus size={18} /> {t("database.newItem", { defaultValue: "+" })}
      </button>
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1>{title}</h1>
        <span className="m-headactions">
          <button
            aria-label={t("database.configure")}
            className="m-iconbtn"
            onClick={() => setShowConfig(true)}
          >
            <Settings2 size={22} />
          </button>
        </span>
      </header>

      {render === "graph" && !vaultGraph && <p className="m-hint">{t("mobile.baseGraphFallback")}</p>}

      {views.length > 1 && (
        <div className="m-viewpills">
          {views.map((v, i) => (
            <button
              className={`m-viewpill${i === viewIndex ? " is-active" : ""}`}
              key={`${v.name ?? ""}-${i}`}
              onClick={() => setViewIndex(i)}
            >
              {(() => {
                const render = (v.plainva as { render?: string } | undefined)?.render;
                const Icon = VIEW_ICON[render ?? String(v.type ?? "table")] ?? Table;
                return <Icon size={14} />;
              })()}
              {v.name || v.type || String(i + 1)}
            </button>
          ))}
        </div>
      )}

      {rows === null ? null : !vault.queryService ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.baseEmpty")}</EmptyState>
      ) : effectiveRender === "graph" ? (
        <MobileBaseGraph
          columnLabel={columnLabel}
          graph={vaultGraph}
          onOpenNote={onOpenNote}
          rows={rows}
          seed={path}
          view={view}
        />
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
          onEditProperty={setPropEdit}
          onMutate={mutateConfig}
          onSelectView={setViewIndex}
          vault={vault}
          viewIndex={viewIndex}
        />
      )}

      {propEdit && config && (
        <PropertyEditSheet
          basePath={path}
          column={propEdit}
          columnLabel={columnLabel}
          config={config}
          onClose={() => setPropEdit(null)}
          onMutate={mutateConfig}
          onReload={() => {
            void loadBase(vault, path).then(setLoaded);
          }}
          rowPaths={(rows ?? []).map((r) => rowPath(r)).filter(Boolean)}
          rows={rows ?? []}
          vault={vault}
        />
      )}
    </div>
  );
}
