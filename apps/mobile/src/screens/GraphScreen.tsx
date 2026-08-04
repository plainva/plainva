import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minus, Plus, Search } from "lucide-react";
import { GraphService, type FolderOverview, type GraphEdgeKind, type VaultGraph } from "@plainva/core";
import { getGraphState, type GraphPin, type GraphStateStore, type VaultMapOverlay } from "@plainva/ui";
import { buildVaultMapScene, Chip, createGraphScene, DEFAULT_EDGE_KINDS, EmptyState, type GraphEngineDeps, type GraphScene, ICON, IconButton, SearchField } from "@plainva/ui";
import { Waypoints } from "lucide-react";
import { mSelect } from "../services/mobileDialogs";
import { type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

/**
 * Vault map screen (M3E package F, mobile-light): the shared semantic-zoom
 * scene — folder bubbles with counts, notes as nodes, relation/link edges —
 * on the shared canvas engine. A folder tap expands/collapses its bubble,
 * a note tap opens it, one-finger empty drag pans, two-finger pinch zooms,
 * and the search field dims non-matches live (shared filter contract).
 * Desktop-only refinements (facet popover, time replay, cleanup mode, pins)
 * stay on the desktop map.
 */
/** The vault map's pin context — the same key the desktop uses, so a vault
 *  opened on both keeps two independent arrangements rather than one that
 *  fights itself (the file is device-local either way). */
const PIN_CONTEXT = "vault";

export function GraphScreen({
  vault,
  bump,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  // Camera follow for fold/unfold: the tapped folder id, consumed by the
  // next scene rebuild.
  const pendingRevealRef = useRef<string | null>(null);
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
  const stateRef = useRef<GraphStateStore | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
        pendingRevealRef.current = id;
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
    depsRef.current.onNodeContext = (id) => {
      void (async () => {
        const depth = await mSelect({
          title: t("graph.focusOn"),
          options: [1, 2, 3].map((d) => ({ value: String(d), label: t("graph.focusActive", { depth: d }) })),
        });
        if (depth !== null) setFocus({ seed: id, depth: Number(depth) });
      })();
    };

    // Dragging a node REMEMBERS where it was put. The map's automatic layout
    // is deterministic but not always what a person means; without this the
    // arrangement was lost the moment the scene rebuilt.
    depsRef.current.onNodeDragEnd = (id, x, y) => {
      const store = stateRef.current;
      if (!store) return;
      // setPin persists itself (debounced); flushing happens on unmount.
      store.setPin(PIN_CONTEXT, id, { x, y });
      setPins({ ...store.getPins(PIN_CONTEXT) });
    };
  }, [onOpenNote, t]);

  useEffect(() => {
    if (!vault.queryService) return;
    let alive = true;
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
        stateRef.current = store;
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
      void stateRef.current?.flush().catch(() => {});
    };
  }, [vault, bump]);

  // Scene lifecycle: create once per data load, rebuild on expand/filter.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const scene = createGraphScene(canvas, depsRef);
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
  // the camera FOLLOWS a just-toggled folder (pendingRevealRef).
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
    scene.setData(built.nodes, built.edges);
    if (!fittedRef.current) {
      fittedRef.current = true;
      scene.zoomToFit(30);
    }
    const reveal = pendingRevealRef.current;
    if (reveal) {
      pendingRevealRef.current = null;
      scene.revealNode(reveal, 40);
    }
  }, [data, expanded, query, okfType, tagPaths, edgeKinds, pins, focus, overlay]);

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

  return (
    <div className="m-page m-page--graph">
      {/* No search action: the map carries its own live filter field below, and
          a second search in the header would be a different search. */}
      <AppBar large={!onBack} onBack={onBack} title={t("graph.mapTitle")} />
      <div className="m-sheet-inputrow">
        <Search className="m-chevron" size={ICON.head} />
        <SearchField
          clearLabel={t("sidebar.clearSearch")}
          onValueChange={setQuery}
          placeholder={t("sidebar.searchPlaceholder", { defaultValue: t("mobile.searchHint") })}
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
              label={t("graph.zoomIn", { defaultValue: "Vergrößern" })}
              onClick={() => zoomBy(1.3)}
            >
              <Plus size={ICON.touch} />
            </IconButton>
            <IconButton
              className="pv-iconbtn--raised"
              label={t("graph.zoomOut", { defaultValue: "Verkleinern" })}
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
    </div>
  );
}
