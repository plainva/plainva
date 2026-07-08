import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, Cloud, RefreshCw, AlertTriangle, Archive } from "lucide-react";
import { useVault } from "../contexts/VaultContext";
import { useDisplaySyncStatus } from "../services/syncStatusStore";
import { activeDocument, type ActiveDoc, type SelectionStats } from "../services/activeDocument";
import { computeEmbedInfo } from "../services/embedStats";
import { countWords } from "../lib/wordCount";
import { parseMarkdownAst } from "@plainva/core";

interface Stats { words: number; chars: number; blocks: number; }

function stripFrontmatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

function computeStats(content: string): Stats {
  const body = stripFrontmatter(content);
  const words = countWords(body);
  const chars = body.length;
  let blocks = 0;
  try {
    const ast: any = parseMarkdownAst(content);
    const children: any[] = ast?.children ?? [];
    blocks = children.filter((c) => c && c.type !== "yaml" && c.type !== "toml").length;
  } catch {
    // leave blocks at 0 on parse error
  }
  return { words, chars, blocks };
}

export function StatusBar() {
  const { t, i18n } = useTranslation();
  const { syncWorker, vaultPath } = useVault();
  // Sync status via the external store (P3/E2), with anti-flicker: a no-op
  // poll cycle every 15 s must not blink the icon.
  const { status: syncStatus } = useDisplaySyncStatus();
  const [doc, setDoc] = useState<ActiveDoc>(() => activeDocument.get());
  const [stats, setStats] = useState<Stats | null>(null);
  // Selection-aware counts (P3.9): while text is selected in the active
  // editor, words/chars show "selected / total".
  const [selStats, setSelStats] = useState<SelectionStats | null>(() => activeDocument.getSelectionStats());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setDoc(activeDocument.get());
    return activeDocument.subscribe(setDoc);
  }, []);

  useEffect(() => {
    setSelStats(activeDocument.getSelectionStats());
    return activeDocument.subscribeSelection(setSelStats);
  }, []);

  // Debounce the (potentially heavier) stats computation while typing.
  useEffect(() => {
    if (doc.kind !== "markdown") { setStats(null); return; }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStats(computeStats(doc.content)), 250);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [doc.content, doc.kind]);

  // Aggregated info for `.base`/note embeds in the current markdown page (#1).
  // Recomputes when the base row-count registry changes (embedded viewers load).
  const [baseVer, setBaseVer] = useState(0);
  useEffect(() => activeDocument.subscribeBaseEntries(() => setBaseVer((v) => v + 1)), []);
  const embedInfo = useMemo(
    () => (doc.kind === "markdown" ? computeEmbedInfo(doc.content, activeDocument.getBaseEntryCounts()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.kind, doc.content, baseVer]
  );

  const nf = useMemo(() => new Intl.NumberFormat(i18n.language || "en"), [i18n.language]);

  // Transient vault-ZIP backup segment (Gesamtplan Backups & Versionierung,
  // P7): spinner while running, brief "created" note, persistent warning on
  // errors — clicking it opens the settings (backup section lives there).
  const [backupState, setBackupState] = useState<{ state: "idle" | "running" | "done" | "error"; message?: string }>({ state: "idle" });
  const backupHideTimer = useRef<number | null>(null);
  useEffect(() => {
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent).detail as { vaultPath?: string; state?: string; message?: string };
      if (!d?.state || (d.vaultPath && vaultPath && d.vaultPath !== vaultPath)) return;
      if (backupHideTimer.current) { window.clearTimeout(backupHideTimer.current); backupHideTimer.current = null; }
      if (d.state === "done") {
        setBackupState({ state: "done" });
        backupHideTimer.current = window.setTimeout(() => setBackupState({ state: "idle" }), 5000);
      } else if (d.state === "running" || d.state === "error") {
        setBackupState({ state: d.state, message: d.message });
      }
    };
    window.addEventListener("plainva-backup-zip-status", onStatus);
    return () => {
      window.removeEventListener("plainva-backup-zip-status", onStatus);
      if (backupHideTimer.current) window.clearTimeout(backupHideTimer.current);
    };
  }, [vaultPath]);

  const parts = doc.path ? doc.path.split(/[/\\]/) : [];
  const base = parts.pop() || "";
  const dir = parts.join(" / ");

  const formatLabel = doc.kind === "base" ? "Base" : doc.kind === "markdown" ? "Markdown" : "";

  const sep: React.CSSProperties = { padding: "0 10px", borderLeft: "1px solid var(--border-color)" };

  const syncView = () => {
    // No sync target configured -> purely local vault.
    if (!syncWorker) return <span style={sep}>{t("statusbar.local", { defaultValue: "Lokal" })}</span>;
    // A sync error means we're effectively offline; mirror the warning icon shown at the
    // vault switcher. Clicking behaves like that triangle too: retry, and open the error
    // dialog (which deep-links into the provider's sync settings).
    if (syncStatus === "error") {
      return (
        <button
          type="button"
          onClick={() => {
            syncWorker.retryFailed();
            window.dispatchEvent(new CustomEvent("plainva-show-sync-error"));
          }}
          data-tip={t("sync.error")}
          style={{ ...sep, display: "inline-flex", alignItems: "center", gap: 6, font: "inherit", fontWeight: 600, color: "var(--error-text)", background: "none", borderTop: "none", borderRight: "none", borderBottom: "none", cursor: "pointer" }}
        >
          <AlertTriangle size={12} />{t("statusbar.offline", { defaultValue: "Offline" })}
        </button>
      );
    }
    // Connected: the word stays "Online"; only the icon switches (spinning while syncing, cloud when idle)
    // so it no longer flickers between two different labels every poll cycle.
    const icon = syncStatus === "syncing"
      ? <RefreshCw size={12} className="spin-animation" />
      : <Cloud size={12} />;
    return <span data-tip={syncStatus === "syncing" ? t("sync.syncing") : t("sync.idle")} style={{ ...sep, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-color)", fontWeight: 600 }}>{icon}{t("statusbar.online", { defaultValue: "Online" })}</span>;
  };

  return (
    <footer
      aria-label={t("statusbar.label", { defaultValue: "Statusleiste" })}
      style={{
        display: "flex", alignItems: "center", gap: 16, height: 28, flexShrink: 0, padding: "0 14px",
        background: "var(--bg-secondary)", borderTop: "1px solid var(--border-color)",
        fontSize: "var(--text-sm)", color: "var(--text-muted)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {doc.path ? (
          <>
            <Folder size={13} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {dir && <span>{dir}&nbsp;/&nbsp;</span>}
              <b style={{ color: "var(--text-main)", fontWeight: 600 }}>{base}</b>
            </span>
          </>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>{t("statusbar.noFile", { defaultValue: "Keine Datei geöffnet" })}</span>
        )}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {formatLabel && <span style={{ paddingRight: 10 }}>{formatLabel}</span>}
        {doc.kind === "markdown" && (
          <>
            <span style={sep}>UTF-8</span>
            <span style={sep} data-tip={selStats ? t("statusbar.selectionOfTotal", { defaultValue: "Auswahl / Gesamt" }) : undefined}>
              {selStats ? `${nf.format(selStats.words)} / ` : ""}{nf.format(stats?.words ?? 0)} {t("statusbar.words", { defaultValue: "Wörter" })}
            </span>
            <span style={sep} data-tip={selStats ? t("statusbar.selectionOfTotal", { defaultValue: "Auswahl / Gesamt" }) : undefined}>
              {selStats ? `${nf.format(selStats.chars)} / ` : ""}{nf.format(stats?.chars ?? 0)} {t("statusbar.chars", { defaultValue: "Zeichen" })}
            </span>
            <span style={sep}>{nf.format(stats?.blocks ?? 0)} {t("statusbar.blocks", { defaultValue: "Blöcke" })}</span>
            {embedInfo && embedInfo.bases > 0 && (
              <span style={sep}>{nf.format(embedInfo.bases)} {t("statusbar.bases", { defaultValue: "Bases" })} · {nf.format(embedInfo.baseEntries)} {t("statusbar.entries", { defaultValue: "Einträge" })}</span>
            )}
            {embedInfo && embedInfo.notes > 0 && (
              <span style={sep}>{nf.format(embedInfo.notes)} {t("statusbar.embeds", { defaultValue: "Einbettungen" })}</span>
            )}
          </>
        )}
        {doc.kind === "base" && (
          <span style={sep}>{nf.format(doc.meta.entries ?? 0)} {t("statusbar.entries", { defaultValue: "Einträge" })}</span>
        )}
        {backupState.state === "running" && (
          <span data-testid="statusbar-backup-running" style={{ ...sep, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Archive size={12} className="spin-animation" />{t("statusbar.backupRunning", { defaultValue: "Backup läuft…" })}
          </span>
        )}
        {backupState.state === "done" && (
          <span data-testid="statusbar-backup-done" style={{ ...sep, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-color)" }}>
            <Archive size={12} />{t("statusbar.backupDone", { defaultValue: "Backup erstellt" })}
          </span>
        )}
        {backupState.state === "error" && (
          <button
            type="button"
            data-testid="statusbar-backup-error"
            onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings"))}
            data-tip={backupState.message || t("statusbar.backupError", { defaultValue: "Backup fehlgeschlagen" })}
            style={{ ...sep, display: "inline-flex", alignItems: "center", gap: 6, font: "inherit", fontWeight: 600, color: "var(--error-text)", background: "none", borderTop: "none", borderRight: "none", borderBottom: "none", cursor: "pointer" }}
          >
            <AlertTriangle size={12} />{t("statusbar.backupError", { defaultValue: "Backup fehlgeschlagen" })}
          </button>
        )}
        {syncView()}
      </div>
    </footer>
  );
}
