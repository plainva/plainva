import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Lightbulb, X } from "lucide-react";
import type { GraphSuggestion } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { appendWikiLink, applyInlineLink, findFirstUnlinkedOccurrence } from "../../services/graphActions";
import { buildOccurrenceSnippet, type OccurrenceSnippet } from "../../lib/occurrenceSnippet";
import { loadGraphCached } from "../../services/graphCache";
import { getGraphState, suggestionKey } from "../../services/graphState";
import { createGraphScene, type GraphEngineDeps, type GraphScene } from "./graphEngine";
import { buildContextScene, sceneHasContent, scenePathOf, type ContextData } from "./contextScene";
import { PinModeToggle } from "./PinModeToggle";

/**
 * Context graph (sidebar section, TheBrain pattern): the active note in the
 * center, structure above/below, associations at the sides, a small
 * suggestion zone underneath. Clicking navigates — the focus rotates to the
 * clicked note. Zones are laid out deterministically (no force).
 */

const CANVAS_HEIGHT = 300;
const REFRESH_DEBOUNCE_MS = 400;

interface GraphContextSectionProps {
  activePath: string | null;
  onOpenPath: (path: string, newTab?: boolean) => void;
  onOpenPathInSplit?: (path: string) => void;
}

/**
 * What accepting a suggestion will do, previewed in the card. When a matching
 * text passage exists in the note that gets edited (`editPath`), accepting
 * links THAT passage inline; `snippet` shows it. Otherwise the link is appended
 * at the end of `editPath` (snippet null). `editPath` is usually the active
 * note, but for an incoming mention it is the other note (editIsActive false).
 */
interface SuggestionPreview {
  editPath: string;
  editTitle: string;
  editIsActive: boolean;
  terms: string[];
  snippet: OccurrenceSnippet | null;
}

