import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GraphService,
  type GraphSuggestion,
  type GraphSuggestionReason,
} from "@plainva/core";
import { appendWikiLink, applyInlineLink, buildContextScene, Button, createGraphScene, getGraphState, type GraphEngineDeps, type GraphStateStore, sceneHasContent, suggestionKey, toast } from "@plainva/ui";
import { type MobileVault } from "../services/vaultService";
import { syncSoon } from "../services/syncService";

/**
 * Context graph segment of the note sheet (M3E package F): the shared
 * TheBrain-style scene (structure above/below, in/out to the sides) on the
 * shared canvas engine, plus the algorithmic suggestion cards. Accepting a
 * suggestion appends the wiki link to the SOURCE note's end — the desktop's
 * inline placement with live preview stays a desktop refinement. Dismissals
 * are session-local on mobile (no graph.json store here).
 */

const REASON_KEY: Record<GraphSuggestionReason, string> = {
  mention: "graph.reasonMention",
  cocitation: "graph.reasonCocitation",
  neighbors: "graph.reasonNeighbors",
  tag: "graph.reasonTag",
};

export function ContextGraph({
  vault,
  path,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const depsRef = useRef<GraphEngineDeps>({});
  const [model, setModel] = useState<ReturnType<typeof buildContextScene> | null>(null);
  const [suggestions, setSuggestions] = useState<GraphSuggestion[]>([]);
  const [graphState, setGraphState] = useState<GraphStateStore | null>(null);
  const [dismissTick, setDismissTick] = useState(0);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    depsRef.current.onNodeClick = (id) => {
      if (id && id !== path && !id.startsWith("overflow:")) onOpenNote(id);
    };
  }, [onOpenNote, path]);

  // Load graph + neighborhood + suggestions (desktop GraphContextSection flow,
  // mobile-sized: no version cache). Dismissals ARE persisted since S35 — a
  // suggestion you rejected coming back on the next open is the surface
  // telling you your answer did not count.
  useEffect(() => {
    if (!vault.queryService || !/\.md$/i.test(path)) return;
    let alive = true;
    void (async () => {
      try {
        const service = new GraphService(vault.queryService!.db);
        const graph = await service.loadGraph({ includeAttachments: false });
        if (!alive || !graph.nodes.has(path)) return;
        const neighborhood = await service.getNeighborhood(path, 1, graph);
        let found: GraphSuggestion[] = [];
        for (const provider of service.getSuggestionProviders()) {
          if (found.length >= 3) break;
          try {
            found = found.concat(await provider.suggest(path, 3));
          } catch {
            /* a failing provider never breaks the sheet */
          }
        }
        // Rejected suggestions stay rejected: `.plainva/graph.json` remembers
        // them per vault, exactly as on the desktop.
        const store = getGraphState(vault.files);
        await store.load().catch(() => {});
        if (!alive) return;
        setGraphState(store);
        found = found
          .filter((s) => !store.isDismissed(suggestionKey(s.reason, s.source, s.target)))
          .slice(0, 3);
        if (!alive) return;
        const names = new Map<string, string>();
        for (const [p, node] of graph.nodes) names.set(p, node.title || p);
        setTitles(names);
        setSuggestions(found);
        setModel(buildContextScene({ neighborhood, graph, suggestions: found }, path));
      } catch {
        /* graph unavailable (cold index) — the segment stays empty */
      }
    })();
    return () => {
      alive = false;
      // The dismissal write is debounced; closing the sheet without flushing
      // would lose a rejection made a moment earlier.
      void getGraphState(vault.files).flush();
    };
  }, [vault, path, dismissTick]);

  // Mount the shared engine once a model with content exists.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !sceneHasContent(model)) return;
    const scene = createGraphScene(canvas, depsRef);
    scene.setData(model.nodes, model.edges);
    scene.zoomToFit(24);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas.parentElement ?? canvas);
    return () => {
      ro.disconnect();
      scene.destroy();
    };
  }, [model]);

  const titleOf = (p: string) => titles.get(p) ?? p.split("/").pop()?.replace(/\.md$/i, "") ?? p;

  /**
   * Accepting places the link AT THE PASSAGE (S35), not at the end of the note.
   * Appending was the mobile shortcut: a link about a sentence in paragraph two
   * landed under the last line, where it says nothing about that sentence. The
   * shared rule finds the first still-unlinked occurrence and aliases it when
   * the visible text differs; only when no live occurrence remains — a stale
   * suggestion, or one with no findable term — does it fall back to appending.
   */
  const accept = (s: GraphSuggestion) => {
    void (async () => {
      const service = vault.queryService;
      if (!service) return;
      try {
        const terms = s.term ? [s.term] : [];
        const linked =
          terms.length > 0 && (await applyInlineLink(vault.files, service, s.source, s.target, terms)) !== null;
        if (!linked) await appendWikiLink(vault.files, service, s.source, s.target);
        graphState?.dismissSuggestion(suggestionKey(s.reason, s.source, s.target));
        syncSoon();
        setDismissTick((n) => n + 1);
        toast.info(`[[${titleOf(s.target)}]]`);
      } catch {
        toast.warning(t("mobile.saveRetry"));
      }
    })();
  };

  const dismiss = (s: GraphSuggestion) => {
    graphState?.dismissSuggestion(suggestionKey(s.reason, s.source, s.target));
    setDismissTick((n) => n + 1);
  };

  if (!model || !sceneHasContent(model)) return null;

  return (
    <>
      <div className="m-contextgraph">
        <canvas aria-label={t("rightPanel.graph")} ref={canvasRef} />
      </div>
      {suggestions.length > 0 &&
        suggestions.map((s, idx) => (
          <div className="m-suggest" key={`${s.source}-${s.target}-${idx}`}>
            <p className="m-suggest-eyebrow">{t("graph.suggestions")}</p>
            <p className="m-suggest-text">
              {titleOf(s.source === path ? s.target : s.source)}
              <b> [[{titleOf(s.target)}]]</b>
              <span className="m-badge-muted"> · {t(REASON_KEY[s.reason])}</span>
            </p>
            <div className="m-suggest-actions">
              <Button variant="tonal" onClick={() => accept(s)}>
                {t("graph.acceptSuggestion")}
              </Button>
              <Button variant="ghost" onClick={() => dismiss(s)}>
                {t("graph.dismissSuggestion")}
              </Button>
              <Button variant="ghost" onClick={() => onOpenNote(s.target)}>
                {t("mobile.sheetOpen")}
              </Button>
            </div>
          </div>
        ))}
    </>
  );
}
