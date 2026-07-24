import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Search } from "lucide-react";
import { GraphService, type FolderOverview, type GraphEdgeKind, type VaultGraph } from "@plainva/core";
import {
  buildVaultMapScene,
  createGraphScene,
  DEFAULT_EDGE_KINDS,
  EmptyState,
  type GraphEngineDeps,
  type GraphScene,
} from "@plainva/ui";
import { Waypoints } from "lucide-react";
import { mSelect } from "../services/mobileDialogs";
import { type MobileVault } from "../services/vaultService";

/**
 * Vault map screen (M3E package F, mobile-light): the shared semantic-zoom
 * scene — folder bubbles with counts, notes as nodes, relation/link edges —
 * on the shared canvas engine. A folder tap expands/collapses its bubble,
 * a note tap opens it, one-finger empty drag pans, two-finger pinch zooms,
 * and the search field dims non-matches live (shared filter contract).
 * Desktop-only refinements (facet popover, time replay, cleanup mode, pins)
 * stay on the desktop map.
 */
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
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  // Camera follow for fold/unfold: the tapped folder id, consumed by the
  // next scene rebuild.
  const pendingRevealRef = useRef<string | null>(null);
  const [data, setData] = useState<{ graph: VaultGraph; overview: FolderOverview } | null>(null);
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
  }, [onOpenNote]);

  useEffect(() => {
    if (!vault.queryService) return;
    let alive = true;
    void (async () => {
      try {
        const service = new GraphService(vault.queryService!.db);
        const graph = await service.loadGraph({ includeAttachments: false });
        const overview = await service.getFolderOverview(graph);
        if (alive) setData({ graph, overview });
      } catch {
        /* cold index — the empty state stays */
      }
    })();
    return () => {
      alive = false;
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
      pins: {},
      icons: new Map(),
      filters: {
        query: query.trim().toLowerCase(),
        okfType,
        tagPaths,
        edgeKinds,
      },
      focus: null,
      overlay: { mode: "normal" },
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
  }, [data, expanded, query, okfType, tagPaths, edgeKinds]);

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
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{t("graph.mapTitle")}</h1>
        </header>
      )}
      <div className="m-sheet-inputrow">
        <Search className="m-chevron" size={18} />
        <input
          className="m-searchfield"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("sidebar.searchPlaceholder", { defaultValue: t("mobile.searchHint") })}
          value={query}
        />
      </div>
      {data && (
        <div className="m-gfilters">
          <button
            className={!okfType && !tag && edgeKinds.size === DEFAULT_EDGE_KINDS.length ? "m-chip is-on" : "m-chip"}
            onClick={() => {
              setOkfType(null);
              setTag(null);
              setEdgeKinds(new Set(DEFAULT_EDGE_KINDS));
            }}
          >
            {t("graph.allTypes")}
          </button>
          <button className={okfType ? "m-chip is-on" : "m-chip"} onClick={pickType}>
            {okfType ?? t("graph.filterType")}
          </button>
          <button className={tag ? "m-chip is-on" : "m-chip"} onClick={pickTag}>
            {tag ? "#" + tag : t("graph.filterTag")}
          </button>
          <button
            className={edgeKinds.has("wikilink") ? "m-chip is-on" : "m-chip"}
            onClick={() => toggleEdgeKinds(["wikilink", "markdown-link"])}
          >
            {t("graph.kindLinks")}
          </button>
          <button
            className={edgeKinds.has("property") ? "m-chip is-on" : "m-chip"}
            onClick={() => toggleEdgeKinds(["property"])}
          >
            {t("graph.kindRelations")}
          </button>
          <button
            className={edgeKinds.has("embed") ? "m-chip is-on" : "m-chip"}
            onClick={() => toggleEdgeKinds(["embed"])}
          >
            {t("graph.kindEmbeds")}
          </button>
        </div>
      )}
      {!data ? (
        <EmptyState icon={<Waypoints size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : (
        <div className="m-vaultmap">
          <canvas aria-label={t("graph.mapAria")} ref={canvasRef} />
          <div className="m-zoomers">
            <button aria-label={t("graph.zoomFit")} className="m-zoomer" onClick={() => sceneRef.current?.zoomToFit(30)}>
              ⤢
            </button>
            <button aria-label={t("graph.zoomIn", { defaultValue: "Vergrößern" })} className="m-zoomer" onClick={() => zoomBy(1.3)}>
              ＋
            </button>
            <button aria-label={t("graph.zoomOut", { defaultValue: "Verkleinern" })} className="m-zoomer" onClick={() => zoomBy(1 / 1.3)}>
              −
            </button>
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
