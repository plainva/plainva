import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { VaultGraph } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { MenuItem, MenuLabel, MenuSurface } from "../ui/Menu";
import { createGraphScene, type GraphEngineDeps, type GraphScene } from "../graph/graphEngine";
import { getGraphState } from "../../services/graphState";
import { buildBaseGraphScene } from "./baseGraphScene";
import { columnLabel } from "./baseViewerShared";

/**
 * `.base` view type "graph" (P8, decision E7 — the USP: Obsidian's Bases has
 * no graph view). Nodes are the view's filtered rows; edges are the selected
 * relation properties (optionally plus plain wiki links). Color follows a
 * select property (chip palette order), size a number property. Persisted
 * Obsidian-compatibly as `type: table` + `views[i].plainva.render: "graph"`
 * with the option sub-keys — Obsidian shows the table, Plainva the net.
 */

export interface BaseGraphViewProps {
  /** The view's filtered rows (row objects with `file.path` etc.). */
  dbData: any[];
  dbConfig: any;
  /** The active in-memory view object (holds graphEdges/graphColorBy/…). */
  activeView: any;
  /** Relation property keys available in this base. */
  relationKeys: string[];
  /** Select/status property keys (color-by options). */
  selectKeys: string[];
  /** Number property keys (size-by options). */
  numberKeys: string[];
  onOpenNote: (path: string) => void;
  onDropToSplit?: (path: string) => void;
  /** Patches the active view's graph options and persists the config. */
  onPatchView: (patch: Record<string, unknown>) => void;
}

