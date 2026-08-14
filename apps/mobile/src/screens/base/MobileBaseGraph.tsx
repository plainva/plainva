import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Maximize2, Minus, PinOff, Plus } from "lucide-react";
import type { IVaultAdapter, VaultGraph } from "@plainva/core";
import {
  buildBaseGraphScene,
  createGraphScene,
  getGraphState,
  type GraphEngineDeps,
  type GraphPin,
  type GraphScene,
  type GraphStateStore,
  ICON,
  IconButton,
} from "@plainva/ui";
import { RowActionSheet } from "../../components/RowActionSheet";

/**
 * Mobile `.base` graph view — the seventh view type, touch sized.
 *
 * The scene builder and the canvas engine are the shared ones; what S35 adds
 * is the rest of the map's grammar, which this surface was missing while the
 * vault map had all of it:
 *
 *  - **Pins persist.** `pins: {}` was hardcoded, so an arrangement someone
 *    dragged into shape was gone the moment the view rebuilt. The context key
 *    is the desktop's, `base:<path>#<view>` — a database opened in both places
 *    keeps ONE arrangement per view rather than two that disagree.
 *  - **The viewport stops jumping.** `zoomToFit` ran on every rebuild, and a
 *    drag IS a rebuild: pinning a node re-fitted the camera out from under the
 *    finger that had just placed it. It now runs only when the context changes
 *    (the desktop's `fitKeyRef`, same reason).
 *  - **Zoom buttons, a legend and the node sheet**, because a canvas without
 *    them is a picture: pinch was the only way in, nothing said what a solid
 *    versus a dashed edge means, and a node dragged into place could never be
 *    let go of again. The sheet is the vault map's, unchanged — long press a
 *    node, open it or release its pin.
 */
export function MobileBaseGraph({
  rows,
  graph,
  view,
  seed,
  adapter,
  columnLabel,
  onOpenNote,
}: {
  rows: any[];
  graph: VaultGraph;
  view: any;
  /** Pin/fit context — the `.base` path plus the active view's name. */
  seed: string;
  adapter: IVaultAdapter;
  columnLabel: (col: string) => string;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  const fitKeyRef = useRef<string | null>(null);
  const [store, setStore] = useState<GraphStateStore | null>(null);
  const [pins, setPins] = useState<Record<string, GraphPin>>({});
  const [nodeSheet, setNodeSheet] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const gs = getGraphState(adapter);
    void gs.load().then(() => {
      if (!alive) return;
      setStore(gs);
      setPins(gs.getPins(seed));
    });
    return () => {
      alive = false;
      void gs.flush();
    };
  }, [adapter, seed]);

  useEffect(() => {
    depsRef.current.onNodeClick = (id) => {
      if (id && !id.startsWith("ext:")) onOpenNote(id);
    };
    depsRef.current.onNodeContext = (id) => setNodeSheet(id);
    depsRef.current.onNodeDragEnd = (id, x, y) => {
      if (!store) return;
      store.setPin(seed, id, { x, y });
      // Patch, do NOT re-set the pins state: the node is already where the
      // finger left it, and a rebuild here would re-run the layout around it.
      // The sheet reads the store directly, so it still sees the new pin.
      sceneRef.current?.patchNode(id, { pinned: true });
    };
  }, [onOpenNote, seed, store]);

  const unpin = (id: string) => {
    if (!store) return;
    store.setPin(seed, id, null);
    // Here the rebuild is the point: the node has to fall back into the force
    // layout, which only a fresh scene can do.
    setPins({ ...store.getPins(seed) });
  };

  const nodeActions = (id: string) => {
    const acts = [
      {
        icon: <FileText size={ICON.head} />,
        label: t("mobile.sheetOpen"),
        onClick: () => {
          setNodeSheet(null);
          if (!id.startsWith("ext:")) onOpenNote(id);
        },
      },
    ];
    // Offered only when there IS a pin — a button that does nothing is worse
    // than an absent one (the vault map's rule, applied here too).
    if (store?.getPins(seed)[id]) {
      acts.push({
        icon: <PinOff size={ICON.head} />,
        label: t("graph.menuUnpin"),
        onClick: () => {
          setNodeSheet(null);
          unpin(id);
        },
      });
    }
    return acts;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createGraphScene(canvas, depsRef);
    sceneRef.current = scene;

    const pv = view?.plainva ?? {};
    const built = buildBaseGraphScene({
      rows,
      graph,
      edgeKeys: Array.isArray(pv.graphEdges) ? pv.graphEdges : [],
      showWikiLinks: pv.graphShowWikiLinks !== false,
      showExternal: pv.graphShowExternal === true,
      showIncoming: pv.graphShowIncoming === true,
      colorBy: typeof pv.graphColorBy === "string" ? pv.graphColorBy : undefined,
      sizeBy: typeof pv.graphSizeBy === "string" ? pv.graphSizeBy : undefined,
      pins,
      seed,
      labelForKey: columnLabel,
    });
    scene.setData(built.nodes, built.edges);
    // Only on a genuine context change: a pin write rebuilds the scene, and
    // re-fitting there would move the map every time someone places a node.
    if (fitKeyRef.current !== seed) {
      scene.zoomToFit(30);
      fitKeyRef.current = seed;
    }

    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas.parentElement ?? canvas);


    return () => {
      ro.disconnect();
      scene.destroy();
      sceneRef.current = null;
    };
    // Rebuild whenever the data or the view's graph options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, graph, view, seed, pins]);

  const zoomBy = (factor: number) => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    const tr = scene.getTransform();
    const k = Math.min(4, Math.max(0.1, tr.k * factor));
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    const applied = k / tr.k;
    scene.setTransform({ k, x: cx - (cx - tr.x) * applied, y: cy - (cy - tr.y) * applied });
  };

  return (
    <div className="m-basegraph">
      <canvas aria-label={t("mobile.tabDatabases")} ref={canvasRef} />
      <div className="m-zoomers">
        <IconButton
          className="pv-iconbtn--raised"
          label={t("graph.zoomFit")}
          onClick={() => sceneRef.current?.zoomToFit(30)}
        >
          <Maximize2 size={ICON.touch} />
        </IconButton>
        <IconButton className="pv-iconbtn--raised" label={t("graph.zoomIn")} onClick={() => zoomBy(1.3)}>
          <Plus size={ICON.touch} />
        </IconButton>
        <IconButton className="pv-iconbtn--raised" label={t("graph.zoomOut")} onClick={() => zoomBy(1 / 1.3)}>
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
      {nodeSheet && (
        <RowActionSheet
          actions={nodeActions(nodeSheet)}
          onClose={() => setNodeSheet(null)}
          title={nodeSheet.split("/").pop()?.replace(/\.md$/i, "") ?? nodeSheet}
        />
      )}
    </div>
  );
}
