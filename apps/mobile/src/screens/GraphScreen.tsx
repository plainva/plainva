import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GraphService, type FolderOverview, type GraphEdgeKind, type VaultGraph } from "@plainva/core";
import { appendWikiLink, findRelationOptions, getGraphState, loadRelationCatalog, type GraphPin, type GraphStateStore, type RelationOption, type VaultMapOverlay, writeRelationLink } from "@plainva/ui";
import { buildVaultMapScene, Chip, toast, createGraphScene, DEFAULT_EDGE_KINDS, EmptyState, type GraphEngineDeps, type GraphScene, ICON, IconButton, SearchField } from "@plainva/ui";
import { Crosshair, FileText, Maximize2, Minus, PinOff, Plus, Search, Trash2, Link2, Waypoints } from "lucide-react";
import { mConfirm, mSelect } from "../services/mobileDialogs";
import { type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { RowActionSheet } from "../components/RowActionSheet";
import { confirmDeleteFile } from "../lib/deleteFile";
import { shareGraphSvg } from "../services/vaultExport";

/**
 * Vault map screen (M3E package F, mobile-light): the shared semantic-zoom
 * scene — folder bubbles with counts, notes as nodes, relation/link edges —
 * on the shared canvas engine. A folder tap expands/collapses its bubble,
 * a note tap opens it, one-finger empty drag pans, two-finger pinch zooms,
 * and the search field dims non-matches live (shared filter contract).
 *
 * S33–S35 closed the gap to the desktop map: pins, focus depth, heatmap and
 * time replay (S33), node/edge menus, connect-by-drag, lasso selection and SVG
 * export (S34), and the cleanup worklist, which lives on its own screen because
 * three tabs of results do not fit beside a canvas on a phone (S35).
 */
/** The vault map's pin context — the same key the desktop uses, so a vault
 *  opened on both keeps two independent arrangements rather than one that
 *  fights itself (the file is device-local either way). */
const PIN_CONTEXT = "vault";

export function GraphScreen({
  vault,
  bump,
  onBack,
  onMenu,
  onCleanup,
  onOpenNote,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  /** App settings in the leading slot of a root surface (N1.5). */
  onMenu?: () => void;
  /** Opens the cleanup worklist (S35). Absent means the entry stays hidden. */
  onCleanup?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  // Camera follow for fold/unfold: the tapped folder id, consumed by the
  // next scene rebuild.
  // State, not a ref: the node sheet's action list is BUILT during render, and
  // a builder that touches a ref — even inside a click handler — is a render
  // that reads mutable state the compiler cannot reason about.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const [data, setData] = useState<{ graph: VaultGraph; overview: FolderOverview; icons: Map<string, { icon: string; color?: string }>; dates: Map<string, number> } | null>(null);
  // The three tools the map had on the desktop and not here (S33). All three
  // are arguments `buildVaultMapScene` has always taken; the phone passed
  // empty, null and "normal" — a map you cannot pin, narrow or read by age.
  const [pins, setPins] = useState<Record<string, GraphPin>>({});
  const [focus, setFocus] = useState<{ seed: string; depth: number } | null>(null);
  const [overlayMode, setOverlayMode] = useState<"normal" | "heatmap" | "replay">("normal");
  const [replayCutoff, setReplayCutoff] = useState(0);
  // Pinned when the heatmap is switched on, not read per render: "recent"
  // must not drift while the map is open, or the tint shifts under the user.
  const [heatmapNow, setHeatmapNow] = useState(0);
  const [nodeSheet, setNodeSheet] = useState<string | null>(null);
  const [edgeSheet, setEdgeSheet] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  // Local reload after a deletion: `bump` belongs to the shell and does not
  // fire for a change this screen made itself.
  const [reload, setReload] = useState(0);
  const [connect, setConnect] = useState<{ source: string; target: string } | null>(null);
  const selectModeRef = useRef(selectMode);
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);
  // The built scene is kept because the edge sheet needs its bundles DURING
  // render: an edge on screen can stand for several links between the same two
  // notes. State rather than a ref for exactly that reason.
  const [model, setModel] = useState<ReturnType<typeof buildVaultMapScene> | null>(null);
  // The pin store, in state rather than a ref: the node sheet is built during
  // render and needs it. The instance is created once per vault, so the
  // handlers can simply depend on it.
  const [store, setStore] = useState<GraphStateStore | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The drag handler is registered once; it must not close over a stale set.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  const [query, setQuery] = useState("");
  // Facet chips (mockup 7): OKF type, tag and edge kinds — the shared
  // filter contract of buildVaultMapScene, mobile-sized as chips + sheets.
  const [okfType, setOkfType] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [tagPaths, setTagPaths] = useState<Set<string> | null>(null);
  const [edgeKinds, setEdgeKinds] = useState<Set<GraphEdgeKind>>(new Set(DEFAULT_EDGE_KINDS));

  // Tag facet resolves to note paths (the shared filter contract).
  useEffect(() => {
    let alive = true;
    if (!vault.queryService || !tag) {
      setTagPaths(null);
      return;
    }
    vault.queryService
      .getFilesByTag(tag)
      .then((files) => {
        if (alive) setTagPaths(new Set(files.map((x) => x.path)));
      })
      .catch(() => {
        if (alive) setTagPaths(null);
      });
    return () => {
      alive = false;
    };
  }, [vault, tag]);

  useEffect(() => {
    depsRef.current.onNodeClick = (id) => {
      if (!id) return;
      if (id.startsWith("folder:")) {
        // Toggle + camera follow: the tapped folder (bubble or container rim)
        // moves into the viewport after the rebuild instead of the map
        // landing at an arbitrary spot (feedback 2026-07-14).
        const folder = id.slice(7);
        setPendingReveal(id);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(folder)) next.delete(folder);
          else next.add(folder);
          return next;
        });
        return;
      }
      onOpenNote(id);
    };

    // Long press on a node = focus on it. A vault map is unreadable at a
    // thousand nodes; the desktop answers that with a depth-limited
    // neighbourhood, and the argument was always there for the phone too.
    // (S34 grows this into the full node menu — the entry point is the same.)
    depsRef.current.onNodeContext = (id) => setNodeSheet(id);
    // Long press on an EDGE names both ends and lets you open either. A line
    // between two notes is the only thing on this surface you cannot tap your
    // way into otherwise.
    depsRef.current.onEdgeContext = (edgeId) => setEdgeSheet(edgeId);

    // Drag one note onto another = link them. The offer is the shared one:
    // a plain wiki link, plus every `.base` relation whose database holds the
    // source and whose target base holds the target — deciding that twice is
    // how two shells end up writing different files for the same gesture.
    depsRef.current.onNodeDropOnNode = (source, target) => {
      if (source.startsWith("folder:") || target.startsWith("folder:")) return;
      setConnect({ source, target });
    };

    depsRef.current.onLassoSelect = (ids, additive) => {
      // Folders are containers, not documents — a bulk action on them would
      // mean something different from the same action on a note.
      const paths = ids.filter((id) => !id.startsWith("folder:"));
      setSelection((prev) => {
        const next = additive ? [...new Set([...prev, ...paths])] : paths;
        sceneRef.current?.setSelection(next);
        return next;
      });
    };

    depsRef.current.onBackgroundClick = () => {
      setSelection([]);
      sceneRef.current?.setSelection([]);
    };

    // Dragging a node REMEMBERS where it was put. The map's automatic layout
    // is deterministic but not always what a person means; without this the
    // arrangement was lost the moment the scene rebuilt.
    depsRef.current.onNodeDragEnd = (id, x, y) => {
      if (!store) return;
      // An EXPANDED folder is a container: its circle always recomputes around
      // its (pinned) children, so pinning the container itself would fight the
      // layout instead of steering it. Pinning the content is enough.
      if (id.startsWith("folder:") && expandedRef.current.has(id.slice(7))) return;
      // setPin persists itself (debounced); flushing happens on unmount.
      store.setPin(PIN_CONTEXT, id, { x, y });
      setPins({ ...store.getPins(PIN_CONTEXT) });
    };
  }, [onOpenNote, t, store, pins]);

  useEffect(() => {
    if (!vault.queryService) return;
    let alive = true;
    // The store THIS run created — the cleanup must flush that one, not
    // whatever the state happens to hold by then.
    let created: GraphStateStore | null = null;
    void (async () => {
      try {
        const service = new GraphService(vault.queryService!.db);
        const graph = await service.loadGraph({ includeAttachments: false });
        const overview = await service.getFolderOverview(graph);
        // Ages for the heatmap and the replay cutoff — frontmatter date first,
        // file ctime as the fallback, exactly as the desktop reads them.
        const dates = await service.getEffectiveDates().catch(() => new Map<string, number>());
        // Pins live in `.plainva/graph.json` and are DEVICE-LOCAL by design
        // (the folder is excluded from sync everywhere), so a phone keeps its
        // own arrangement without fighting the desktop's.
        const store = getGraphState(vault.files);
        await store.load().catch(() => {});
        created = store;
        setStore(store);
        // The icons a note carries, same as the tree and the search list show
        // them. The map stayed empty here until the engine could draw icon-set
        // references at all (P3.1) — an emoji worked, a "lucide:…" name did not.
        const icons = await vault.queryService!.getDocumentIcons().catch(() => new Map<string, { icon: string; color?: string }>());
        if (alive) {
          setPins(store.getPins(PIN_CONTEXT));
          setData({ graph, overview, icons, dates });
        }
      } catch {
        /* cold index — the empty state stays */
      }
    })();
    return () => {
      alive = false;
      // A pin set a moment before leaving the map must survive it.
      void created?.flush().catch(() => {});
    };
  }, [vault, bump, reload]);

  // Scene lifecycle: create once per data load, rebuild on expand/filter.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    // Selection is a MODE on a phone: there is no modifier key, and an empty
    // drag is the pan gesture people already use. The engine reads the flag at
    // pointer-down, so flipping it does not rebuild the scene.
    const scene = createGraphScene(canvas, depsRef, { lassoOnEmptyDrag: () => selectModeRef.current });
    sceneRef.current = scene;
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas.parentElement ?? canvas);

    // Pinch zoom via the transform API (same approach as the .base graph).
    let pinch: { dist: number; k: number; tx: number; ty: number } | null = null;
    const dist = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const tr = scene.getTransform();
        pinch = { dist: dist(e.touches), k: tr.k, tx: tr.x, ty: tr.y };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const ratio = dist(e.touches) / pinch.dist;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const k = Math.min(4, Math.max(0.1, pinch.k * ratio));
      const applied = k / pinch.k;
      scene.setTransform({
        k,
        x: cx - (cx - pinch.tx) * applied,
        y: cy - (cy - pinch.ty) * applied,
      });
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      ro.disconnect();
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      scene.destroy();
      sceneRef.current = null;
    };
  }, [data]);

  // The age window the replay slider runs over. Empty on a cold index; the
  // slider then simply does not appear rather than showing a dead range.
  const dateRange = useMemo(() => {
    if (!data || data.dates.size === 0) return null;
    const values = [...data.dates.values()];
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [data]);

  useEffect(() => {
    // Start the replay at "everything visible" — beginning at the oldest date
    // would open on an almost empty map and read as a broken graph.
    if (overlayMode === "replay" && dateRange && replayCutoff === 0) setReplayCutoff(dateRange.max);
  }, [overlayMode, dateRange, replayCutoff]);

  const overlay: VaultMapOverlay = useMemo(() => {
    if (overlayMode === "heatmap") return { mode: "heatmap", now: heatmapNow };
    if (overlayMode === "replay" && data) return { mode: "replay", cutoff: replayCutoff || dateRange?.max || 0, dates: data.dates };
    return { mode: "normal" };
  }, [overlayMode, heatmapNow, replayCutoff, data, dateRange]);

  // Scene data: rebuilt on expand/collapse and search; the fit runs only on
  // the first build so panning/expanding never yanks the viewport — except
  // the camera FOLLOWS a just-toggled folder (pendingReveal).
  const fittedRef = useRef(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !data) return;
    const built = buildVaultMapScene({
      graph: data.graph,
      overview: data.overview,
      expanded,
      pins,
      icons: data.icons,
      filters: {
        query: query.trim().toLowerCase(),
        okfType,
        tagPaths,
        edgeKinds,
      },
      focus,
      overlay,
      seed: "vault-map",
    });
    setModel(built);
    scene.setData(built.nodes, built.edges);
    if (!fittedRef.current) {
      fittedRef.current = true;
      scene.zoomToFit(30);
    }
  }, [data, expanded, query, okfType, tagPaths, edgeKinds, pins, focus, overlay]);

  // The camera follow is its own effect so the scene builder does not read a
  // value it does not list: it runs AFTER the rebuild that `model` signals,
  // which is exactly when the toggled folder has its new position.
  useEffect(() => {
    if (!pendingReveal || !model) return;
    sceneRef.current?.revealNode(pendingReveal, 40);
    setPendingReveal(null);
  }, [pendingReveal, model]);

  const pickType = () => {
    const nodes = data ? [...data.graph.nodes.values()] : [];
    const types = [...new Set(nodes.map((n) => n.okfType).filter((x): x is string => !!x))].sort();
    void mSelect({
      title: t("graph.filterType"),
      options: [{ value: "", label: t("graph.allTypes") }, ...types.map((x) => ({ value: x, label: x }))],
      value: okfType ?? "",
    }).then((v) => {
      if (v !== null) setOkfType(v || null);
    });
  };
  const pickTag = () => {
    void (async () => {
      const rows = (await vault.queryService?.getAllTags().catch(() => [])) ?? [];
      const tags = rows.map((r) => r.tag).sort();
      const v = await mSelect({
        title: t("graph.filterTag"),
        options: [{ value: "", label: t("graph.allTags") }, ...tags.map((x) => ({ value: x, label: `#${x}` }))],
        value: tag ?? "",
      });
      if (v !== null) setTag(v || null);
    })();
  };
  const toggleEdgeKinds = (kinds: GraphEdgeKind[]) => {
    setEdgeKinds((prev) => {
      const next = new Set(prev);
      const on = kinds.every((k) => next.has(k));
      for (const k of kinds) {
        if (on) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };
  const zoomBy = (factor: number) => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    const tr = scene.getTransform();
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    const k = Math.min(4, Math.max(0.1, tr.k * factor));
    scene.setTransform({ k, x: cx - ((cx - tr.x) / tr.k) * k, y: cy - ((cy - tr.y) / tr.k) * k });
  };

  /** Offers the link kinds for a connect drag, then writes the chosen one. */
  const runConnect = async (source: string, target: string) => {
    setConnect(null);
    const service = vault.queryService;
    if (!service) return;
    const options = await loadRelationCatalog(vault.files, service)
      .then((catalog) => findRelationOptions(catalog, source, target))
      .catch(() => [] as RelationOption[]);
    const picked = await mSelect({
      title: t("graph.connectTitle", { source: titleOf(source), target: titleOf(target) }),
      options: [
        { value: "", label: t("graph.connectAsText") },
        ...options.map((o) => ({ value: o.propertyKey, label: o.propertyKey })),
      ],
    });
    if (picked === null) return;
    try {
      if (picked === "") {
        await appendWikiLink(vault.files, service, source, target);
      } else {
        const option = options.find((o) => o.propertyKey === picked);
        if (!option) return;
        // A single-value relation REPLACES what is there — say so before doing
        // it, exactly as the desktop does.
        if (option.limitOne) {
          const ok = await mConfirm({
            title: t("graph.connectLimitTitle"),
            message: t("graph.connectLimitMsg", { property: option.propertyKey }),
          });
          if (!ok) return;
        }
        await writeRelationLink(vault.files, service, source, target, option.propertyKey, option.limitOne);
      }
      toast.info(t("graph.connectDone"));
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const exportSvg = async () => {
    const svg = sceneRef.current?.toSVG();
    if (!svg) return;
    try {
      await shareGraphSvg(svg, t("graph.mapTitle"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** Bulk delete goes through the SAME cascade dialog a single note gets —
   *  a selection of ten must not be easier to destroy than one. */
  const deleteSelected = async () => {
    const paths = [...selection];
    for (const path of paths) {
      const ok = await confirmDeleteFile(vault, path, titleOf(path), t);
      if (!ok) break;
    }
    setSelection([]);
    sceneRef.current?.setSelection([]);
    setReload((n) => n + 1);
  };

  const titleOf = (id: string) =>
    id.startsWith("folder:") ? id.slice(7) : data?.graph.nodes.get(id)?.title ?? id;

  const askFocus = (id: string) => {
    void (async () => {
      const depth = await mSelect({
        title: t("graph.focusOn"),
        options: [1, 2, 3].map((d) => ({ value: String(d), label: t("graph.focusActive", { depth: d }) })),
      });
      if (depth !== null) setFocus({ seed: id, depth: Number(depth) });
    })();
  };

  const unpin = (id: string) => {
    if (!store) return;
    store.setPin(PIN_CONTEXT, id, null);
    setPins({ ...store.getPins(PIN_CONTEXT) });
  };

  const nodeActions = (id: string) => {
    const isFolder = id.startsWith("folder:");
    const acts = [];
    if (isFolder) {
      const folder = id.slice(7);
      acts.push({
        icon: <Waypoints size={ICON.head} />,
        label: t(expanded.has(folder) ? "graph.menuCollapseFolder" : "graph.menuExpandFolder"),
        onClick: () => {
          setNodeSheet(null);
          // The ref write lives in the handler, not in the list builder: the
          // list is assembled during render, where a ref must not be touched.
          setPendingReveal(id);
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(folder)) next.delete(folder);
            else next.add(folder);
            return next;
          });
        },
      });
    } else {
      acts.push({
        icon: <FileText size={ICON.head} />,
        label: t("graph.menuOpen"),
        onClick: () => { setNodeSheet(null); onOpenNote(id); },
      });
    }
    acts.push({
      icon: <Crosshair size={ICON.head} />,
      label: t(isFolder ? "graph.menuFocusFolder" : "graph.focusOn"),
      onClick: () => { setNodeSheet(null); askFocus(id); },
    });
    // Only offered when there IS a pin — otherwise it is a button that does
    // nothing, which is worse than an absent one.
    if (pins[id]) {
      acts.push({
        icon: <PinOff size={ICON.head} />,
        label: t("graph.menuUnpin"),
        onClick: () => { setNodeSheet(null); unpin(id); },
      });
    }
    return acts;
  };

  const edgeActions = (edgeId: string) => {
    const entries = model?.bundles.get(edgeId) ?? [];
    const first = entries[0];
    if (!first) return [];
    return [
      { icon: <FileText size={ICON.head} />, label: titleOf(first.source), onClick: () => { setEdgeSheet(null); onOpenNote(first.source); } },
      { icon: <FileText size={ICON.head} />, label: titleOf(first.target), onClick: () => { setEdgeSheet(null); onOpenNote(first.target); } },
    ];
  };

  return (
    <div className="m-page m-page--graph">
      {/* No search action: the map carries its own live filter field below, and
          a second search in the header would be a different search. */}
      <AppBar large={!onBack} onBack={onBack} onMenu={onMenu} title={t("graph.mapTitle")} />
      <div className="m-sheet-inputrow">
        <Search className="m-chevron" size={ICON.head} />
        <SearchField
          clearLabel={t("sidebar.clearSearch")}
          onValueChange={setQuery}
          placeholder={t("sidebar.searchNotes")}
          value={query}
        />
      </div>
      {data && (
        <div className="m-gfilters">
          <Chip
            selected={!okfType && !tag && edgeKinds.size === DEFAULT_EDGE_KINDS.length}
            onClick={() => {
              setOkfType(null);
              setTag(null);
              setEdgeKinds(new Set(DEFAULT_EDGE_KINDS));
            }}
          >
            {t("graph.allTypes")}
          </Chip>
          <Chip selected={!!okfType} onClick={pickType}>
            {okfType ?? t("graph.filterType")}
          </Chip>
          <Chip selected={!!tag} onClick={pickTag}>
            {tag ? "#" + tag : t("graph.filterTag")}
          </Chip>
          <Chip
            selected={edgeKinds.has("wikilink")}
            onClick={() => toggleEdgeKinds(["wikilink", "markdown-link"])}
          >
            {t("graph.kindLinks")}
          </Chip>
          <Chip selected={edgeKinds.has("property")} onClick={() => toggleEdgeKinds(["property"])}>
            {t("graph.kindRelations")}
          </Chip>
          <Chip selected={edgeKinds.has("embed")} onClick={() => toggleEdgeKinds(["embed"])}>
            {t("graph.kindEmbeds")}
          </Chip>
          {/* Reading the map by AGE. Heatmap tints every node by how recently
              it changed; replay hides everything newer than the cutoff, so the
              vault can be watched growing. Both are arguments the scene has
              always taken. */}
          <Chip
            selected={overlayMode === "heatmap"}
            onClick={() => {
              setHeatmapNow(Date.now());
              setOverlayMode((m) => (m === "heatmap" ? "normal" : "heatmap"));
            }}
          >
            {t("graph.heatmap")}
          </Chip>
          {dateRange && (
            <Chip
              selected={overlayMode === "replay"}
              onClick={() => setOverlayMode((m) => (m === "replay" ? "normal" : "replay"))}
            >
              {t("graph.replay")}
            </Chip>
          )}
          {focus && (
            <Chip selected onClick={() => setFocus(null)}>
              {t("graph.focusActive", { depth: focus.depth })}
            </Chip>
          )}
          {/* Selection needs a mode here: a phone has no modifier key, and an
              empty drag is already the pan gesture. */}
          <Chip
            selected={selectMode}
            onClick={() => {
              setSelectMode((v) => !v);
              if (selectMode) {
                setSelection([]);
                sceneRef.current?.setSelection([]);
              }
            }}
          >
            {t("graph.selectMode")}
          </Chip>
          {onCleanup && <Chip onClick={onCleanup}>{t("graph.cleanupTitle")}</Chip>}
          <Chip onClick={() => void exportSvg()}>{t("graph.exportSvg")}</Chip>
        </div>
      )}
      {selection.length > 0 && (
        <div className="m-selectbar">
          <span>{t("graph.bulkSelected", { n: selection.length })}</span>
          <IconButton label={t("common.delete")} onClick={() => void deleteSelected()}>
            <Trash2 size={ICON.head} />
          </IconButton>
        </div>
      )}
      {overlayMode === "replay" && dateRange && (
        <div className="m-sliderrow">
          <input
            aria-label={t("graph.replay")}
            className="m-slider"
            max={dateRange.max}
            min={dateRange.min}
            onChange={(e) => setReplayCutoff(Number(e.target.value))}
            step={86400000}
            type="range"
            value={replayCutoff || dateRange.max}
          />
          <span className="m-prop-val">
            {new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "short", day: "numeric" }).format(
              new Date(replayCutoff || dateRange.max)
            )}
          </span>
        </div>
      )}
      {/* NOT "coming in a later step": the map is built, it needs the search
          index — which the browser fallback has none of and a cold vault has
          not finished yet. Telling the user a shipped feature does not exist is
          the one thing an empty state must not do. */}
      {!data ? (
        <EmptyState icon={<Waypoints size={ICON.head} />}>{t("graph.needsIndex")}</EmptyState>
      ) : (
        <div className="m-vaultmap">
          <canvas aria-label={t("graph.mapAria")} ref={canvasRef} />
          <div className="m-zoomers">
            <IconButton
              className="pv-iconbtn--raised"
              label={t("graph.zoomFit")}
              onClick={() => sceneRef.current?.zoomToFit(30)}
            >
              <Maximize2 size={ICON.touch} />
            </IconButton>
            <IconButton
              className="pv-iconbtn--raised"
              label={t("graph.zoomIn")}
              onClick={() => zoomBy(1.3)}
            >
              <Plus size={ICON.touch} />
            </IconButton>
            <IconButton
              className="pv-iconbtn--raised"
              label={t("graph.zoomOut")}
              onClick={() => zoomBy(1 / 1.3)}
            >
              <Minus size={ICON.touch} />
            </IconButton>
          </div>
          <div className="m-glegend">
            <em>
              <i /> {t("graph.legendRelation")}
            </em>
            <em>
              <i className="is-dash" /> {t("graph.legendLink")}
            </em>
          </div>
        </div>
      )}
      {connect && (
        <RowActionSheet
          title={t("graph.connectMenu")}
          onClose={() => setConnect(null)}
          actions={[
            {
              icon: <Link2 size={ICON.head} />,
              label: t("graph.connectTitle", { source: titleOf(connect.source), target: titleOf(connect.target) }),
              onClick: () => void runConnect(connect.source, connect.target),
            },
          ]}
        />
      )}
      {nodeSheet && (
        <RowActionSheet title={titleOf(nodeSheet)} onClose={() => setNodeSheet(null)} actions={nodeActions(nodeSheet)} />
      )}
      {edgeSheet && edgeActions(edgeSheet).length > 0 && (
        <RowActionSheet title={t("graph.menuOpen")} onClose={() => setEdgeSheet(null)} actions={edgeActions(edgeSheet)} />
      )}
    </div>
  );
}