export function BaseGraphView({ dbData, dbConfig, activeView, relationKeys, selectKeys, numberKeys, onOpenNote, onDropToSplit, onPatchView }: BaseGraphViewProps) {
  const { t } = useTranslation();
  const { graphService, vaultAdapter } = useVault();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  // The pin context we last fitted the viewport for. zoomToFit runs only when
  // this changes (a different base/view), never on a data or pin update.
  const fitKeyRef = useRef<string | null>(null);
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [edgePopover, setEdgePopover] = useState<{ x: number; y: number; source: string; target: string; label?: string } | null>(null);
  const graphState = vaultAdapter ? getGraphState(vaultAdapter) : null;
  const pinContext = `base:${dbConfig?._path ?? dbConfig?.name ?? "?"}#${activeView?.name ?? ""}`;

  const edgeKeys: string[] = useMemo(
    () => (Array.isArray(activeView?.graphEdges) && activeView.graphEdges.length > 0 ? activeView.graphEdges : relationKeys),
    [activeView, relationKeys]
  );
  const showWikiLinks = edgeKeys.includes("@wiki");
  const showExternal = activeView?.graphShowExternal === true;
  const showIncoming = activeView?.graphShowIncoming === true;
  const colorBy: string | null = activeView?.graphColorBy ?? null;
  const sizeBy: string | null = activeView?.graphSizeBy ?? null;

  useEffect(() => {
    let alive = true;
    graphService
      ?.loadGraph({ includeAttachments: false })
      .then((g) => {
        if (alive) setGraph(g);
      })
      .catch(() => {
        if (alive) setGraph(null);
      });
    return () => {
      alive = false;
    };
  }, [graphService, dbData]);

  const sceneModel = useMemo(() => {
    if (!graph) return null;
    return buildBaseGraphScene({
      rows: dbData,
      graph,
      edgeKeys: edgeKeys.filter((k) => k !== "@wiki"),
      showWikiLinks,
      showExternal,
      showIncoming,
      colorBy,
      sizeBy,
      pins: graphState?.getPins(pinContext) ?? {},
      seed: pinContext,
      labelForKey: (k) => columnLabel(k, t, dbConfig),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, dbData, edgeKeys, showWikiLinks, showExternal, showIncoming, colorBy, sizeBy, graphState, pinContext]);

  useLayoutEffect(() => {
    depsRef.current = {
      reducedMotion: () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
      onNodeClick: (id, ev) => {
        if (ev.ctrl && onDropToSplit) onDropToSplit(id);
        else onOpenNote(id);
      },
      onNodeActivate: (id) => onOpenNote(id),
      onNodeDragEnd: (id, x, y) => {
        graphState?.setPin(pinContext, id, { x, y });
        // Persist only; the engine keeps the dragged position this session and
        // the next rebuild applies the pin. Not forcing a rebuild here avoids
        // re-solving the force layout (which would shuffle the unpinned nodes).
        sceneRef.current?.patchNode(id, { pinned: true });
      },
      // Edges act here too (report #5): click lists source/target to open.
      onEdgeClick: (edgeId, x, y) => {
        const edge = sceneModel?.edges.find((e) => e.id === edgeId);
        if (edge) setEdgePopover({ x, y, source: edge.source, target: edge.target, label: edge.label });
      },
      onBackgroundClick: () => setEdgePopover(null),
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createGraphScene(canvas, depsRef);
    sceneRef.current = scene;
    return () => {
      // Persist a pin dragged right before the view unmounts (tab close / view
      // switch); the store write is debounced 800ms otherwise.
      void graphState?.flush();
      scene.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sceneModel) return;
    // Fit only when the graph's context changes (a different base or view),
    // never on a data or pin update — otherwise dragging a node past the
    // current bounds re-centered the entire view (report 2026-07-09).
    const isNewContext = fitKeyRef.current !== pinContext;
    scene.setData(sceneModel.nodes, sceneModel.edges, { animate: !isNewContext });
    if (isNewContext) {
      scene.zoomToFit(30);
      fitKeyRef.current = pinContext;
    }
  }, [sceneModel, pinContext]);

  const toggleEdgeKey = (key: string) => {
    const active = new Set(edgeKeys);
    if (active.has(key)) active.delete(key);
    else active.add(key);
    onPatchView({ graphEdges: [...active] });
  };

  const label = (key: string) => columnLabel(key, t, dbConfig);

  // Incoming cross-DB relations (report 2026-07-07): available regardless of
  // whether this base has its own relation columns — the counterparts live in
  // other databases (e.g. a project's tasks point in via their own relation).
  const incomingToggle = (
    <label className="pv-checkrow" style={{ gap: "var(--space-1)" }} data-tip={t("graph.baseShowIncomingTip", { defaultValue: "Auch Notizen aus anderen Datenbanken zeigen, deren Relation auf Einträge dieser Ansicht verweist (z. B. die Aufgaben eines Projekts)" })}>
      <input
        type="checkbox"
        className="pv-check"
        checked={showIncoming}
        onChange={() => onPatchView({ graphShowIncoming: !showIncoming })}
        data-testid="base-graph-incoming"
      />
      {t("graph.baseShowIncoming", { defaultValue: "Eingehende Relationen" })}
    </label>
  );

  return (
    <div data-testid="base-graph-view" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-3)", padding: "var(--space-1) var(--space-3)", borderBottom: "1px solid var(--border-color-light)", fontSize: "var(--text-sm)", minHeight: "var(--control-lg)" }}>
        {relationKeys.length > 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-faint)", fontWeight: 700, fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("graph.baseEdges", { defaultValue: "Kanten" })}
            </span>
            {relationKeys.map((key) => (
              <label key={key} className="pv-checkrow" style={{ gap: "var(--space-1)" }}>
                <input type="checkbox" className="pv-check" checked={edgeKeys.includes(key)} onChange={() => toggleEdgeKey(key)} data-testid={`base-graph-edge-${key}`} />
                {label(key)}
              </label>
            ))}
            <label className="pv-checkrow" style={{ gap: "var(--space-1)" }}>
              <input type="checkbox" className="pv-check" checked={showWikiLinks} onChange={() => toggleEdgeKey("@wiki")} />
              {t("graph.kindLinks", { defaultValue: "Links" })}
            </label>
            <label className="pv-checkrow" style={{ gap: "var(--space-1)" }} data-tip={t("graph.baseShowExternalTip", { defaultValue: "Auch Notizen zeigen, auf die eine Relation außerhalb dieser Ansicht zeigt" })}>
              <input
                type="checkbox"
                className="pv-check"
                checked={showExternal}
                onChange={() => onPatchView({ graphShowExternal: !showExternal })}
                data-testid="base-graph-external"
              />
              {t("graph.baseShowExternal", { defaultValue: "Externe Ziele" })}
            </label>
            {incomingToggle}
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-muted)" }}>
              <Info size={14} />
              {t("graph.baseNoRelations", { defaultValue: "Diese Datenbank hat keine Relationen — die Kanten zeigen Wiki-Links zwischen den Einträgen." })}
            </span>
            {incomingToggle}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {selectKeys.length > 0 && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-muted)" }} data-tip={t("graph.baseColorByTip", { defaultValue: "Knoten nach dem Wert einer Auswahl-Eigenschaft einfärben" })}>
            {t("graph.baseColorBy", { defaultValue: "Farbe nach" })}
            <select className="pv-field pv-field--select" style={{ width: "auto", minWidth: 110 }} value={colorBy ?? ""} onChange={(e) => onPatchView({ graphColorBy: e.target.value || undefined })} aria-label={t("graph.baseColorBy", { defaultValue: "Farbe nach" })}>
              <option value="">—</option>
              {selectKeys.map((k) => (
                <option key={k} value={k}>{label(k)}</option>
              ))}
            </select>
          </label>
        )}
        {numberKeys.length > 0 && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-muted)" }} data-tip={t("graph.baseSizeByTip", { defaultValue: "Knotengröße nach dem Wert einer Zahlen-Eigenschaft skalieren" })}>
            {t("graph.baseSizeBy", { defaultValue: "Größe nach" })}
            <select className="pv-field pv-field--select" style={{ width: "auto", minWidth: 110 }} value={sizeBy ?? ""} onChange={(e) => onPatchView({ graphSizeBy: e.target.value || undefined })} aria-label={t("graph.baseSizeBy", { defaultValue: "Größe nach" })}>
              <option value="">—</option>
              {numberKeys.map((k) => (
                <option key={k} value={k}>{label(k)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-label={t("graph.baseAria", { defaultValue: "Graph-Ansicht der Datenbank" })}
          data-testid="base-graph-canvas"
          style={{ width: "100%", height: "100%", display: "block", outline: "none" }}
        />
      </div>
      {edgePopover && (
        <MenuSurface open onClose={() => setEdgePopover(null)} at={{ x: edgePopover.x, y: edgePopover.y }} minWidth={220} ariaLabel={t("graph.edgeMenu", { defaultValue: "Verknüpfungs-Aktionen" })}>
          <MenuLabel>
            {(graph?.nodes.get(edgePopover.source)?.title ?? edgePopover.source)} → {(graph?.nodes.get(edgePopover.target)?.title ?? edgePopover.target)}
            {edgePopover.label ? ` · ${edgePopover.label}` : ""}
          </MenuLabel>
          <MenuItem onSelect={() => { onOpenNote(edgePopover.source); setEdgePopover(null); }}>{t("graph.edgeOpenSource", { defaultValue: "Quelle öffnen" })}</MenuItem>
          <MenuItem onSelect={() => { onOpenNote(edgePopover.target); setEdgePopover(null); }}>{t("graph.edgeOpenTarget", { defaultValue: "Ziel öffnen" })}</MenuItem>
        </MenuSurface>
      )}
    </div>
  );
}
