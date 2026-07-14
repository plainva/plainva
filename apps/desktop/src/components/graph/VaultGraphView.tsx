import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Eraser, Flame, History, Maximize2, SlidersHorizontal, Waypoints, X } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile as fsWriteFile, writeTextFile as fsWriteTextFile } from "@tauri-apps/plugin-fs";
import type { FolderOverview, GraphEdgeKind, VaultGraph } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { MenuItem, MenuSurface } from "@plainva/ui";
import { BasePeekModal } from "../BasePeekModal";
import { appConfirm, appPrompt } from "../../services/appDialogs";
import { toast } from "@plainva/ui";
import { renameFileWithLinkUpdates } from "../../services/renameNote";
import { createConnectedNote, removeLinksTo } from "../../services/graphActions";
import { loadGraphCached } from "../../services/graphCache";
import { removeRelationLink } from "../../services/graphRelationTargets";
import { getConfiguredNoteType } from "../../services/newNote";
import { getGraphState } from "../../services/graphState";
import { createGraphScene, type GraphEngineDeps, type GraphScene } from "@plainva/ui";
import { hashSeed } from "@plainva/ui";
import { CleanupPanel } from "./CleanupPanel";
import { PinModeToggle } from "./PinModeToggle";
import { GraphCanvasMenu, GraphConnectMenu, GraphEdgeMenu, GraphFolderMenu, GraphNodeMenu, type CanvasMenuState, type ConnectDropState, type EdgeMenuState, type FolderMenuState, type NodeMenuState } from "./GraphMapMenus";
import {
  buildVaultMapScene,
  DEFAULT_EDGE_KINDS,
  effectiveDate,
  type VaultMapOverlay,
  type VaultMapScene,
} from "@plainva/ui";

/**
 * Vault map (P4/P5): semantic zoom over the real folder structure. Folders
 * are bubbles; double-clicking unfolds one level. Facet bar (D4: type, tag,
 * edge kinds, live-dimming search), focus mode (seed + depth), time overlays
 * (heatmap/replay) and pinned positions per device.
 */

const PIN_CONTEXT = "vault";

export interface VaultGraphViewProps {
  onOpenPath: (path: string, newTab?: boolean) => void;
  onOpenInSplit?: (path: string) => void;
  onToggleBookmark?: (path: string) => void;
}

interface MapData {
  graph: VaultGraph;
  overview: FolderOverview;
  icons: Map<string, { icon: string; color?: string }>;
  dates: Map<string, number>;
  orphanCount: number;
}

