import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import {
  GraphService,
  type GraphSuggestion,
  type GraphSuggestionReason,
} from "@plainva/core";
import {
  buildContextScene,
  createGraphScene,
  sceneHasContent,
  toast,
  type GraphEngineDeps,
} from "@plainva/ui";
import { vaultOps, type MobileVault } from "../services/vaultService";
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
  const [titles, setTitles] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    depsRef.current.onNodeClick = (id) => {
      if (id && id !== path && !id.startsWith("overflow:")) onOpenNote(id);
    };
  }, [onOpenNote, path]);

  // Load graph + neighborhood + suggestions (desktop GraphContextSection flow,
  // mobile-sized: no version cache, no dismissal store, no inline previews).
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
        found = found.slice(0, 3);
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
    };
  }, [vault, path]);

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

  const accept = (s: GraphSuggestion) => {
    void (async () => {
      try {
        const text = await vaultOps.read(vault, s.source);
        const link = `[[${titleOf(s.target)}]]`;
        if (!text.includes(link)) {
          await vaultOps.save(vault, s.source, `${text.replace(/\n+$/, "")}\n\n${link}\n`);
          syncSoon();
        }
        setSuggestions((prev) => prev.filter((x) => x !== s));
        toast.info(link);
      } catch {
        toast.warning(t("mobile.saveRetry"));
      }
    })();
  };

  if (!model || !sceneHasContent(model)) return null;

  return (
    <>
      <div className="m-contextgraph">
        <canvas aria-label={t("rightPanel.graph")} ref={canvasRef} />
      </div>
      {suggestions.length > 0 && (
        <>
          <p className="m-sectionlabel m-sectionlabel--inset">{t("graph.suggestions")}</p>
          {suggestions.map((s, idx) => (
            <div className="m-row m-row--split" key={`${s.source}-${s.target}-${idx}`}>
              <button className="m-row-main" onClick={() => onOpenNote(s.target)}>
                <span>
                  {titleOf(s.source === path ? s.target : s.source)}
                  <span className="m-soon"> · {t(REASON_KEY[s.reason])}</span>
                </span>
              </button>
              <button
                aria-label={t("graph.acceptSuggestion")}
                className="m-iconbtn"
                onClick={() => accept(s)}
              >
                <Check className="m-accent" size={18} />
              </button>
              <button
                aria-label={t("graph.dismissSuggestion")}
                className="m-iconbtn"
                onClick={() => setSuggestions((prev) => prev.filter((x) => x !== s))}
              >
                <X size={18} />
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
}
