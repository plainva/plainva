import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  GanttChart,
  LayoutGrid,
  List,
  Plus,
  Settings2,
  StickyNote,
  Table,
  Waypoints,
  Copy,
  ExternalLink,
  PanelRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { listPimEvents } from "../../services/pim/pimService";
import { parseWikiLinkValue, buildSubItemsTree, Button, capitalizeFirst, Chip, eventDayKeys, chipPaletteIndex, EmptyState, Fab, formatDateValue, ICON, IconButton, inferType, toPropId, orderBoardGroups, SectionLabel, Segmented, splitMultiValue, type SubItemNode, UNGROUPED_KEY } from "@plainva/ui";
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
import { reloadActiveMobileVault, vaultOps, type MobileVault } from "../../services/vaultService";
import { boardDropValue } from "./boardDrag";
import { MobileBaseGraph } from "./MobileBaseGraph";
import { PinboardView } from "./PinboardView";
import { CellEditSheet, type CellEditTarget } from "./CellEditSheet";
import { PropertyEditSheet } from "./PropertyEditSheet";
import { BaseConfigSheet } from "./BaseConfigSheet";
import { isoOf } from "../../lib/dates";
import { usePullToRefresh } from "../../lib/usePullToRefresh";
import { buildMonthCells, startOfMonth } from "@plainva/ui";
import { AppBar } from "../../components/AppBar";
import { LONG_PRESS_MS } from "../../lib/useLongPress";
import { RowActionSheet } from "../../components/RowActionSheet";
import { confirmDeleteFile } from "../../lib/deleteFile";
import { mPrompt } from "../../services/mobileDialogs";
import { buildEntryPeek } from "./entryPeek";
import { EntryPeekSheet } from "./EntryPeekSheet";

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
  pinboard: StickyNote,
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
  /** Long-press target (S20): the entry menu, shared by every view. */
  const [rowMenu, setRowMenu] = useState<{ path: string; title: string } | null>(null);
  /** The peeked entry, by path — the model is rebuilt from the live rows. */
  const [peekPath, setPeekPath] = useState<string | null>(null);
  /** Expanded sub-item rows (S22) — app-side, default collapsed like desktop. */
  const [expandedSubItems, setExpandedSubItems] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSubItemExpand = (p: string) =>
    setExpandedSubItems((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()));
  // Real appointments behind the calendar view (S18b). Device-local: a way of
  // looking, not part of the database.
  const [showEvents, setShowEvents] = useState(false);
  const [eventBackdrop, setEventBackdrop] = useState<Map<string, { count: number }>>(new Map());
  useEffect(() => {
    let alive = true;
    if (!showEvents) {
      setEventBackdrop(new Map());
      return;
    }
    const from = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1).getTime();
    const to = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1).getTime();
    void listPimEvents(from, to)
      .then((rows) => {
        if (!alive) return;
        const map = new Map<string, { count: number }>();
        for (const row of rows) {
          // A span counts on every day it covers — the question is "what else
          // is on this day".
          for (const key of eventDayKeys(row)) map.set(key, { count: (map.get(key)?.count ?? 0) + 1 });
        }
        setEventBackdrop(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showEvents, calMonth]);
  const config = loaded?.config;
  // Memoized so downstream memo/callback deps stay referentially stable
  // (react-hooks lint since the pinboard's patchActiveView joined, P6).
  const views: any[] = useMemo(() => (Array.isArray(config?.views) ? config.views : []), [config]);
  const view: any = useMemo(() => views[viewIndex] ?? {}, [views, viewIndex]);
  // Pull-to-refresh re-queries through the m-vault-changed listener below.
  // Off on the graph view: its page is a non-scrolling flex column and the
  // canvas owns one-finger drags (pan), so PTR would otherwise fire on a pan.
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(
    ptrRef,
    undefined,
    String(view.plainva?.render ?? view.type ?? "table") !== "graph",
  );

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
  /** The view's sub-items key (S22) — absent means a flat table. */
  const subItemsProperty: string | null =
    typeof view.subItemsProperty === "string" && view.subItemsProperty ? view.subItemsProperty : null;

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

  // ── Entry actions (S20; desktop parity with issue #34) ──────────────────
  // Until now a database could only OPEN a note: renaming or deleting an entry
  // meant leaving the base, finding the file and coming back. The menu hangs on
  // one delegated listener so every view offers the same actions — a hold means
  // the same thing on a table row, a card and a timeline entry.
  const renameEntry = useCallback(
    async (p: string, current: string) => {
      const answer = await mPrompt({ title: t("common.rename"), initial: current });
      const next = answer.value.trim();
      if (answer.cancelled || next === "" || next === current) return;
      try {
        const newPath = await vaultOps.rename(vault, p, next);
        setPeekPath((cur) => (cur === p ? newPath : cur));
        requery(config, viewIndex);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [vault, config, viewIndex, requery, t],
  );

  const duplicateEntry = useCallback(
    async (p: string) => {
      try {
        await vaultOps.duplicateNote(vault, p);
        requery(config, viewIndex);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [vault, config, viewIndex, requery],
  );

  const deleteEntry = useCallback(
    async (p: string, title: string) => {
      // The shared cascade flow: an entry can be a relation target, and the
      // large-deletion prompts must behave as they do everywhere else.
      const done = await confirmDeleteFile(vault, p, title, t).catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : String(e));
        return false;
      });
      if (done) {
        setPeekPath((cur) => (cur === p ? null : cur));
        requery(config, viewIndex);
      }
    },
    [vault, config, viewIndex, requery, t],
  );

  const newItem = () => {
    if (!config) return;
    void createBaseItem(vault, path, config, rows?.length ?? 0, viewIndex).then((p) => {
      if (p) onOpenNote(p);
      else setShowConfig(true); // no folder source to store into
    });
  };

  // Pinboard view options (plan Pinboard P6): patch the active view
  // (pinboardOrder/pinboardPinned), keep the in-memory config in sync and
  // persist through the shared serialize contract. `undefined` deletes a key.
  const patchActiveView = useCallback(
    (patch: Record<string, unknown>) => {
      if (!config || !loaded) return;
      const next = JSON.parse(JSON.stringify(config));
      const v = Array.isArray(next.views) ? next.views[viewIndex] : null;
      if (!v) return;
      for (const [k, val] of Object.entries(patch)) {
        if (val === undefined) delete v[k];
        else v[k] = val;
      }
      setLoaded({ config: next, stem: loaded.stem });
      void saveBaseConfig(vault, path, next);
    },
    [config, loaded, viewIndex, vault, path],
  );

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
          className="pv-card pv-card--flat m-basecard-prop"
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

  // One delegated hold listener for every row-shaped view (table/list/cards/
  // calendar/timeline). The board and the pinboard keep their own, because a
  // hold there already means "drag" — they open the same menu from their own
  // gesture instead of competing for it.
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const d = { timer: null as number | null, x: 0, y: 0 };
    const clear = () => {
      if (d.timer !== null) window.clearTimeout(d.timer);
      d.timer = null;
    };
    const onDown = (e: PointerEvent) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row-path]");
      const rp = row?.dataset.rowPath;
      if (!rp) return;
      const title = row!.dataset.rowTitle ?? rp;
      d.x = e.clientX;
      d.y = e.clientY;
      d.timer = window.setTimeout(() => {
        d.timer = null;
        // A hold can start a native text selection in the WebView; clear it so
        // the sheet does not open over marked text.
        window.getSelection?.()?.removeAllRanges();
        haptics.medium();
        setRowMenu({ path: rp, title });
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      // Movement before the hold fires is a scroll — give the gesture back.
      if (d.timer !== null && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) clear();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", clear);
    el.addEventListener("pointercancel", clear);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", clear);
      el.removeEventListener("pointercancel", clear);
      clear();
    };
  }, []);

  const renderTable = () => {
    // Sub-items (S22): when the view names a parent property, the rows nest
    // through the SHARED tree — same cycle guard, same "parent outside the
    // result set is a top-level row" rule the desktop applies.
    const nodes: SubItemNode<Row>[] = subItemsProperty
      ? buildSubItemsTree(rows!, {
          keyOf: (r) => rowPath(r),
          titleOf: (r) => rowTitle(r),
          parentRefOf: (r) => r[subItemsProperty],
          expandedKeys: expandedSubItems,
        })
      : rows!.map((row) => ({ row, depth: 0, hasChildren: false, childCount: 0, isExpanded: false }));
    return (
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
          {nodes.map((n) => {
            const r = n.row;
            return (
            <tr data-row-path={rowPath(r)} data-row-title={rowTitle(r)} key={rowPath(r)}>
              <td onClick={() => onOpenNote(rowPath(r))} style={n.depth > 0 ? { paddingLeft: `calc(var(--pad-cell) + ${n.depth} * var(--space-4))` } : undefined}>
                {n.hasChildren && (
                  <IconButton
                    label={t("database.subItemsCountTooltip", { count: n.childCount })}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSubItemExpand(rowPath(r));
                    }}
                  >
                    {n.isExpanded ? <ChevronDown size={ICON.meta} /> : <ChevronRight size={ICON.meta} />}
                  </IconButton>
                )}
                {rowTitle(r)}
              </td>
              {orderedColumns.map((c) => (
                <td key={c} onClick={() => openCellEditor(r, c)}>
                  {displayCell(c, r[c])}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    );
  };

  const renderList = () => (
    <>
      {rows!.map((r) => (
        <div className="m-row m-row--split" data-row-path={rowPath(r)} data-row-title={rowTitle(r)} key={rowPath(r)}>
          <button className="m-row-main" onClick={() => onOpenNote(rowPath(r))}>
            <span>{rowTitle(r)}</span>
          </button>
          {orderedColumns[0] && (
            <Chip onClick={() => openCellEditor(r, orderedColumns[0])}>
              {displayCell(orderedColumns[0], r[orderedColumns[0]]) || "—"}
            </Chip>
          )}
        </div>
      ))}
    </>
  );

  const renderCards = () => (
    <div className="pv-card pv-card--flat m-basecards">
      {rows!.map((r) => (
        <div className="pv-card pv-card--flat m-basecard" data-row-path={rowPath(r)} data-row-title={rowTitle(r)} key={rowPath(r)}>
          {coverUrls[rowPath(r)] && (
            <img alt="" className="pv-card pv-card--flat m-basecard-cover" src={coverUrls[rowPath(r)]} />
          )}
          <button className="pv-card pv-card--flat m-basecard-title" onClick={() => onOpenNote(rowPath(r))}>
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
      }, LONG_PRESS_MS);
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
      } else if (d.armed && drag && !drag.overKey) {
        // Held without moving to another column: the same entry menu the other
        // views open on a hold (S20) — the gesture keeps one meaning.
        setRowMenu({ path: drag.path, title: drag.title });
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
        <span className="pv-card pv-card--flat m-basecard-mini">
          {chips.map((x: { c: string; text: string }) => (
            <Chip size="sm" tone="muted" key={x.c}>
              {x.text.length > 16 ? `${x.text.slice(0, 16)}…` : x.text}
            </Chip>
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
                  className={`pv-card pv-card--flat m-basecard${boardDrag?.path === rowPath(r) ? " is-dragging" : ""}`}
                  data-group-key={key}
                  data-row-path={rowPath(r)}
                  data-row-title={rowTitle(r)}
                  key={rowPath(r)}
                >
                  <button className="pv-card pv-card--flat m-basecard-title" onClick={() => onOpenNote(rowPath(r))}>
                    {rowTitle(r)}
                  </button>
                  <Chip
                    onClick={() => openCellEditor(r, groupBy)}
                    style={
                      dotFor(key) && key !== UNGROUPED_KEY
                        ? { background: tintForChip(key), color: "var(--text-main)" }
                        : undefined
                    }
                  >
                    {cellText(r[groupBy]) || "—"}
                  </Chip>
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
            <IconButton
              label={t("calendar.prevMonth")}
              onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            >
              <ChevronLeft size={ICON.head} />
            </IconButton>
            <button className="m-cal-today" onClick={() => setCalMonth(startOfMonth(new Date()))}>
              {t("calendar.today")}
            </button>
            <IconButton
              label={t("calendar.nextMonth")}
              onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            >
              <ChevronRight size={ICON.head} />
            </IconButton>
            {/* Real appointments as a backdrop (S18b, the other direction):
                planning inside a database is easier when the day says what it
                already holds. Off by default and device-local — a way of
                looking, not part of the view's configuration. */}
            <IconButton
              label={t("database.showEvents", { defaultValue: "Termine im Hintergrund" })}
              aria-pressed={showEvents}
              data-testid="base-toggle-events"
              onClick={() => setShowEvents((v) => !v)}
            >
              <CalendarRange size={ICON.head} style={{ color: showEvents ? "var(--accent-color)" : undefined }} />
            </IconButton>
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
                {showEvents && (eventBackdrop.get(iso)?.count ?? 0) > 0 ? (
                  <span className="m-cal-backdrop" data-testid="base-event-backdrop">
                    {eventBackdrop.get(iso)!.count}
                  </span>
                ) : null}
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
              {header && <SectionLabel>{header}</SectionLabel>}
              <div className="m-row m-row--split" data-row-path={rowPath(r)} data-row-title={rowTitle(r)}>
                <button className="m-row-main" onClick={() => onOpenNote(rowPath(r))}>
                  <span className="m-tl-dot" />
                  <span>{rowTitle(r)}</span>
                </button>
                {end && <span className="m-badge-muted">→ {end}</span>}
              </div>
            </div>
          );
        })}
        {undated.length > 0 && (
          <>
            <SectionLabel>{t("database.noEndDate")}</SectionLabel>
            {undated.map((r) => (
              <button className="m-row" data-row-path={rowPath(r)} data-row-title={rowTitle(r)} key={rowPath(r)} onClick={() => onOpenNote(rowPath(r))}>
                <span>{rowTitle(r)}</span>
              </button>
            ))}
          </>
        )}
      </>
    );
  };

  return (
    <div className={`m-page${effectiveRender === "graph" ? " m-page--basegraph" : ""}`} ref={ptrRef}>
      {ptrIndicator}
      <Fab
        className="m-fab-float m-fab-float--above-tabs m-fab-float--pill"
        icon={<Plus size={ICON.head} />}
        label={t("database.newItem", { defaultValue: "+" })}
        onClick={newItem}
      />
      <AppBar
        onBack={onBack}
        title={title}
        actions={
          <IconButton label={t("database.configure")} onClick={() => setShowConfig(true)}>
            <Settings2 size={ICON.touch} />
          </IconButton>
        }
      />

      {render === "graph" && !vaultGraph && <p className="m-hint">{t("mobile.baseGraphFallback")}</p>}

      {views.length > 1 && (
        <Segmented
          ariaLabel={t("database.views")}
          options={views.map((v, i) => {
            const render = (v.plainva as { render?: string } | undefined)?.render;
            const Icon = VIEW_ICON[render ?? String(v.type ?? "table")] ?? Table;
            return {
              value: String(i),
              icon: <Icon size={ICON.ui} />,
              label: v.name || v.type || String(i + 1),
            };
          })}
          value={String(viewIndex)}
          onChange={(v) => setViewIndex(Number(v))}
        />
      )}

      <div ref={rowsRef} className="m-baserows">
      {rows === null ? null : !vault.queryService ? (
        /* NOT "coming in a later step": databases are shipped, this vault's
           search index simply is not there yet — a `.base` is a QUERY, and the
           query service is what the failed index build takes with it (N7). */
        <EmptyState
          action={
            <Button data-testid="base-needs-index-retry" onClick={() => void reloadActiveMobileVault()} variant="tonal">
              {t("sync.retryNow")}
            </Button>
          }
          icon={<Database size={ICON.head} />}
        >
          {t("mobile.needsIndex")}
        </EmptyState>
      ) : effectiveRender === "pinboard" ? (
        // Before the empty check: the capture field must show on an empty board.
        <PinboardView
          vault={vault}
          config={config}
          view={view}
          rows={rows}
          propCols={orderedColumns}
          columnLabel={columnLabel}
          displayCell={displayCell}
          onOpenNote={onOpenNote}
          onMutated={() => requery(config, viewIndex)}
          onPatchView={patchActiveView}
          onNeedsConfig={() => setShowConfig(true)}
        />
      ) : rows.length === 0 ? (
        /* The one action a database view can offer is the row it is missing —
           the same flow the "+" in the bar runs (N7). */
        <EmptyState
          action={
            <Button data-testid="base-empty-new" onClick={newItem} variant="tonal">
              {t("database.newItem")}
            </Button>
          }
          icon={<Database size={ICON.head} />}
        >
          {t("mobile.baseEmpty")}
        </EmptyState>
      ) : effectiveRender === "graph" ? (
        <MobileBaseGraph
          adapter={vault.files}
          columnLabel={columnLabel}
          graph={vaultGraph}
          onOpenNote={onOpenNote}
          rows={rows}
          // Same pin context as the desktop: `.base` path plus view name, so
          // one database keeps one arrangement per view across both shells.
          seed={`base:${path}#${view?.name ?? ""}`}
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
      </div>

      {daySheet && (
        <div className="m-sheet-backdrop" onClick={() => setDaySheet(null)}>
          <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setDaySheet(null)} />
            <p className="m-sheet-title">{daySheet.iso}</p>
            {daySheet.rows.map((r) => (
              <button
                className="m-row"
                data-row-path={rowPath(r)}
                data-row-title={rowTitle(r)}
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

      {rowMenu && (
        <RowActionSheet
          title={rowMenu.title}
          onClose={() => setRowMenu(null)}
          actions={[
            { icon: <ExternalLink size={ICON.head} />, label: t("database.entryOpen"), onClick: () => { const m = rowMenu; setRowMenu(null); onOpenNote(m.path); } },
            { icon: <PanelRight size={ICON.head} />, label: t("rightPanel.properties"), onClick: () => { const m = rowMenu; setRowMenu(null); setPeekPath(m.path); } },
            { icon: <Pencil size={ICON.head} />, label: t("database.entryRename"), onClick: () => { const m = rowMenu; setRowMenu(null); void renameEntry(m.path, m.title); } },
            { icon: <Copy size={ICON.head} />, label: t("database.entryDuplicate"), onClick: () => { const m = rowMenu; setRowMenu(null); void duplicateEntry(m.path); } },
            { icon: <Trash2 size={ICON.head} />, label: t("database.entryDelete"), danger: true, onClick: () => { const m = rowMenu; setRowMenu(null); void deleteEntry(m.path, m.title); } },
          ]}
        />
      )}

      {peekPath && rows && (() => {
        const peek = buildEntryPeek(rows, orderedColumns, peekPath);
        // The row can vanish under an open sheet (deleted, filtered out) — then
        // there is nothing honest left to show.
        if (!peek) return null;
        return (
          <EntryPeekSheet
            peek={peek}
            columnLabel={columnLabel}
            displayCell={displayCell}
            isEditable={(col) => !col.startsWith("file.") && !isReverse(col)}
            onEdit={(col) => {
              const row = rows.find((r) => rowPath(r) === peek.path);
              if (row) openCellEditor(row, col);
            }}
            onStep={setPeekPath}
            onOpen={() => { setPeekPath(null); onOpenNote(peek.path); }}
            onClose={() => setPeekPath(null)}
          />
        );
      })()}

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
          basePath={path}
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