export function VaultGraphView({ onOpenPath, onOpenInSplit, onToggleBookmark }: VaultGraphViewProps) {
  const { t } = useTranslation();
  const { graphService, queryService, vaultAdapter, vaultPath, fileTreeVersion } = useVault();
  const graphState = vaultAdapter ? getGraphState(vaultAdapter) : null;

  const [data, setData] = useState<MapData | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [okfType, setOkfType] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  // Facet popover (P7.1): filters moved off the always-visible bar.
  const [showFilters, setShowFilters] = useState(false);
  const filterPopRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showFilters) return;
    const onDown = (e: PointerEvent) => {
      if (!filterPopRef.current?.contains(e.target as Node)) setShowFilters(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [showFilters]);
  const [tagPaths, setTagPaths] = useState<Set<string> | null>(null);
  const [edgeKinds, setEdgeKinds] = useState<Set<GraphEdgeKind>>(new Set(DEFAULT_EDGE_KINDS));
  // Managed index.md/log.md are hidden by default (they link to everything);
  // the toggle is remembered device-locally.
  const [showIndexNotes, setShowIndexNotes] = useState<boolean>(
    () => typeof localStorage !== "undefined" && localStorage.getItem("plainva-graph-show-index") === "1"
  );
  const [focus, setFocus] = useState<{ seed: string; depth: number } | null>(null);
  const [overlayMode, setOverlayMode] = useState<"normal" | "heatmap" | "replay">("normal");
  // Sampled ONCE when the heatmap toggles on (render must stay pure).
  const [heatmapNow, setHeatmapNow] = useState(0);
  const [replayCutoff, setReplayCutoff] = useState<number>(0);
  const [pinsTick, setPinsTick] = useState(0);
  const [pinMode, setPinModeState] = useState(true);
  const [bundlePopover, setBundlePopover] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
  const [connectDrop, setConnectDrop] = useState<ConnectDropState | null>(null);
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const [showCleanup, setShowCleanup] = useState(false);
  const [highlight, setHighlight] = useState<{ paths: Set<string>; flag: "orphan" | "broken" | null }>({ paths: new Set(), flag: null });
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string>("");
  const lineCache = useRef(new Map<string, string[]>());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  const fitOnceRef = useRef(false);

  // ---- data -------------------------------------------------------------------

  useEffect(() => {
    if (!graphService || !queryService) return;
    let alive = true;
    (async () => {
      try {
        await graphState?.load();
        if (alive && graphState) setPinModeState(graphState.getPinMode(PIN_CONTEXT));
        // Shared version-keyed cache with the context sidebar (P2.6).
        const graph = await loadGraphCached(graphService, fileTreeVersion, { includeAttachments: false });
        const [overview, icons, dates, orphans] = await Promise.all([
          graphService.getFolderOverview(graph),
          queryService.getDocumentIcons(),
          graphService.getEffectiveDates(),
          graphService.getOrphans(graph),
        ]);
        if (alive) setData({ graph, overview, icons, dates, orphanCount: orphans.length });
      } catch {
        if (alive) setData(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [graphService, queryService, graphState, fileTreeVersion]);

  useEffect(() => {
    let alive = true;
    if (!queryService || !tag) {
      setTagPaths(null);
      return;
    }
    queryService
      .getFilesByTag(tag)
      .then((files) => {
        if (alive) setTagPaths(new Set(files.map((f) => f.path)));
      })
      .catch(() => {
        if (alive) setTagPaths(null);
      });
    return () => {
      alive = false;
    };
  }, [queryService, tag, fileTreeVersion]);

  // Replay range from the data.
  const dateRange = useMemo(() => {
    if (!data) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const node of data.graph.nodes.values()) {
      if (node.mode === "attachment") continue;
      const d = effectiveDate(node.path, data.graph, data.dates);
      if (d > 0) {
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
    }
    return min <= max ? { min, max } : null;
  }, [data]);

  useEffect(() => {
    if (overlayMode === "replay" && dateRange && replayCutoff === 0) setReplayCutoff(dateRange.max);
  }, [overlayMode, dateRange, replayCutoff]);

  // ---- scene ------------------------------------------------------------------

  const overlay: VaultMapOverlay = useMemo(() => {
    if (overlayMode === "heatmap") return { mode: "heatmap", now: heatmapNow };
    if (overlayMode === "replay" && data) return { mode: "replay", cutoff: replayCutoff || dateRange?.max || 0, dates: data.dates };
    return { mode: "normal" };
  }, [overlayMode, heatmapNow, replayCutoff, data, dateRange]);

  const sceneModel: VaultMapScene | null = useMemo(() => {
    if (!data) return null;
    return buildVaultMapScene({
      graph: data.graph,
      overview: data.overview,
      expanded,
      pins: graphState?.getPins(PIN_CONTEXT) ?? {},
      icons: data.icons,
      filters: { query: query.trim().toLowerCase(), okfType, tagPaths, edgeKinds },
      focus,
      showIndexNotes,
      overlay,
      seed: `vault:${vaultPath ?? ""}:${hashSeed(vaultPath ?? "")}`,
    });
    // pinsTick re-runs after drag-pinning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, expanded, query, okfType, tagPaths, edgeKinds, focus, showIndexNotes, overlay, graphState, vaultPath, pinsTick]);

  // Cleanup overlay flags ride on top of the scene (P7).
  const flaggedScene: VaultMapScene | null = useMemo(() => {
    if (!sceneModel) return null;
    if (highlight.paths.size === 0 || !highlight.flag) return sceneModel;
    return {
      ...sceneModel,
      nodes: sceneModel.nodes.map((n) => (highlight.paths.has(n.id) ? { ...n, flag: highlight.flag } : n)),
    };
  }, [sceneModel, highlight]);

  /** Edge hover context: property label or the source line around the link.
   *  Tooltip coordinates are stored CANVAS-relative (render stays ref-free). */
  const describeEdge = useCallback(
    async (edgeId: string, clientX: number, clientY: number) => {
      if (!sceneModel || !vaultAdapter) return;
      const entries = sceneModel.bundles.get(edgeId);
      if (!entries || entries.length === 0) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      const first = entries[0];
      if (first.propertyKey) {
        setEdgeTip({ x, y, text: `${first.propertyKey} · ×${entries.length}` });
        return;
      }
      const line = data?.graph.edges.find(
        (e) => e.source === first.source && e.target === first.target && e.kind === first.kind
      )?.lineNumber;
      if (line == null) {
        setEdgeTip({ x, y, text: `×${entries.length}` });
        return;
      }
      try {
        let lines = lineCache.current.get(first.source);
        if (!lines) {
          lines = (await vaultAdapter.readTextFile(first.source)).split("\n");
          lineCache.current.set(first.source, lines);
          if (lineCache.current.size > 30) {
            const oldest = lineCache.current.keys().next().value;
            if (oldest) lineCache.current.delete(oldest);
          }
        }
        const text = lines[line - 1]?.trim().slice(0, 140) ?? "";
        setEdgeTip({ x, y, text: text || `×${entries.length}` });
      } catch {
        setEdgeTip({ x, y, text: `×${entries.length}` });
      }
    },
    [sceneModel, vaultAdapter, data]
  );

  useLayoutEffect(() => {
    depsRef.current = {
      reducedMotion: () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
      onNodeDoubleClick: (id) => {
        if (id.startsWith("folder:")) {
          const folder = id.slice(7);
          setExpanded((prev) => new Set(prev).add(folder));
        } else {
          onOpenPath(id);
        }
      },
      onNodeClick: (id, ev) => {
        if (id.startsWith("folder:")) {
          if (ev.ctrl || ev.middle) return;
          setSelection([id]);
          sceneRef.current?.setSelection([id]);
          return;
        }
        if (ev.ctrl && onOpenInSplit) onOpenInSplit(id);
        else if (ev.middle) onOpenPath(id, true);
        else {
          setSelection([id]);
          sceneRef.current?.setSelection([id]);
        }
      },
      onNodeActivate: (id) => {
        if (!id.startsWith("folder:")) onOpenPath(id);
      },
      onNodeContext: (id, x, y) => {
        if (id.startsWith("folder:")) {
          const folder = id.slice(7);
          setFolderMenu({ folder, x, y, expanded: expanded.has(folder) });
          return;
        }
        setNodeMenu({ path: id, x, y, pinned: !!graphState?.getPins(PIN_CONTEXT)[id] });
      },
      onCanvasContext: (x, y) => setCanvasMenu({ x, y }),
      onEdgeClick: (edgeId, x, y) => setBundlePopover({ edgeId, x, y }),
      onEdgeContext: (edgeId, x, y) => {
        const entries = sceneModel?.bundles.get(edgeId) ?? [];
        if (entries.length > 0) setEdgeMenu({ edgeId, x, y, entries });
      },
      onEdgeHover: (edgeId, x, y) => {
        if (!edgeId || x === undefined || y === undefined) {
          setEdgeTip(null);
          return;
        }
        void describeEdge(edgeId, x, y);
      },
      onFocusChange: (id) => {
        if (!id) setFocusedLabel("");
        else if (id.startsWith("folder:")) setFocusedLabel(id.slice(7));
        else setFocusedLabel(data?.graph.nodes.get(id)?.title ?? id);
      },
      onNodeDropOnNode: (source, target) => {
        if (source.startsWith("folder:") || target.startsWith("folder:")) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        setConnectDrop({ source, target, x: (rect?.left ?? 0) + 80, y: (rect?.top ?? 0) + 80 });
      },
      onNodeDragEnd: (id, x, y) => {
        if (!pinMode) return; // OFF: keep the session position, don't persist it
        graphState?.setPin(PIN_CONTEXT, id, { x, y });
        setPinsTick((n) => n + 1);
      },
      onNodesDragEnd: (moves) => {
        if (!pinMode) return;
        for (const m of moves) graphState?.setPin(PIN_CONTEXT, m.id, { x: m.x, y: m.y });
        setPinsTick((n) => n + 1);
      },
      onLassoSelect: (ids, additive) => {
        const paths = ids.filter((id) => !id.startsWith("folder:"));
        setSelection((prev) => {
          const next = additive ? [...new Set([...prev, ...paths])] : paths;
          sceneRef.current?.setSelection(next);
          return next;
        });
      },
      onBackgroundClick: () => {
        setSelection([]);
        sceneRef.current?.setSelection([]);
        setBundlePopover(null);
        setEdgeTip(null);
      },
    };
  });


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createGraphScene(canvas, depsRef, { lassoOnEmptyDrag: true, linkedDrag: true });
    sceneRef.current = scene;
    // Some host environments swallow native contextmenu on canvas (observed
    // in the E2E harness): a plain right-button pointerup is the fallback
    // trigger for the same menus.
    const fallbackContext = (ev: PointerEvent) => {
      if (ev.button !== 2) return;
      const id = scene.nodeAtClient(ev.clientX, ev.clientY);
      if (id) depsRef.current.onNodeContext?.(id, ev.clientX, ev.clientY);
      else {
        const world = scene.clientToWorld(ev.clientX, ev.clientY);
        depsRef.current.onCanvasContext?.(ev.clientX, ev.clientY, world.x, world.y);
      }
    };
    canvas.addEventListener("pointerup", fallbackContext);
    return () => {
      canvas.removeEventListener("pointerup", fallbackContext);
      void graphState?.flush();
      scene.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !flaggedScene) return;
    scene.setData(flaggedScene.nodes, flaggedScene.edges, { animate: fitOnceRef.current });
    if (!fitOnceRef.current) {
      scene.zoomToFit();
      fitOnceRef.current = true;
    }
  }, [flaggedScene]);

  // ---- node/canvas actions (P6/P9) -------------------------------------------

  const titleOf = useCallback((path: string) => data?.graph.nodes.get(path)?.title ?? path, [data]);

  const renameNode = useCallback(
    async (path: string) => {
      if (!vaultAdapter || !queryService) return;
      const oldName = path.split(/[/\\]/).pop()!.replace(/\.md$/i, "");
      const next = await appPrompt({
        title: t("graph.renameTitle", { defaultValue: "Notiz umbenennen" }),
        initial: oldName,
      });
      if (!next || next.trim() === oldName) return;
      const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
      const newPath = folder ? `${folder}/${next.trim()}.md` : `${next.trim()}.md`;
      try {
        await renameFileWithLinkUpdates({ adapter: vaultAdapter, queryService, oldPath: path, newPath });
        toast.success(t("graph.renamed", { defaultValue: "Umbenannt." }));
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [vaultAdapter, queryService, t]
  );

  const deleteNodes = useCallback(
    async (paths: string[]) => {
      if (!vaultAdapter || paths.length === 0) return;
      const ok = await appConfirm({
        title: t("graph.deleteTitle", { defaultValue: "Löschen?" }),
        message:
          paths.length === 1
            ? t("graph.deleteOneMsg", { defaultValue: "„{{name}}“ wird gelöscht (OS-Papierkorb).", name: titleOf(paths[0]) })
            : t("graph.deleteManyMsg", { defaultValue: "{{n}} Notizen werden gelöscht (OS-Papierkorb).", n: paths.length }),
        kind: "danger",
        confirmLabel: t("common.delete", { defaultValue: "Löschen" }),
      });
      if (!ok) return;
      for (const p of paths) {
        try {
          await vaultAdapter.deleteItem(p);
        } catch {
          toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
          return;
        }
      }
      setSelection([]);
      sceneRef.current?.setSelection([]);
    },
    [vaultAdapter, t, titleOf]
  );

  const newConnectedNote = useCallback(
    async (sourcePath: string) => {
      if (!vaultAdapter || !queryService) return;
      const title = await appPrompt({ title: t("graph.menuNewConnected", { defaultValue: "Neue verbundene Notiz…" }) });
      if (!title?.trim()) return;
      try {
        const folder = sourcePath.includes("/") ? sourcePath.substring(0, sourcePath.lastIndexOf("/")) : "";
        const noteType = vaultPath ? await getConfiguredNoteType(vaultPath) : "Note";
        const path = await createConnectedNote(vaultAdapter, queryService, { folder, title, sourcePath, noteType });
        onOpenPath(path, true);
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [vaultAdapter, queryService, vaultPath, t, onOpenPath]
  );

  const newNoteAtRoot = useCallback(async () => {
    if (!vaultAdapter || !queryService) return;
    const title = await appPrompt({ title: t("graph.menuNewNote", { defaultValue: "Neue Notiz…" }) });
    if (!title?.trim()) return;
    try {
      const noteType = vaultPath ? await getConfiguredNoteType(vaultPath) : "Note";
      const path = await createConnectedNote(vaultAdapter, queryService, { folder: "", title, noteType });
      onOpenPath(path, true);
    } catch {
      toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
    }
  }, [vaultAdapter, queryService, vaultPath, t, onOpenPath]);

  const removeEdgeTextLinks = useCallback(
    async (source: string, target: string) => {
      if (!vaultAdapter || !queryService) return;
      const ok = await appConfirm({
        title: t("graph.edgeRemoveLinks", { defaultValue: "Text-Link(s) entfernen" }),
        message: t("graph.edgeRemoveLinksMsg", {
          defaultValue: "Alle Text-Links von „{{source}}“ auf „{{target}}“ werden durch ihren Anzeigetext ersetzt.",
          source: titleOf(source),
          target: titleOf(target),
        }),
        kind: "warning",
      });
      if (!ok) return;
      try {
        const n = await removeLinksTo(vaultAdapter, queryService, source, target);
        if (n > 0) toast.success(t("graph.edgeRemoved", { defaultValue: "{{n}} Link(s) entfernt.", n }));
        else toast.warning(t("graph.cleanupMentionGone", { defaultValue: "Fundstelle existiert nicht mehr — Liste neu scannen." }));
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [vaultAdapter, queryService, t, titleOf]
  );

  const removeEdgeRelation = useCallback(
    async (source: string, target: string, propertyKey: string) => {
      if (!vaultAdapter || !queryService) return;
      const ok = await appConfirm({
        title: t("graph.edgeRemoveRelation", { defaultValue: "Relation entfernen" }),
        message: t("graph.edgeRemoveRelationMsg", {
          defaultValue: "„{{property}}“ in „{{source}}“ verliert den Eintrag auf „{{target}}“.",
          property: propertyKey,
          source: titleOf(source),
          target: titleOf(target),
        }),
        kind: "warning",
      });
      if (!ok) return;
      try {
        const n = await removeRelationLink(vaultAdapter, queryService, source, target, propertyKey);
        if (n > 0) toast.success(t("graph.edgeRemoved", { defaultValue: "{{n}} Link(s) entfernt.", n }));
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [vaultAdapter, queryService, t, titleOf]
  );

  const expandAllFolders = useCallback(() => {
    if (!data) return;
    setExpanded(new Set(data.overview.folders.map((f) => f.folder)));
  }, [data]);

  const exportScene = useCallback(
    async (format: "png" | "svg") => {
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      if (!scene || !canvas) return;
      try {
        const target = await saveDialog({
          defaultPath: `plainva-graph.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        });
        if (!target) return;
        if (format === "svg") {
          await fsWriteTextFile(target, scene.toSVG());
        } else {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
          if (!blob) throw new Error("no blob");
          await fsWriteFile(target, new Uint8Array(await blob.arrayBuffer()));
        }
        toast.success(t("graph.exported", { defaultValue: "Exportiert." }));
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [t]
  );

  const togglePinMode = useCallback(() => {
    setPinModeState((prev) => {
      const next = !prev;
      graphState?.setPinMode(PIN_CONTEXT, next);
      if (!next) {
        // Turning the mode off discards this view's saved layout.
        graphState?.clearPins(PIN_CONTEXT);
        setPinsTick((n) => n + 1);
      }
      return next;
    });
  }, [graphState]);

  // Persist the overlay mode (device-local convenience).
  useEffect(() => {
    graphState?.setMapMode(overlayMode);
  }, [overlayMode, graphState]);

  // ---- derived UI data ----------------------------------------------------------

  const okfTypes = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const n of data.graph.nodes.values()) if (n.okfType) set.add(n.okfType);
    return [...set].sort();
  }, [data]);

  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    queryService
      ?.getAllTags()
      .then((tags) => {
        if (alive) setAllTags(tags.map((x) => x.tag));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [queryService, fileTreeVersion]);

  const bundleEntries = useMemo(() => {
    if (!bundlePopover || !sceneModel) return [];
    return sceneModel.bundles.get(bundlePopover.edgeId) ?? [];
  }, [bundlePopover, sceneModel]);

  const kindToggles: { kind: GraphEdgeKind; label: string }[] = [
    { kind: "wikilink", label: t("graph.kindLinks", { defaultValue: "Links" }) },
    { kind: "property", label: t("graph.kindRelations", { defaultValue: "Relationen" }) },
    { kind: "embed", label: t("graph.kindEmbeds", { defaultValue: "Embeds" }) },
  ];
  // Badge on the collapsed popover button: type filter, tag filter, and any
  // disabled edge kind each count as one active filter.
  const activeFilterCount =
    (okfType ? 1 : 0) + (tag ? 1 : 0) + (kindToggles.some(({ kind }) => !edgeKinds.has(kind)) ? 1 : 0);

  const toggleKind = (kind: GraphEdgeKind) => {
    setEdgeKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        if (kind === "wikilink") next.delete("markdown-link");
        next.delete(kind);
      } else {
        if (kind === "wikilink") next.add("markdown-link");
        next.add(kind);
      }
      return next;
    });
  };

  // ---- render --------------------------------------------------------------------

  return (
    <div data-testid="vault-graph-view" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color-light)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-muted)", fontWeight: 700, fontSize: "var(--text-sm)" }}>
          <Waypoints size={15} />
          {t("graph.mapTitle", { defaultValue: "Vault-Karte" })}
        </span>
        <input
          className="pv-field"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("graph.searchPlaceholder", { defaultValue: "Suchen (dimmt Rest)…" })}
          aria-label={t("graph.searchPlaceholder", { defaultValue: "Suchen (dimmt Rest)…" })}
          data-testid="graph-map-search"
          style={{ width: 180 }}
        />
        {/* Facets live in a compact popover now (hardening P7.1) — the two
            always-visible filter rows ate map space; the badge shows how many
            filters are active while the popover is closed. */}
        <span ref={filterPopRef} style={{ position: "relative" }}>
          <button
            className={`pv-btn pv-btn--sm ${showFilters || activeFilterCount > 0 ? "pv-btn--primary" : "pv-btn--ghost"}`}
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            data-testid="graph-filter-btn"
          >
            <SlidersHorizontal size={14} />
            {t("graph.filters", { defaultValue: "Filter" })}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {showFilters && (
            <div
              className="pv-popover"
              style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 250 }}
            >
              <select className="pv-field pv-field--select" value={okfType ?? ""} onChange={(e) => setOkfType(e.target.value || null)} aria-label={t("graph.filterType", { defaultValue: "Nach Typ filtern" })}>
                <option value="">{t("graph.allTypes", { defaultValue: "Alle Typen" })}</option>
                {okfTypes.map((ty) => (
                  <option key={ty} value={ty}>{ty}</option>
                ))}
              </select>
              <select className="pv-field pv-field--select" value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)} aria-label={t("graph.filterTag", { defaultValue: "Nach Tag filtern" })}>
                <option value="">{t("graph.allTags", { defaultValue: "Alle Tags" })}</option>
                {allTags.map((tg) => (
                  <option key={tg} value={tg}>#{tg}</option>
                ))}
              </select>
              {kindToggles.map(({ kind, label }) => (
                <label key={kind} className="pv-checkrow" style={{ gap: "var(--space-1)", fontSize: "var(--text-sm)" }}>
                  <input type="checkbox" className="pv-check" checked={edgeKinds.has(kind)} onChange={() => toggleKind(kind)} />
                  {label}
                </label>
              ))}
              <label className="pv-checkrow" style={{ gap: "var(--space-1)", fontSize: "var(--text-sm)" }}>
                <input
                  type="checkbox"
                  className="pv-check"
                  checked={showIndexNotes}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setShowIndexNotes(on);
                    if (typeof localStorage !== "undefined") localStorage.setItem("plainva-graph-show-index", on ? "1" : "0");
                  }}
                />
                {t("graph.showIndexNotes", { defaultValue: "index.md anzeigen" })}
              </label>
            </div>
          )}
        </span>
        <span style={{ flex: 1 }} />
        {focus ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-sm)", color: "var(--accent-color)" }}>
            <Crosshair size={14} />
            {t("graph.focusActive", { defaultValue: "Fokus (Tiefe {{depth}})", depth: focus.depth })}
            <select
              className="pv-field pv-field--select"
              value={focus.depth}
              onChange={(e) => setFocus({ ...focus, depth: Number(e.target.value) })}
              aria-label={t("graph.focusDepth", { defaultValue: "Fokus-Tiefe" })}
            >
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button className="pv-iconbtn pv-iconbtn--sm" aria-label={t("graph.focusOff", { defaultValue: "Fokus aufheben" })} data-tip={t("graph.focusOff", { defaultValue: "Fokus aufheben" })} onClick={() => setFocus(null)}>
              <X size={13} />
            </button>
          </span>
        ) : (
          <button
            className="pv-btn pv-btn--ghost pv-btn--sm"
            disabled={selection.length !== 1}
            data-testid="graph-focus-btn"
            onClick={() => selection[0] && setFocus({ seed: selection[0], depth: 1 })}
          >
            <Crosshair size={14} />
            {t("graph.focusOn", { defaultValue: "Fokus auf Auswahl" })}
          </button>
        )}
        <button
          className={`pv-btn pv-btn--sm ${overlayMode === "heatmap" ? "pv-btn--primary" : "pv-btn--ghost"}`}
          onClick={() => {
            setHeatmapNow(Date.now());
            setOverlayMode((m) => (m === "heatmap" ? "normal" : "heatmap"));
          }}
          data-testid="graph-heatmap-btn"
        >
          <Flame size={14} />
          {t("graph.heatmap", { defaultValue: "Heatmap" })}
        </button>
        <button
          className={`pv-btn pv-btn--sm ${overlayMode === "replay" ? "pv-btn--primary" : "pv-btn--ghost"}`}
          onClick={() => setOverlayMode((m) => (m === "replay" ? "normal" : "replay"))}
          data-testid="graph-replay-btn"
        >
          <History size={14} />
          {t("graph.replay", { defaultValue: "Zeitreise" })}
        </button>
        <button
          className={`pv-btn pv-btn--sm ${showCleanup ? "pv-btn--primary" : "pv-btn--ghost"}`}
          onClick={() => setShowCleanup((v) => !v)}
          data-testid="graph-cleanup-btn"
        >
          <Eraser size={14} />
          {t("graph.cleanupTitle", { defaultValue: "Aufräumen" })}
        </button>
        <button
          className="pv-iconbtn"
          aria-label={t("graph.zoomFit", { defaultValue: "Alles einpassen" })}
          data-tip={t("graph.zoomFit", { defaultValue: "Alles einpassen" })}
          onClick={() => sceneRef.current?.zoomToFit()}
        >
          <Maximize2 size={15} />
        </button>
      </div>

      {overlayMode === "replay" && dateRange && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1) var(--space-3)", borderBottom: "1px solid var(--border-color-light)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          <span>{new Date(dateRange.min).toLocaleDateString()}</span>
          <input
            type="range"
            min={dateRange.min}
            max={dateRange.max}
            value={replayCutoff || dateRange.max}
            onChange={(e) => setReplayCutoff(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label={t("graph.replaySlider", { defaultValue: "Zeitpunkt" })}
            data-testid="graph-replay-slider"
          />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{new Date(replayCutoff || dateRange.max).toLocaleDateString()}</span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="application"
            aria-label={t("graph.mapAria", { defaultValue: "Vault-Karte: Graph aller Notizen" })}
            data-testid="graph-map-canvas"
            style={{ width: "100%", height: "100%", display: "block", outline: "none" }}
          />
          <PinModeToggle active={pinMode} onToggle={togglePinMode} />
          {edgeTip && (
            <div
              role="tooltip"
              style={{ position: "absolute", left: Math.max(4, edgeTip.x + 12), top: Math.max(4, edgeTip.y + 12), maxWidth: 320, padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-md)", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-2)", color: "var(--text-main)", fontSize: "var(--text-xs)", pointerEvents: "none", zIndex: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {edgeTip.text}
            </div>
          )}
          <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
            {focusedLabel}
          </span>
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: "var(--space-2)", bottom: "var(--space-2)", display: "flex", flexDirection: "column", gap: 2, padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-md)", background: "var(--bg-secondary)", border: "1px solid var(--border-color-light)", fontSize: "var(--text-xs)", color: "var(--text-muted)", pointerEvents: "none", opacity: 0.9 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 22, borderTop: "2px solid var(--accent-color)" }} />
              {t("graph.legendRelation", { defaultValue: "Relation" })}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 22, borderTop: "2px dashed var(--text-muted)" }} />
              {t("graph.legendLink", { defaultValue: "Link" })}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 22, borderTop: "2px dotted var(--text-faint)" }} />
              {t("graph.legendEmbed", { defaultValue: "Embed" })}
            </span>
          </div>
        </div>
        {showCleanup && (
          <CleanupPanel
            onClose={() => setShowCleanup(false)}
            onOpenPath={(p) => onOpenPath(p)}
            onHighlight={(paths, flag) => setHighlight({ paths: new Set(paths), flag })}
            refreshToken={fileTreeVersion}
          />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-1) var(--space-3)", borderTop: "1px solid var(--border-color-light)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        <span data-testid="graph-stat-notes">{t("graph.statNotes", { defaultValue: "{{count}} Notizen", count: sceneModel?.stats.notes ?? 0 })}</span>
        <span>{t("graph.statLinks", { defaultValue: "{{count}} Verknüpfungen", count: sceneModel?.stats.links ?? 0 })}</span>
        <button className="pv-btn pv-btn--ghost pv-btn--sm" onClick={expandAllFolders} data-testid="graph-expand-all">
          {t("graph.expandAll", { defaultValue: "Alles entfalten" })}
        </button>
        {expanded.size > 0 && (
          <button className="pv-btn pv-btn--ghost pv-btn--sm" onClick={() => setExpanded(new Set())} data-testid="graph-collapse-all">
            {t("graph.collapseAll", { defaultValue: "Alle Ordner einklappen" })}
          </button>
        )}
        {selection.length > 1 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }} data-testid="graph-bulk-bar">
            {t("graph.bulkSelected", { defaultValue: "{{n}} ausgewählt", n: selection.length })}
            {onToggleBookmark && (
              <button className="pv-btn pv-btn--ghost pv-btn--sm" onClick={() => selection.forEach((p) => onToggleBookmark(p))}>
                {t("graph.menuBookmark", { defaultValue: "Lesezeichen umschalten" })}
              </button>
            )}
            <button className="pv-btn pv-btn--ghost pv-btn--sm" onClick={() => void deleteNodes(selection)} data-testid="graph-bulk-delete">
              {t("common.delete", { defaultValue: "Löschen" })}
            </button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="pv-linkbtn"
          onClick={() => setShowCleanup(true)}
          data-testid="graph-stat-orphans"
        >
          {t("graph.statOrphans", { defaultValue: "{{count}} Waisen", count: data?.orphanCount ?? 0 })}
        </button>
      </div>

      {nodeMenu && (
        <GraphNodeMenu
          state={nodeMenu}
          onClose={() => setNodeMenu(null)}
          onOpen={() => onOpenPath(nodeMenu.path)}
          onPeek={() => setPeekPath(nodeMenu.path)}
          onOpenInSplit={onOpenInSplit ? () => onOpenInSplit(nodeMenu.path) : undefined}
          onNewTab={() => onOpenPath(nodeMenu.path, true)}
          onNewConnectedNote={() => void newConnectedNote(nodeMenu.path)}
          onRename={() => void renameNode(nodeMenu.path)}
          onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(nodeMenu.path) : undefined}
          onUnpin={() => {
            graphState?.setPin(PIN_CONTEXT, nodeMenu.path, null);
            setPinsTick((n) => n + 1);
          }}
          onDelete={() => void deleteNodes([nodeMenu.path])}
        />
      )}
      {folderMenu && (
        <GraphFolderMenu
          state={folderMenu}
          onClose={() => setFolderMenu(null)}
          onToggleExpand={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(folderMenu.folder)) next.delete(folderMenu.folder);
              else next.add(folderMenu.folder);
              return next;
            })
          }
          onExpandOnlyThis={() => setExpanded(new Set([folderMenu.folder]))}
          onFocusFolder={() => setFocus({ seed: `folder:${folderMenu.folder}`, depth: 1 })}
          onCollapseAll={() => setExpanded(new Set())}
        />
      )}
      {edgeMenu && (
        <GraphEdgeMenu
          state={edgeMenu}
          titleOf={titleOf}
          onClose={() => setEdgeMenu(null)}
          onOpen={(p) => onOpenPath(p)}
          onRemoveTextLinks={(s, tgt) => void removeEdgeTextLinks(s, tgt)}
          onRemoveRelation={(s, tgt, key) => void removeEdgeRelation(s, tgt, key)}
        />
      )}
      {canvasMenu && (
        <GraphCanvasMenu
          state={canvasMenu}
          onClose={() => setCanvasMenu(null)}
          onNewNote={() => void newNoteAtRoot()}
          onResetLayout={() => {
            graphState?.clearPins(PIN_CONTEXT);
            setPinsTick((n) => n + 1);
          }}
          onZoomFit={() => sceneRef.current?.zoomToFit()}
          onExportPng={() => void exportScene("png")}
          onExportSvg={() => void exportScene("svg")}
        />
      )}
      {connectDrop && vaultAdapter && queryService && (
        <GraphConnectMenu
          state={connectDrop}
          adapter={vaultAdapter}
          queryService={queryService}
          titleOf={titleOf}
          onClose={() => setConnectDrop(null)}
          onDone={() => setConnectDrop(null)}
        />
      )}
      {peekPath && (
        <BasePeekModal
          path={peekPath}
          onClose={() => setPeekPath(null)}
          onMaximize={(p) => { onOpenPath(p, true); setPeekPath(null); }}
          onOpenSplit={onOpenInSplit ? (p) => { onOpenInSplit(p); setPeekPath(null); } : undefined}
        />
      )}
      {bundlePopover && bundleEntries.length > 0 && (
        <MenuSurface open onClose={() => setBundlePopover(null)} at={{ x: bundlePopover.x, y: bundlePopover.y }} minWidth={260} ariaLabel={t("graph.bundleTitle", { defaultValue: "Verknüpfungen im Bündel" })}>
          {bundleEntries.slice(0, 12).map((entry, i) => {
            const sTitle = data?.graph.nodes.get(entry.source)?.title ?? entry.source;
            const tTitle = data?.graph.nodes.get(entry.target)?.title ?? entry.target;
            return (
              <MenuItem key={`${entry.source}-${entry.target}-${i}`} onSelect={() => { setBundlePopover(null); onOpenPath(entry.source); }}>
                {sTitle} → {tTitle}
                {entry.propertyKey ? ` (${entry.propertyKey})` : ""}
              </MenuItem>
            );
          })}
        </MenuSurface>
      )}
    </div>
  );
}

/** Pure helper for tests/consumers needing the callable focus-check. */
export function canFocus(selection: string[]): boolean {
  return selection.length === 1 && !selection[0].startsWith("folder:");
}