export function GraphContextSection({ activePath, onOpenPath, onOpenPathInSplit }: GraphContextSectionProps) {
  const { t } = useTranslation();
  const { graphService, queryService, vaultAdapter, fileTreeVersion } = useVault();
  const [data, setData] = useState<ContextData | null>(null);
  const [previews, setPreviews] = useState<Map<string, SuggestionPreview>>(new Map());
  const [dismissTick, setDismissTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  const graphState = vaultAdapter ? getGraphState(vaultAdapter) : null;
  // Pins are keyed per active note — the context graph's content IS that note's
  // neighborhood, so each note remembers its own hand-arranged layout.
  const pinContext = activePath ? `context:${activePath}` : "";
  const [pinMode, setPinModeState] = useState(true);
  const [pinsTick, setPinsTick] = useState(0);

  // ---- data ----------------------------------------------------------------

  useEffect(() => {
    if (!graphService || !activePath || !/\.md$/i.test(activePath)) {
      setData(null);
      setPreviews(new Map());
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        await graphState?.load();
        // Version-keyed cache (P2.6): plain file switches reuse the resolved
        // graph; only an index bump (fileTreeVersion) rebuilds it.
        const graph = await loadGraphCached(graphService, fileTreeVersion, { includeAttachments: false });
        if (!graph.nodes.has(activePath)) {
          if (alive) {
            setData(null);
            setPreviews(new Map());
          }
          return;
        }
        const neighborhood = await graphService.getNeighborhood(activePath, 1, graph);
        let suggestions: GraphSuggestion[] = [];
        for (const provider of graphService.getSuggestionProviders()) {
          if (suggestions.length >= 3) break;
          try {
            const found = await provider.suggest(activePath, 3);
            suggestions = suggestions.concat(found);
          } catch {
            /* a failing provider never breaks the panel */
          }
        }
        suggestions = suggestions
          .filter((s) => !graphState?.isDismissed(suggestionKey(s.reason, s.source, s.target)))
          .slice(0, 3);

        // Preview per suggestion: the passage that would be linked inline (or
        // null → appended at the end). Editing `s.source`; the term is the
        // known mention phrase, else the target note's title. At most three
        // small reads on the debounced refresh.
        const previewMap = new Map<string, SuggestionPreview>();
        for (const s of suggestions) {
          const editPath = s.source;
          const editTitle = graph.nodes.get(editPath)?.title ?? editPath;
          const terms = s.term
            ? [s.term]
            : [graph.nodes.get(s.target)?.title].filter((x): x is string => !!x);
          let snippet: OccurrenceSnippet | null = null;
          if (terms.length > 0 && vaultAdapter) {
            try {
              const content = await vaultAdapter.readTextFile(editPath);
              const occ = findFirstUnlinkedOccurrence(content, terms);
              if (occ) snippet = buildOccurrenceSnippet(content, occ.index, occ.matched.length);
            } catch {
              /* no readable passage → append fallback */
            }
          }
          previewMap.set(suggestionKey(s.reason, s.source, s.target), {
            editPath,
            editTitle,
            editIsActive: editPath === activePath,
            terms,
            snippet,
          });
        }

        if (alive) {
          setData({ neighborhood, graph, suggestions });
          setPreviews(previewMap);
        }
      } catch {
        if (alive) {
          setData(null);
          setPreviews(new Map());
        }
      }
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [graphService, graphState, activePath, fileTreeVersion, dismissTick, vaultAdapter]);

  // ---- scene ---------------------------------------------------------------

  // Rebuilds on data/note change (reading the current pins), never on drag: a
  // drag persists via onNodeDragEnd + patchNode, so the scene is not recomputed
  // and the view never re-fits mid-arrangement.
  const sceneModel = useMemo(
    () => (data && activePath ? buildContextScene(data, activePath, graphState?.getPins(pinContext) ?? {}) : null),
    // pinsTick re-runs after clearing this note's pins (pin mode toggled off).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, activePath, graphState, pinContext, pinsTick]
  );
  const hasConnections = sceneHasContent(sceneModel);

  // Engine callbacks rebind every render via the deps ref (editorSession
  // pattern) — written in a layout effect, never during render (hooks lint).
  useLayoutEffect(() => {
    depsRef.current = {
      reducedMotion: () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
      onNodeClick: (id, ev) => {
        const target = scenePathOf(id);
        if (!target) return;
        if (ev.ctrl && onOpenPathInSplit) onOpenPathInSplit(target);
        else onOpenPath(target, ev.middle);
      },
      onNodeActivate: (id) => {
        const target = scenePathOf(id);
        if (target) onOpenPath(target);
      },
      onNodeDragEnd: (id, x, y) => {
        // The focus note is always re-centered on rebuild; overflow markers
        // ("+N", index-less folder chains) are not real notes — pin neither.
        if (!graphState || !pinMode || id === activePath || scenePathOf(id) === null) return;
        graphState.setPin(pinContext, id, { x, y });
        // Show the pin dot immediately without rebuilding/re-fitting the scene;
        // the position itself is already held by the engine for this session.
        sceneRef.current?.patchNode(id, { pinned: true });
      },
    };
  });

  // Flush a pin dragged right before the section unmounts (e.g. vault close):
  // the store write is debounced 800ms, which a fast unmount would otherwise
  // drop. Navigating between notes keeps the section mounted, so the debounce
  // fires normally there.
  useEffect(() => () => void graphState?.flush(), [graphState]);

  // Sync the pin mode for the active note (load is idempotent).
  useEffect(() => {
    if (!graphState || !pinContext) return;
    let alive = true;
    void graphState.load().then(() => {
      if (alive) setPinModeState(graphState.getPinMode(pinContext));
    });
    return () => {
      alive = false;
    };
  }, [graphState, pinContext]);

  // The scene is created ONLY while the canvas is actually mounted AND visible
  // (hasConnections → the canvas renders display:block, never display:none).
  // Creating the engine's ResizeObserver on a hidden canvas was the root cause
  // of the blank-until-collapse/expand bug: the observer's guaranteed initial
  // callback reported size 0, and WebView2 did not re-fire it on the later
  // display:none→block flip. Keying the effect on hasConnections means the
  // observer always starts on a laid-out, visible canvas.
  useEffect(() => {
    if (!hasConnections) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createGraphScene(canvas, depsRef);
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [hasConnections]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sceneModel || !hasConnections) return;
    scene.setData(sceneModel.nodes, sceneModel.edges, { animate: false });

    // Fit once the canvas has a real layout size. Polling via rAF (rather than
    // relying on a ResizeObserver tick) keeps this independent of layout/paint
    // scheduling — belt and suspenders alongside the visible-canvas mount above.
    let raf = 0;
    let tries = 0;
    const fitWhenSized = () => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && rect.width >= 4 && rect.height >= 4) {
        scene.resize();
        scene.zoomToFit(18);
        return;
      }
      if (tries++ < 40) raf = requestAnimationFrame(fitWhenSized);
    };
    fitWhenSized();
    return () => cancelAnimationFrame(raf);
  }, [sceneModel, hasConnections]);

  // ---- suggestion actions ----------------------------------------------------

  const acceptSuggestion = useCallback(
    async (s: GraphSuggestion) => {
      if (!vaultAdapter || !queryService) return;
      try {
        const key = suggestionKey(s.reason, s.source, s.target);
        // Link the matching passage inline (aliased when the visible text
        // differs); fall back to appending at the end when no live occurrence
        // remains (stale preview) or the suggestion has no findable term.
        const terms = previews.get(key)?.terms ?? (s.term ? [s.term] : []);
        const linked =
          terms.length > 0 && (await applyInlineLink(vaultAdapter, queryService, s.source, s.target, terms)) !== null;
        if (!linked) await appendWikiLink(vaultAdapter, queryService, s.source, s.target);
        graphState?.dismissSuggestion(key);
        setDismissTick((n) => n + 1);
      } catch {
        /* surfaced through the unchanged suggestion list */
      }
    },
    [vaultAdapter, queryService, graphState, previews]
  );

  const dismissSuggestion = useCallback(
    (s: GraphSuggestion) => {
      graphState?.dismissSuggestion(suggestionKey(s.reason, s.source, s.target));
      setDismissTick((n) => n + 1);
    },
    [graphState]
  );

  const togglePinMode = useCallback(() => {
    setPinModeState((prev) => {
      const next = !prev;
      graphState?.setPinMode(pinContext, next);
      if (!next) {
        // Turning the mode off discards this note's saved arrangement.
        graphState?.clearPins(pinContext);
        setPinsTick((n) => n + 1);
      }
      return next;
    });
  }, [graphState, pinContext]);

  // ---- render ----------------------------------------------------------------

  if (!activePath || !/\.md$/i.test(activePath)) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "var(--space-2) 0" }}>
        {t("graph.noActiveNote", { defaultValue: "Keine Notiz geöffnet." })}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {hasConnections ? (
        // Mounted only when visible — never display:none (see the scene effect).
        <div style={{ position: "relative" }}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="application"
            aria-label={t("graph.contextAria", { defaultValue: "Kontext-Graph der aktiven Notiz" })}
            data-testid="graph-context-canvas"
            style={{ width: "100%", height: CANVAS_HEIGHT, display: "block", borderRadius: "var(--radius-md)", background: "var(--bg-primary)", outline: "none" }}
          />
          <PinModeToggle active={pinMode} onToggle={togglePinMode} />
        </div>
      ) : (
        <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "var(--space-2) 0" }}>
          {t("graph.noConnections", { defaultValue: "Noch keine Verbindungen — verlinke diese Notiz oder nimm einen Vorschlag an." })}
        </div>
      )}
      {data && data.suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-faint)", fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <Lightbulb size={12} />
            {t("graph.suggestions", { defaultValue: "Vorschläge" })}
          </div>
          {data.suggestions.map((s) => {
            const other = s.source === activePath ? s.target : s.source;
            const otherTitle = data.graph.nodes.get(other)?.title ?? other;
            const reasonLabel =
              s.reason === "mention"
                ? t("graph.reasonMention", { defaultValue: "erwähnt, nicht verlinkt" })
                : s.reason === "cocitation"
                  ? t("graph.reasonCocitation", { defaultValue: "oft gemeinsam verlinkt" })
                  : s.reason === "neighbors"
                    ? t("graph.reasonNeighbors", { defaultValue: "gleiche Nachbarschaft" })
                    : t("graph.reasonTag", { defaultValue: "teilt seltenen Tag {{tag}}", tag: s.detail ?? "" });
            const key = suggestionKey(s.reason, s.source, s.target);
            const preview = previews.get(key);
            return (
              <div
                key={key}
                data-testid="graph-suggestion"
                style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-md)", background: "var(--bg-primary)", border: "1px solid var(--border-color-light)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                  <button
                    onClick={() => onOpenPath(other)}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", color: "var(--text-main)", fontSize: "var(--text-sm)", padding: 0 }}
                  >
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{otherTitle}</span>
                    <span style={{ display: "block", color: "var(--text-faint)", fontSize: "var(--text-xs)" }}>{reasonLabel}</span>
                  </button>
                  <button
                    className="pv-iconbtn pv-iconbtn--sm"
                    aria-label={t("graph.acceptSuggestion", { defaultValue: "Verlinken" })}
                    data-tip={t("graph.acceptSuggestion", { defaultValue: "Verlinken" })}
                    data-testid="graph-suggestion-accept"
                    onClick={() => void acceptSuggestion(s)}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    className="pv-iconbtn pv-iconbtn--sm"
                    aria-label={t("graph.dismissSuggestion", { defaultValue: "Vorschlag verwerfen" })}
                    data-tip={t("graph.dismissSuggestion", { defaultValue: "Vorschlag verwerfen" })}
                    onClick={() => dismissSuggestion(s)}
                  >
                    <X size={13} />
                  </button>
                </div>
                {preview &&
                  (preview.snippet ? (
                    <div
                      data-testid="graph-suggestion-preview"
                      title={`${preview.snippet.before}${preview.snippet.match}${preview.snippet.after}`}
                      style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {!preview.editIsActive && (
                        <span style={{ color: "var(--text-faint)" }}>
                          {t("graph.suggestionInNote", { defaultValue: "in {{note}}", note: preview.editTitle })}:{" "}
                        </span>
                      )}
                      <span>{preview.snippet.before}</span>
                      <span style={{ fontWeight: 700, color: "var(--accent-color)" }}>{preview.snippet.match}</span>
                      <span>{preview.snippet.after}</span>
                    </div>
                  ) : (
                    <div
                      data-testid="graph-suggestion-preview"
                      style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {preview.editIsActive
                        ? t("graph.suggestionAtEnd", { defaultValue: "wird am Ende eingefügt" })
                        : t("graph.suggestionAtEndIn", { defaultValue: "wird am Ende von {{note}} eingefügt", note: preview.editTitle })}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
