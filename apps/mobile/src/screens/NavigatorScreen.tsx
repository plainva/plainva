import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Database, FileText, Settings, Sun } from "lucide-react";
import { Chip, DocIcon, ICON, noteDisplayName, Segmented } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { SyncIndicator } from "../components/SyncIndicator";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { relTimeAt } from "../lib/relTime";
import { getMobileSettings } from "../services/mobileSettings";
import { getNavigatorTab, setNavigatorTab, type NavigatorTab } from "../services/navigatorPlace";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { BrowseScreen } from "./BrowseScreen";
import { DatabasesScreen } from "./DatabasesScreen";
import { TagsScreen } from "../TagsScreen";

/**
 * The navigator (redesign P2 / S9) — the mobile shape of the desktop's LEFT
 * sidebar, and the answer to "what do I have?".
 *
 * The desktop puts three tabs (Files / Tags / Databases) under two pinned
 * sections (Recently opened / Bookmarks). Mobile had the same five things as
 * five SEPARATE destinations: three of them were tabs competing for the
 * navigation bar with the mail client and the calendar, and the other two were
 * a carousel and a chip row buried in the file listing.
 *
 * That is the redesign's decisive cut (plan §2.1): the navigation bar carries
 * WORK surfaces; everything that answers "what do I have" lives here. Tags,
 * bookmarks and databases lose their tab status in the same step — silently,
 * per decision E3: there are no users but the maintainer yet.
 *
 * It also removes a genuine inconsistency: the same list entry behaved
 * differently depending on whether its area happened to sit in the bar (in the
 * bar → tab switch; outside → an overlay push with NO tab lit).
 */
