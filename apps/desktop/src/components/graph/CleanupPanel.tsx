import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { BrokenLinkInfo, GraphNodeInfo, GraphSuggestion } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { requestCascadeDelete } from "../../services/cascadeDelete";
import { ICON, toast } from "@plainva/ui";
import { applyMentionLink, createConnectedNote } from "../../services/graphActions";
import { getConfiguredNoteType } from "../../services/newNote";
import { getGraphState, suggestionKey } from "../../services/graphState";

/**
 * Cleanup mode (P7): a docked worklist over the vault map. Three tabs —
 * orphans, broken links, unlinked mentions — each with direct actions. The
 * mention scan is on-demand, abortable and progress-reporting.
 */

type CleanupTab = "orphans" | "broken" | "mentions";

interface CleanupPanelProps {
  onClose: () => void;
  onOpenPath: (path: string) => void;
  /** Highlights the given paths on the map (orphan overlay). */
  onHighlight: (paths: string[], flag: "orphan" | "broken" | null) => void;
  refreshToken: number;
}

export function CleanupPanel({ onClose, onOpenPath, onHighlight, refreshToken }: CleanupPanelProps) {
  const { t } = useTranslation();
  const { graphService, queryService, vaultAdapter, vaultPath } = useVault();
  const graphState = vaultAdapter ? getGraphState(vaultAdapter) : null;
  const [tab, setTab] = useState<CleanupTab>("orphans");
  const [orphans, setOrphans] = useState<GraphNodeInfo[]>([]);
  const [broken, setBroken] = useState<BrokenLinkInfo[]>([]);
  const [mentions, setMentions] = useState<GraphSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    if (!graphService) return;
    (async () => {
      try {
        const graph = await graphService.loadGraph({ includeAttachments: true });
        const [o, b] = await Promise.all([graphService.getOrphans(graph), graphService.getBrokenLinks(graph)]);
        if (!alive) return;
        setOrphans(o);
        setBroken(b);
      } catch {
        /* panel stays empty */
      }
    })();
    return () => {
      alive = false;
    };
  }, [graphService, refreshToken]);

  useEffect(() => {
    onHighlight(
      tab === "orphans" ? orphans.map((o) => o.path) : tab === "broken" ? broken.map((b) => b.sourcePath) : [],
      tab === "orphans" ? "orphan" : tab === "broken" ? "broken" : null
    );
    return () => onHighlight([], null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, orphans, broken]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const scanMentions = useCallback(async () => {
    if (!graphService) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setProgress(null);
    try {
      await graphState?.load();
      const found = await graphService.findUnlinkedMentions({
        signal: controller.signal,
        onProgress: (current, total) => setProgress({ current, total }),
      });
      setMentions(found.filter((m) => !graphState?.isDismissed(suggestionKey(m.reason, m.source, m.target))));
    } catch {
      /* aborted or failed: keep the previous list */
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [graphService, graphState]);

  const deleteOrphan = useCallback(
    async (path: string) => {
      if (!vaultAdapter) return;
      // Unified with every other delete entry (plan Kaskadenloeschung): the
      // cascade host adds the cloud note, the large-deletion prompt and
      // noteUserInitiatedDeletion — all of which this panel used to skip.
      const done = await requestCascadeDelete({ paths: [path] });
      if (done) setOrphans((prev) => prev.filter((o) => o.path !== path));
    },
    [vaultAdapter]
  );

  const createBrokenTarget = useCallback(
    async (item: BrokenLinkInfo) => {
      if (!vaultAdapter || !queryService) return;
      try {
        const folder = item.sourcePath.includes("/") ? item.sourcePath.substring(0, item.sourcePath.lastIndexOf("/")) : "";
        const noteType = vaultPath ? await getConfiguredNoteType(vaultPath) : "Note";
        const title = item.targetRaw.split(/[/\\]/).pop()!.replace(/#.*$/, "");
        const path = await createConnectedNote(vaultAdapter, queryService, { folder, title, noteType });
        setBroken((prev) => prev.filter((b) => b !== item));
        toast.success(t("graph.cleanupCreated", { defaultValue: "Notiz erstellt: {{name}}", name: path }));
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [vaultAdapter, queryService, vaultPath, t]
  );

  const linkMention = useCallback(
    async (item: GraphSuggestion) => {
      if (!vaultAdapter || !queryService || !item.term) return;
      try {
        const ok = await applyMentionLink(vaultAdapter, queryService, item.source, item.target, item.term);
        if (ok) {
          graphState?.dismissSuggestion(suggestionKey(item.reason, item.source, item.target));
          setMentions((prev) => prev.filter((m) => m !== item));
          toast.success(t("graph.cleanupLinked", { defaultValue: "Verlinkt." }));
        } else {
          toast.warning(t("graph.cleanupMentionGone", { defaultValue: "Fundstelle existiert nicht mehr — Liste neu scannen." }));
        }
      } catch {
        toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      }
    },
    [vaultAdapter, queryService, graphState, t]
  );

  const ignoreMention = useCallback(
    (item: GraphSuggestion) => {
      graphState?.dismissSuggestion(suggestionKey(item.reason, item.source, item.target));
      setMentions((prev) => prev.filter((m) => m !== item));
    },
    [graphState]
  );

  const tabs: { id: CleanupTab; label: string; count: number }[] = [
    { id: "orphans", label: t("graph.cleanupOrphans", { defaultValue: "Waisen" }), count: orphans.length },
    { id: "broken", label: t("graph.cleanupBroken", { defaultValue: "Kaputte Links" }), count: broken.length },
    { id: "mentions", label: t("graph.cleanupMentions", { defaultValue: "Erwähnungen" }), count: mentions.length },
  ];

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-1)",
    padding: "var(--space-1) var(--space-2)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-sm)",
  };
  const actionStyle: React.CSSProperties = { flexShrink: 0 };

  return (
    <div
      data-testid="graph-cleanup-panel"
      style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border-color-light)", background: "var(--bg-secondary)", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", padding: "var(--space-2)" }}>
        <strong style={{ flex: 1, fontSize: "var(--text-sm)" }}>{t("graph.cleanupTitle", { defaultValue: "Aufräumen" })}</strong>
        <button className="pv-iconbtn pv-iconbtn--sm" aria-label={t("common.close", { defaultValue: "Schließen" })} onClick={onClose}>
          <X size={ICON.ui} />
        </button>
      </div>
      <div role="tablist" style={{ display: "flex", gap: "var(--space-1)", padding: "0 var(--space-2) var(--space-2)" }}>
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            className={`pv-btn pv-btn--sm ${tab === x.id ? "pv-btn--primary" : "pv-btn--ghost"}`}
            onClick={() => setTab(x.id)}
            data-testid={`graph-cleanup-tab-${x.id}`}
          >
            {x.label} ({x.count})
          </button>
        ))}
      </div>
      <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 var(--space-2) var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {tab === "orphans" &&
          (orphans.length === 0 ? (
            <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("graph.cleanupNoOrphans", { defaultValue: "Keine Waisen — alles verbunden." })}</span>
          ) : (
            orphans.map((o) => (
              <div key={o.path} style={rowStyle} data-testid="graph-cleanup-orphan">
                <button
                  className="pv-linkbtn"
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  onClick={() => onOpenPath(o.path)}
                >
                  {o.title}
                </button>
                <button className="pv-btn pv-btn--ghost pv-btn--sm" style={actionStyle} onClick={() => void deleteOrphan(o.path)}>
                  {t("common.delete", { defaultValue: "Löschen" })}
                </button>
              </div>
            ))
          ))}
        {tab === "broken" &&
          (broken.length === 0 ? (
            <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("graph.cleanupNoBroken", { defaultValue: "Keine kaputten Links." })}</span>
          ) : (
            broken.map((b, i) => (
              <div key={`${b.sourcePath}-${i}`} style={{ ...rowStyle, flexWrap: "wrap" }} data-testid="graph-cleanup-broken">
                <button
                  className="pv-linkbtn"
                  style={{ flex: 1, minWidth: 0 }}
                  onClick={() => onOpenPath(b.sourcePath)}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>[[{b.targetRaw}]]</span>
                  <span style={{ display: "block", color: "var(--text-faint)", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.sourcePath}</span>
                </button>
                <button className="pv-btn pv-btn--ghost pv-btn--sm" style={actionStyle} onClick={() => void createBrokenTarget(b)}>
                  {t("graph.cleanupCreateNote", { defaultValue: "Notiz erstellen" })}
                </button>
              </div>
            ))
          ))}
        {tab === "mentions" && (
          <>
            <button className="pv-btn pv-btn--secondary pv-btn--sm" disabled={scanning} onClick={() => void scanMentions()} data-testid="graph-cleanup-scan">
              {scanning
                ? progress
                  ? t("graph.cleanupScanning", { defaultValue: "Scanne {{current}}/{{total}}…", current: progress.current, total: progress.total })
                  : t("graph.cleanupScanningShort", { defaultValue: "Scanne…" })
                : t("graph.cleanupScan", { defaultValue: "Vault scannen" })}
            </button>
            {scanning && (
              <button className="pv-btn pv-btn--ghost pv-btn--sm" onClick={() => abortRef.current?.abort()}>
                {t("common.cancel", { defaultValue: "Abbrechen" })}
              </button>
            )}
            {mentions.map((m, i) => (
              <div key={`${m.source}-${m.target}-${i}`} style={{ ...rowStyle, flexWrap: "wrap" }} data-testid="graph-cleanup-mention">
                <button
                  className="pv-linkbtn"
                  style={{ flex: 1, minWidth: 0 }}
                  onClick={() => onOpenPath(m.source)}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>„{m.term}“</span>
                  <span style={{ display: "block", color: "var(--text-faint)", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.source}</span>
                </button>
                <button className="pv-btn pv-btn--ghost pv-btn--sm" style={actionStyle} onClick={() => void linkMention(m)} data-testid="graph-cleanup-link-mention">
                  {t("graph.acceptSuggestion", { defaultValue: "Verlinken" })}
                </button>
                <button className="pv-btn pv-btn--ghost pv-btn--sm" style={actionStyle} onClick={() => ignoreMention(m)}>
                  {t("graph.cleanupIgnore", { defaultValue: "Ignorieren" })}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
