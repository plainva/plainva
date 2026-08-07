import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Link2, Plus, Trash2 } from "lucide-react";
import { GraphService, type BrokenLinkInfo, type GraphNodeInfo, type GraphSuggestion } from "@plainva/core";
import {
  applyMentionLink,
  Button,
  createConnectedNote,
  EmptyState,
  getGraphState,
  type GraphStateStore,
  ICON,
  Segmented,
  suggestionKey,
  toast,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { confirmDeleteFile } from "../lib/deleteFile";
import { getMobileSettings } from "../services/mobileSettings";
import { syncSoon } from "../services/syncService";
import type { MobileVault } from "../services/vaultService";

/**
 * Cleanup mode (S35) — the desktop's worklist, mobile-sized.
 *
 * Three questions a vault answers badly on its own: what is unreachable
 * (orphans), what points nowhere (broken links), and where a note is spoken
 * about without being linked (mentions). `GraphService` has answered all three
 * since the graph existed; the phone could show the problem on the map and
 * offer nothing to do about it.
 *
 * The mention scan stays ON DEMAND and abortable. It reads every note in the
 * vault — the one operation here that costs real time on a phone — and starting
 * it because someone merely opened a screen would be a poor trade.
 *
 * Deleting an orphan goes through `confirmDeleteFile`, the same cascade dialog
 * every other delete entry uses: an orphan is not a lesser file because a graph
 * called it unreachable.
 */
type Tab = "orphans" | "broken" | "mentions";

export function CleanupScreen({
  vault,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("orphans");
  const [orphans, setOrphans] = useState<GraphNodeInfo[]>([]);
  const [broken, setBroken] = useState<BrokenLinkInfo[]>([]);
  const [mentions, setMentions] = useState<GraphSuggestion[]>([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [store, setStore] = useState<GraphStateStore | null>(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const service = vault.queryService;
    if (!service) return;
    let alive = true;
    void (async () => {
      try {
        const graph = new GraphService(service.db);
        const model = await graph.loadGraph({ includeAttachments: false });
        const [o, b] = await Promise.all([graph.getOrphans(model), graph.getBrokenLinks(model)]);
        const gs = getGraphState(vault.files);
        await gs.load().catch(() => {});
        if (!alive) return;
        setStore(gs);
        setOrphans(o);
        setBroken(b);
      } catch {
        /* cold index — the empty states stay */
      }
    })();
    return () => {
      alive = false;
      // The dismissal write is debounced; leaving without flushing loses a
      // rejection made a moment earlier — and a rejection that does not stick
      // is the surface telling you your answer did not count.
      void getGraphState(vault.files).flush();
    };
  }, [vault, tick]);

  const scanMentions = useCallback(async () => {
    const service = vault.queryService;
    if (!service) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setProgress(null);
    try {
      const graph = new GraphService(service.db);
      const found = await graph.findUnlinkedMentions({
        signal: controller.signal,
        onProgress: (current, total) => setProgress({ current, total }),
      });
      // A mention someone already rejected must not return with every scan.
      setMentions(found.filter((m) => !store?.isDismissed(suggestionKey(m.reason, m.source, m.target))));
      setScanned(true);
    } catch {
      /* aborted or failed: the previous list stays */
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [vault, store]);

  const titleOf = (path: string) => path.split("/").pop()?.replace(/\.md$/i, "") ?? path;

  const deleteOrphan = async (path: string) => {
    const ok = await confirmDeleteFile(vault, path, titleOf(path), t);
    if (ok) setTick((n) => n + 1);
  };

  const createTarget = async (item: BrokenLinkInfo) => {
    const service = vault.queryService;
    if (!service) return;
    try {
      const folder = item.sourcePath.includes("/")
        ? item.sourcePath.substring(0, item.sourcePath.lastIndexOf("/"))
        : "";
      const title = item.targetRaw.split(/[/\\]/).pop()!.replace(/#.*$/, "");
      const path = await createConnectedNote(vault.files, service, {
        folder,
        title,
        noteType: getMobileSettings().defaultNoteType,
      });
      setBroken((prev) => prev.filter((b) => b !== item));
      syncSoon();
      toast.info(t("graph.cleanupCreated", { name: path }));
    } catch {
      toast.error(t("graph.cleanupActionFailed"));
    }
  };

  const linkMention = async (item: GraphSuggestion) => {
    const service = vault.queryService;
    if (!service || !item.term) return;
    try {
      const ok = await applyMentionLink(vault.files, service, item.source, item.target, item.term);
      if (ok) {
        store?.dismissSuggestion(suggestionKey(item.reason, item.source, item.target));
        setMentions((prev) => prev.filter((m) => m !== item));
        syncSoon();
        toast.info(t("graph.cleanupLinked"));
      } else {
        // The passage moved or was linked meanwhile: say so rather than
        // silently doing nothing.
        toast.warning(t("graph.cleanupMentionGone"));
      }
    } catch {
      toast.error(t("graph.cleanupActionFailed"));
    }
  };

  const ignoreMention = (item: GraphSuggestion) => {
    store?.dismissSuggestion(suggestionKey(item.reason, item.source, item.target));
    setMentions((prev) => prev.filter((m) => m !== item));
  };

  const scanLabel = scanning
    ? progress
      ? t("graph.cleanupScanning", { current: progress.current, total: progress.total })
      : t("graph.cleanupScanningShort")
    : t("graph.cleanupScan");

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("graph.cleanupTitle")} />
      <Segmented
        ariaLabel={t("graph.cleanupTitle")}
        onChange={(v) => setTab(v)}
        options={[
          { value: "orphans" as Tab, label: `${t("graph.cleanupOrphans")} (${orphans.length})`, testId: "cleanup-orphans" },
          { value: "broken" as Tab, label: `${t("graph.cleanupBroken")} (${broken.length})`, testId: "cleanup-broken" },
          { value: "mentions" as Tab, label: `${t("graph.cleanupMentions")} (${mentions.length})`, testId: "cleanup-mentions" },
        ]}
        value={tab}
      />

      {tab === "orphans" &&
        (orphans.length === 0 ? (
          <EmptyState icon={<FileText size={ICON.empty} />}>{t("graph.cleanupNoOrphans")}</EmptyState>
        ) : (
          orphans.map((o) => (
            <div className="m-row m-row--split" data-testid="cleanup-orphan" key={o.path}>
              <button className="m-row-main" onClick={() => onOpenNote(o.path)}>
                <span className="m-rowicon">
                  <FileText size={ICON.head} />
                </span>
                <span className="m-row-txt">{o.title || titleOf(o.path)}</span>
              </button>
              <Button onClick={() => void deleteOrphan(o.path)} variant="ghost">
                <Trash2 size={ICON.ui} />
              </Button>
            </div>
          ))
        ))}

      {tab === "broken" &&
        (broken.length === 0 ? (
          <EmptyState icon={<Link2 size={ICON.empty} />}>{t("graph.cleanupNoBroken")}</EmptyState>
        ) : (
          broken.map((b, i) => (
            <div className="m-row m-row--split" data-testid="cleanup-broken" key={`${b.sourcePath}-${b.targetRaw}-${i}`}>
              <button className="m-row-main" onClick={() => onOpenNote(b.sourcePath)}>
                <span className="m-rowicon">
                  <Link2 size={ICON.head} />
                </span>
                <span className="m-row-txt">
                  {`[[${b.targetRaw}]]`}
                  <small>{titleOf(b.sourcePath)}</small>
                </span>
              </button>
              <Button onClick={() => void createTarget(b)} variant="ghost">
                <Plus size={ICON.ui} />
              </Button>
            </div>
          ))
        ))}

      {tab === "mentions" && (
        <>
          <div className="m-turninto">
            <Button disabled={scanning} onClick={() => void scanMentions()} variant="tonal">
              {scanLabel}
            </Button>
            {scanning && (
              <Button onClick={() => abortRef.current?.abort()} variant="ghost">
                {t("common.cancel")}
              </Button>
            )}
          </div>
          {mentions.length === 0 ? (
            /* Before the scan this is not an empty result, it is a job not yet
               started — so it offers the job. After it, nothing found IS the
               answer and there is nothing to offer (N7). */
            <EmptyState
              action={
                scanned || scanning ? undefined : (
                  <Button data-testid="cleanup-mentions-scan" onClick={() => void scanMentions()} variant="tonal">
                    {t("graph.cleanupScan")}
                  </Button>
                )
              }
              icon={<Link2 size={ICON.empty} />}
            >
              {scanned ? t("graph.cleanupNoMentions") : t("graph.cleanupMentionsHint")}
            </EmptyState>
          ) : (
            mentions.map((m, i) => (
              <div className="m-suggest" data-testid="cleanup-mention" key={`${m.source}-${m.target}-${i}`}>
                <p className="m-suggest-eyebrow">{titleOf(m.source)}</p>
                {/* No quotation marks around the term: they differ per
                    language, and hardcoding one language's pair here would put
                    German quotes into nine other apps. */}
                <p className="m-suggest-text">
                  <b>{m.term}</b> {`→ [[${titleOf(m.target)}]]`}
                </p>
                <div className="m-suggest-actions">
                  <Button onClick={() => void linkMention(m)} variant="tonal">
                    {t("graph.acceptSuggestion")}
                  </Button>
                  <Button onClick={() => ignoreMention(m)} variant="ghost">
                    {t("graph.cleanupIgnore")}
                  </Button>
                  <Button onClick={() => onOpenNote(m.source)} variant="ghost">
                    {t("mobile.sheetOpen")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
