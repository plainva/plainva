import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@plainva/ui";
import { AuxTitleBar } from "./components/AuxTitleBar";
import { MarkdownReader } from "./components/MarkdownReader";
import { useVault } from "./contexts/VaultContext";
import { currentWindowParams } from "./services/windowContext";
import { getWindowBus } from "./services/windowBus";

/**
 * The shell of an auxiliary window (multi-window P0).
 *
 * It renders the content it was opened with and nothing else: no ribbon, no
 * sidebars, no status bar, no settings. The vault behind it runs in client
 * mode — reads local, writes over the bus — so everything on screen comes from
 * the same index the central window writes.
 *
 * P0 shows the note read-only. That is not a placeholder but the honest state
 * of the foundation: it proves the whole client chain (window params, client
 * vault, index connection, broadcast) end to end, and P1 replaces the reader
 * with the real editor whose saves go through `RemoteVaultAdapter`.
 */
export function AuxApp() {
  const { t } = useTranslation();
  const params = currentWindowParams();
  const { vaultAdapter, isLoading, error } = useVault();
  const [content, setContent] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  // Bumped when the owner reports that this file changed on disk.
  const [reloadTick, setReloadTick] = useState(0);

  const path = params.content;
  const title = path ? path.split("/").pop() || path : "Plainva";

  useEffect(() => {
    if (!vaultAdapter || !path) return;
    let cancelled = false;
    vaultAdapter
      .readTextFile(path)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setReadError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setReadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultAdapter, path, reloadTick]);

  // The index (and the watcher feeding it) belongs to the owner; it reports
  // what moved. Without this an auxiliary window would show a stale note after
  // a sync pull or an edit in the central window.
  useEffect(() => {
    if (!path) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void getWindowBus()
      .then(async (bus) => {
        const un = await bus.onBroadcast("index-changed", ({ paths, structural }) => {
          // A structural change carries no path list — reload rather than
          // guess, a re-read of one file is cheap.
          if (structural || paths.length === 0 || paths.includes(path)) setReloadTick((n) => n + 1);
        });
        if (cancelled) un();
        else stop = un;
      })
      .catch(() => {
        /* no bus: a single window has nothing to follow */
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [path]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)" }}>
      <AuxTitleBar title={title} />
      <main style={{ flex: 1, minHeight: 0, overflow: "auto" }} data-testid="aux-content">
        {!path && <EmptyState>{t("editor.emptyPane")}</EmptyState>}
        {path && error && <EmptyState>{error}</EmptyState>}
        {path && !error && readError && <EmptyState>{readError}</EmptyState>}
        {path && !error && !readError && content === null && !isLoading && (
          <EmptyState>{t("editor.emptyPane")}</EmptyState>
        )}
        {path && content !== null && <MarkdownReader content={content} sourcePath={path} />}
      </main>
    </div>
  );
}