export function NavigatorScreen({
  vault,
  vaultName,
  bump,
  onSearch,
  onOpenNote,
  onOpenAttachment,
  onOpenBase,
  onOpenFolder,
  onOpenTag,
  onOpenSettings,
  onCreateDatabase,
  onCreateNote,
}: {
  vault: MobileVault;
  vaultName: string;
  bump: number;
  onSearch: () => void;
  onOpenNote: (path: string) => void;
  onOpenAttachment: (path: string, isImage: boolean) => void;
  onOpenBase: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenSettings?: () => void;
  /** Without this the root Files pane — an empty vault's landing surface —
   *  rendered no empty state at all, not even the sentence (S45). */
  onCreateNote?: () => void;
  onCreateDatabase?: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<NavigatorTab>(getNavigatorTab);
  // The remembered section can also be cleared from OUTSIDE this screen — an
  // explicit Home tap does exactly that (N1.4). Without following the setting
  // the reset would be invisible whenever the navigator happens to stay
  // mounted: already at the notes root on a phone, and permanently so in the
  // two-column layout, where this screen never unmounts at all.
  useEffect(() => {
    const onChanged = () => setTab(getNavigatorTab());
    window.addEventListener("m-settings-changed", onChanged);
    return () => window.removeEventListener("m-settings-changed", onChanged);
  }, []);
  const [recent, setRecent] = useState<Array<{ path: string; title: string; rel?: string }>>([]);
  const [marks, setMarks] = useState<string[]>([]);
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  useEffect(() => {
    let stale = false;
    // Real MRU first; the mtime fallback covers a first run (nothing opened
    // yet, but synced files exist).
    void vaultOps.getRecents(vault, 8).then(async (r) => {
      const list = r.length > 0 ? r : await vaultOps.recent(vault, 4);
      // Relative-time labels are computed here — effects may read the clock,
      // render must stay pure for the React compiler.
      const now = Date.now();
      if (!stale) {
        setRecent(
          list.map((e) => ({
            path: e.path,
            title: e.title,
            rel: relTimeAt(now, (e as { openedAt?: number }).openedAt) ?? undefined,
          })),
        );
      }
    });
    void vaultOps.getBookmarks(vault).then((b) => {
      if (!stale) setMarks(b.slice(0, 8));
    });
    if (vault.queryService) {
      void vault.queryService
        .getDocumentIcons()
        .then((m) => {
          if (!stale) setDocIcons(m);
        })
        .catch(() => {});
    }
    return () => {
      stale = true;
    };
  }, [vault, bump]);

  const caroIcon = (p: string) => {
    const custom = docIcons.get(p);
    if (custom) return <DocIcon color={custom.color} icon={custom.icon} size={ICON.ui} />;
    if (/\.base$/i.test(p)) return <Database size={ICON.ui} />;
    const daily = getMobileSettings().dailyFolder;
    if (p.startsWith(`${daily}/`)) return <Sun size={ICON.ui} />;
    return <FileText size={ICON.ui} />;
  };

  const pick = (next: NavigatorTab) => {
    setTab(next);
    setNavigatorTab(next);
  };

  return (
    <div className="m-page" ref={ptrRef}>
      {/* The vault's own surface, so its state belongs here: the sync cloud sat
          in the shell's head until S11 and would otherwise be nowhere. */}
      <AppBar large onSearch={onSearch} title={vaultName} actions={<SyncIndicator />} />
      {ptrIndicator}

      {/* Pinned sections, exactly the desktop's `leftSections` — above the
          tabs, because they answer "where was I" before "what is there". */}
      {recent.length > 0 && (
        <>
          <p className="m-sectionlabel">{t("mobile.recent")}</p>
          <div className="m-caro">
            {recent.map((n) => (
              <button
                className="pv-card pv-card--flat m-caro-card"
                key={n.path}
                // A mousedown on a half-visible card focuses it, the browser
                // auto-scrolls it into view, and the click lands elsewhere —
                // suppress the focus scroll (keyboard focus is unaffected).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onOpenNote(n.path)}
              >
                <span className="m-caro-ic">{caroIcon(n.path)}</span>
                <b>{n.title}</b>
                <span className="m-caro-sub">
                  {n.rel ?? (n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : t("mobile.vaultRoot"))}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {marks.length > 0 && (
        <>
          <p className="m-sectionlabel">{t("mobile.bookmarks")}</p>
          <div className="m-chiprow">
            {marks.map((p) => (
              <Chip key={p} onClick={() => onOpenNote(p)}>
                <Bookmark size={ICON.meta} />
                {noteDisplayName(p)}
              </Chip>
            ))}
          </div>
        </>
      )}

      {/* The desktop's own left-tab labels, verbatim: the phone shows the same
          three tabs, so it says the same three words in all ten languages —
          and needs no new keys to do it. */}
      <Segmented
        ariaLabel={t("sidebar.viewSwitch", { defaultValue: "Ansicht" })}
        options={[
          { value: "files", label: t("sidebar.files"), testId: "navigator-files" },
          { value: "tags", label: t("sidebar.tags"), testId: "navigator-tags" },
          { value: "databases", label: t("sidebar.databases"), testId: "navigator-databases" },
        ]}
        value={tab}
        onChange={(v) => pick(v as NavigatorTab)}
      />

      {tab === "files" ? (
        <BrowseScreen
          bump={bump}
          folder=""
          onCreateNote={onCreateNote}
          onOpenAttachment={onOpenAttachment}
          onOpenBase={onOpenBase}
          onOpenFolder={onOpenFolder}
          onOpenNote={onOpenNote}
          pane
          vault={vault}
        />
      ) : tab === "tags" ? (
        <TagsScreen bump={bump} onOpenNote={onOpenNote} onOpenTag={onOpenTag} pane tag="" vault={vault} />
      ) : (
        <DatabasesScreen bump={bump} onCreate={onCreateDatabase} onOpenBase={onOpenBase} pane vault={vault} />
      )}

      {/* Settings sit at the FOOT of the navigator, where the desktop's rail
          keeps them — and no longer behind a ⋮. A three-dot menu means actions
          on the object that is open; app settings are not that (redesign § 4). */}
      {onOpenSettings && (
        <button className="m-row m-row--foot" data-testid="nav-settings" onClick={onOpenSettings}>
          <span className="m-rowicon">
            <Settings size={ICON.head} />
          </span>
          <span>{t("mobile.sectionSettings")}</span>
        </button>
      )}
    </div>
  );
}
