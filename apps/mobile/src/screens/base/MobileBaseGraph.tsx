import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { VaultGraph } from "@plainva/core";
import {
  buildBaseGraphScene,
  createGraphScene,
  type GraphEngineDeps,
  type GraphScene,
} from "@plainva/ui";

/**
 * Mobile .base graph view (M3E package F): the SHARED canvas engine and
 * scene builder render the database rows as nodes with relation edges —
 * the desktop's seventh view type, touch sized. One-finger drag on empty
 * space pans (engine default), a node tap opens the note, and a two-finger
 * pinch zooms via the engine's transform API (no engine changes, so the
 * desktop stays untouched).
 */
export function MobileBaseGraph({
  rows,
  graph,
  view,
  seed,
  columnLabel,
  onOpenNote,
}: {
  rows: any[];
  graph: VaultGraph;
  view: any;
  seed: string;
  columnLabel: (col: string) => string;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  useEffect(() => {
    depsRef.current.onNodeClick = (id) => {
      if (id && !id.startsWith("ext:")) onOpenNote(id);
    };
  }, [onOpenNote]);

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
      pins: {},
      seed,
      labelForKey: columnLabel,
    });
    scene.setData(built.nodes, built.edges);
    scene.zoomToFit(30);

    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas.parentElement ?? canvas);

    // Two-finger pinch on the container: ratio of touch distances scales the
    // transform around the midpoint (engine transform API, F touch gestures).
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
    // Rebuild whenever the data or the view's graph options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, graph, view, seed]);

  return (
    <div className="m-basegraph">
      <canvas aria-label={t("mobile.tabDatabases")} ref={canvasRef} />
    </div>
  );
}
