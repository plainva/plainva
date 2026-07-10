import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  Folder,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { EmptyState, TextInput, renderSnippetNodes, useDebouncedValue } from "@plainva/ui";
import type { SearchResult } from "@plainva/core";
import { vaultOps, getMobileVault, type FolderListing, type MobileVault } from "./services/vaultService";
import { getSyncStatus, startSyncIfConfigured, subscribeSyncStatus, syncNow } from "./services/syncService";
import { handleOAuthRedirect } from "./services/oauthService";
import { listVaults, type VaultEntry } from "./services/vaultRegistry";
import { switchVault } from "./services/vaultService";
import { App as CapApp } from "@capacitor/app";
import { Dialog } from "@capacitor/dialog";
import { BaseReadView } from "./BaseReadView";
import { SettingsScreen } from "./SettingsScreen";
import { TagsScreen } from "./TagsScreen";
import { BookmarksScreen } from "./BookmarksScreen";
import { getMobileSettings, updateMobileSettings } from "./services/mobileSettings";
import { EditorHost } from "./EditorHost";
import { AddVaultScreen } from "./AddVaultScreen";
import { VaultDetailScreen } from "./VaultDetailScreen";
import { useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Bookmark,
  Check,
  Cloud,
  CopyPlus,
  FolderClosed,
  FolderInput,
  FolderPlus,
  Hash,
  Info,
} from "lucide-react";

// Tab/stack shell per the mobile UX plan (E1): four tabs plus the center
// capture action; every tab keeps its own navigation stack; the tab bar
// hides while a note is open (editor focus).

type TabId = "notes" | "search" | "today" | "more";
type Entry = {
  kind: "folder" | "note" | "sync" | "vault" | "base" | "settings" | "tags" | "bookmarks";
  path: string;
};

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(
    2,
    "0",
  )}`;

const dailyPathFor = (iso: string) => ({
  path: `${getMobileSettings().dailyFolder}/${iso}.md`,
  title: iso,
});

export default function App() {
  const { t } = useTranslation();
  const [vault, setVault] = useState<MobileVault | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("notes");
  const [stacks, setStacks] = useState<Record<TabId, Entry[]>>({
    notes: [],
    search: [],
    today: [],
    more: [],
  });
  const [bump, setBump] = useState(0);
  const [onboarded, setOnboarded] = useState(getMobileSettings().onboarded);

  useEffect(() => {
    void getMobileVault().then((v) => {
      setVault(v);
      void startSyncIfConfigured(v);
    });
    const onChanged = () => setBump((n) => n + 1);
    // Vault switch (M3.5 isolation): drop all stacks, reboot the vault and
    // restart sync for the newly active container.
    const onSwitched = () => {
      setVault(null);
      setStacks({ notes: [], search: [], today: [], more: [] });
      setActiveTab("more");
      void getMobileVault().then((v) => {
        setVault(v);
        setBump((n) => n + 1);
        void startSyncIfConfigured(v);
      });
    };
    window.addEventListener("m-vault-changed", onChanged);
    window.addEventListener("m-vault-switched", onSwitched);
    return () => {
      window.removeEventListener("m-vault-changed", onChanged);
      window.removeEventListener("m-vault-switched", onSwitched);
    };
  }, []);

  // OAuth redirect (M3): the system browser returns via the custom scheme.
  // appUrlOpen covers the warm app; getLaunchUrl covers a cold start where
  // the redirect itself launched the app.
  useEffect(() => {
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("appUrlOpen", ({ url }) => {
      void handleOAuthRedirect(url);
    }).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    void CapApp.getLaunchUrl().then((r) => {
      if (r?.url) void handleOAuthRedirect(r.url);
    });
    // Returning to the app pulls a fresh full listing: WebView timers pause
    // in the background, so without this a user could wait forever for new
    // remote files (they only arrive through listings).
    let stateHandle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) syncNow();
    }).then((h) => {
      if (removed) void h.remove();
      else stateHandle = h;
    });
    return () => {
      removed = true;
      if (handle) void handle.remove();
      if (stateHandle) void stateHandle.remove();
    };
  }, []);

  // Android back gesture/button: pop the active tab's stack instead of
  // closing the app; minimize only from a tab root (platform convention).
  useEffect(() => {
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("backButton", () => {
      const st = stacks[activeTab];
      if (st.length > 0) {
        setStacks((s) => ({ ...s, [activeTab]: s[activeTab].slice(0, -1) }));
        setBump((n) => n + 1);
      } else {
        void CapApp.minimizeApp();
      }
    }).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      if (handle) void handle.remove();
    };
  });

  if (!vault) return <div className="m-app" />;

  const stack = stacks[activeTab];
  const top = stack[stack.length - 1];

  const push = (tab: TabId, entry: Entry) =>
    setStacks((s) => ({ ...s, [tab]: [...s[tab], entry] }));
  const pop = (tab: TabId) => {
    setStacks((s) => ({ ...s, [tab]: s[tab].slice(0, -1) }));
    setBump((n) => n + 1);
  };

  const openNote = (path: string) => push(activeTab, { kind: "note", path });

  const capture = () => {
    // Context-aware (P3): capture into the folder the user is looking at.
    const notesTop = stacks.notes[stacks.notes.length - 1];
    const folder = activeTab === "notes" && notesTop?.kind === "folder" ? notesTop.path : "Inbox";
    void vaultOps.createNote(vault, folder, "Note").then((path) => {
      setActiveTab("notes");
      push("notes", { kind: "note", path });
    });
  };

  const openDaily = (iso: string) => {
    const { path, title } = dailyPathFor(iso);
    void vaultOps.ensureNote(vault, path, "Daily Note", title).then(() => {
      setActiveTab("today");
      setStacks((s) => ({ ...s, today: [{ kind: "note", path }] }));
    });
  };

  const noteOpen = top?.kind === "note";

  const finishOnboarding = (connectCloud: boolean) => {
    setOnboarded(true);
    void updateMobileSettings({ onboarded: true });
    if (connectCloud) {
      setActiveTab("more");
      setStacks((s) => ({ ...s, more: [{ kind: "sync", path: "" }] }));
    }
  };


  return (
    <div className="m-app">
      {!onboarded && (
        <div className="m-onboarding">
          <h1>{t("mobile.onboardingTitle")}</h1>
          <p className="m-hint">{t("mobile.onboardingBody")}</p>
          <button className="m-onboarding-card" onClick={() => finishOnboarding(false)}>
            <FileText className="m-accent" size={22} />
            <span className="m-onboarding-label">{t("mobile.onboardingLocal")}</span>
            <span className="m-onboarding-desc">{t("mobile.onboardingLocalDesc")}</span>
          </button>
          <button className="m-onboarding-card" onClick={() => finishOnboarding(true)}>
            <Cloud className="m-accent" size={22} />
            <span className="m-onboarding-label">{t("mobile.onboardingCloud")}</span>
            <span className="m-onboarding-desc">{t("mobile.onboardingCloudDesc")}</span>
          </button>
        </div>
      )}
      <div className="m-screen">
        {top?.kind === "tags" ? (
          <TagsScreen
            key={top.path}
            onBack={() => pop(activeTab)}
            onOpenNote={openNote}
            onOpenTag={(tag) => push(activeTab, { kind: "tags", path: tag })}
            tag={top.path}
            vault={vault}
          />
        ) : top?.kind === "bookmarks" ? (
          <BookmarksScreen onBack={() => pop(activeTab)} onOpenNote={openNote} vault={vault} />
        ) : top?.kind === "settings" ? (
          <SettingsScreen onBack={() => pop(activeTab)} />
        ) : top?.kind === "sync" ? (
          <AddVaultScreen onBack={() => pop(activeTab)} vault={vault} />
        ) : top?.kind === "vault" ? (
          <VaultDetailScreen
            activeVault={vault}
            onBack={() => pop(activeTab)}
            vaultId={top.path}
          />
        ) : top?.kind === "base" ? (
          <BaseReadView
            key={top.path}
            onBack={() => pop(activeTab)}
            onOpenNote={openNote}
            path={top.path}
            vault={vault}
          />
        ) : top?.kind === "note" ? (
          <NoteView
            key={top.path}
            onBack={() => pop(activeTab)}
            onOpenNote={openNote}
            path={top.path}
            vault={vault}
          />
        ) : activeTab === "notes" ? (
          <BrowseView
            bump={bump}
            folder={top?.kind === "folder" ? top.path : ""}
            onBack={top ? () => pop("notes") : undefined}
            onOpenBase={(path) => push("notes", { kind: "base", path })}
            onOpenFolder={(path) => push("notes", { kind: "folder", path })}
            onOpenNote={openNote}
            vault={vault}
          />
        ) : activeTab === "search" ? (
          <SearchView onOpenNote={openNote} vault={vault} />
        ) : activeTab === "today" ? (
          <TodayView onOpenDate={openDaily} />
        ) : (
          <MoreView
            activeVaultId={vault.vaultId}
            onAddVault={() => push("more", { kind: "sync", path: "" })}
            onOpenBookmarks={() => push("more", { kind: "bookmarks", path: "" })}
            onOpenSettings={() => push("more", { kind: "settings", path: "" })}
            onOpenTags={() => push("more", { kind: "tags", path: "" })}
            onOpenVault={(id) => push("more", { kind: "vault", path: id })}
          />
        )}
      </div>

      {!noteOpen && (
        <nav aria-label="Tabs" className="m-tabbar">
          <TabButton
            active={activeTab === "notes"}
            icon={<FileText size={20} />}
            label={t("mobile.tabNotes")}
            onClick={() => setActiveTab("notes")}
          />
          <TabButton
            active={activeTab === "search"}
            icon={<Search size={20} />}
            label={t("mobile.tabSearch")}
            onClick={() => setActiveTab("search")}
          />
          <button aria-label={t("mobile.newNote")} className="m-fab" onClick={capture}>
            <Plus size={22} />
          </button>
          <TabButton
            active={activeTab === "today"}
            icon={<Calendar size={20} />}
            label={t("mobile.tabToday")}
            onClick={() => setActiveTab("today")}
          />
          <TabButton
            active={activeTab === "more"}
            icon={<Menu size={20} />}
            label={t("mobile.tabMore")}
            onClick={() => setActiveTab("more")}
          />
        </nav>
      )}
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`m-tab${active ? " is-active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Long-press hook for the note sheet (M4/E7): 500 ms hold opens actions. */
function useLongPress(onLongPress: (path: string, title: string) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const start = (path: string, title: string) => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress(path, title);
    }, 500);
  };
  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const clicked = () => {
    const fired = firedRef.current;
    firedRef.current = false;
    return !fired;
  };
  return { start, clear, clicked };
}

function BrowseView({
  vault,
  folder,
  bump,
  onBack,
  onOpenFolder,
  onOpenNote,
  onOpenBase,
}: {
  vault: MobileVault;
  folder: string;
  bump: number;
  onBack?: () => void;
  onOpenFolder: (path: string) => void;
  onOpenNote: (path: string) => void;
  onOpenBase: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<FolderListing>({ folders: [], notes: [], bases: [] });
  const [recent, setRecent] = useState<Array<{ path: string; title: string }>>([]);
  const [sheet, setSheet] = useState<{ path: string; title: string; isFolder?: boolean } | null>(
    null,
  );
  const [movePick, setMovePick] = useState<{ path: string; title: string } | null>(null);
  const [moveFolders, setMoveFolders] = useState<string[]>([]);
  const press = useLongPress((path, title) => setSheet({ path, title }));
  const folderPress = useLongPress((path, title) => setSheet({ path, title, isFolder: true }));
  useEffect(() => {
    let stale = false;
    void vaultOps.listFolder(vault, folder).then((l) => {
      if (!stale) setListing(l);
    });
    if (!folder) {
      void vaultOps.recent(vault, 2).then((r) => {
        if (!stale) setRecent(r);
      });
    }
    return () => {
      stale = true;
    };
  }, [vault, folder, bump]);

  const noteRow = (n: { path: string; title: string }) => (
    <button
      className="m-row"
      key={n.path}
      onClick={() => {
        if (press.clicked()) onOpenNote(n.path);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setSheet({ path: n.path, title: n.title });
      }}
      onPointerCancel={press.clear}
      onPointerDown={() => press.start(n.path, n.title)}
      onPointerLeave={press.clear}
      onPointerUp={press.clear}
    >
      <FileText size={16} />
      <span>{n.title}</span>
    </button>
  );

  const createFolder = () => {
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.newFolder"),
        message: t("mobile.newFolderPrompt"),
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed) return;
      await vaultOps.createFolder(vault, folder ? `${folder}/${trimmed}` : trimmed);
    })();
  };

  const renameFolder = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        inputText: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      const parent = target.path.split("/").slice(0, -1).join("/");
      await vaultOps.renameFolder(vault, target.path, parent ? `${parent}/${trimmed}` : trimmed);
    })();
  };

  const deleteFolder = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value } = await Dialog.confirm({
        title: t("mobile.deleteFolder"),
        message: t("mobile.deleteFolderConfirm", { name: target.title }),
      });
      if (!value) return;
      await vaultOps.removeFolder(vault, target.path);
    })();
  };

  const startMove = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const folders = vault.queryService ? await vault.queryService.getAllFolders() : [];
      setMoveFolders(folders);
      setMovePick(target);
    })();
  };

  const duplicateNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void vaultOps.duplicateNote(vault, target.path).then((copy) => onOpenNote(copy));
  };

  const bookmarkNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void vaultOps.toggleBookmark(vault, target.path);
  };

  const renameNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.vaultRename"),
        message: t("mobile.renamePrompt"),
        inputText: target.title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === target.title) return;
      await vaultOps.rename(vault, target.path, trimmed);
    })();
  };

  const deleteNote = (target: { path: string; title: string }) => {
    setSheet(null);
    void (async () => {
      const { value } = await Dialog.confirm({
        title: t("mobile.deleteNote"),
        message: t("mobile.deleteNoteConfirm", { name: target.title }),
      });
      if (!value) return;
      await vaultOps.remove(vault, target.path);
    })();
  };

  return (
    <div className="m-page">
      <header className="m-header">
        {onBack && (
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1>{folder ? folder.split("/").pop() : "Plainva"}</h1>
        <button aria-label={t("mobile.newFolder")} className="m-iconbtn" onClick={createFolder}>
          <FolderPlus size={20} />
        </button>
        <SyncIndicator />
      </header>
      {recent.length > 0 && (
        <>
          <p className="m-sectionlabel">{t("mobile.recent")}</p>
          {recent.map(noteRow)}
          <p className="m-sectionlabel">{t("mobile.folders")}</p>
        </>
      )}
      {listing.folders.map((name) => {
        const full = folder ? `${folder}/${name}` : name;
        return (
          <button
            className="m-row"
            key={name}
            onClick={() => {
              if (folderPress.clicked()) onOpenFolder(full);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSheet({ path: full, title: name, isFolder: true });
            }}
            onPointerCancel={folderPress.clear}
            onPointerDown={() => folderPress.start(full, name)}
            onPointerLeave={folderPress.clear}
            onPointerUp={folderPress.clear}
          >
            <Folder className="m-accent" size={16} />
            <span>{name}</span>
            <ChevronRight className="m-chevron" size={16} />
          </button>
        );
      })}
      {listing.bases.map((b) => (
        <button className="m-row" key={b.path} onClick={() => onOpenBase(b.path)}>
          <Database className="m-accent" size={16} />
          <span>{b.title}</span>
          <ChevronRight className="m-chevron" size={16} />
        </button>
      ))}
      {listing.notes.map(noteRow)}

      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <p className="m-sheet-title">{sheet.title}</p>
            <button
              className="m-row"
              onClick={() => {
                setSheet(null);
                if (sheet.isFolder) onOpenFolder(sheet.path);
                else onOpenNote(sheet.path);
              }}
            >
              {sheet.isFolder ? <Folder size={16} /> : <FileText size={16} />}
              <span>{t("mobile.sheetOpen")}</span>
            </button>
            {!sheet.isFolder && (
              <>
                <button className="m-row" onClick={() => startMove(sheet)}>
                  <FolderInput size={16} />
                  <span>{t("mobile.moveNote")}</span>
                </button>
                <button className="m-row" onClick={() => duplicateNote(sheet)}>
                  <CopyPlus size={16} />
                  <span>{t("mobile.duplicateNote")}</span>
                </button>
                <button className="m-row" onClick={() => bookmarkNote(sheet)}>
                  <Bookmark size={16} />
                  <span>{t("mobile.toggleBookmark")}</span>
                </button>
              </>
            )}
            <button
              className="m-row"
              onClick={() => (sheet.isFolder ? renameFolder(sheet) : renameNote(sheet))}
            >
              <Pencil size={16} />
              <span>{t("mobile.vaultRename")}</span>
            </button>
            <button
              className="m-row m-danger"
              onClick={() => (sheet.isFolder ? deleteFolder(sheet) : deleteNote(sheet))}
            >
              <Trash2 size={16} />
              <span>{sheet.isFolder ? t("mobile.deleteFolder") : t("mobile.deleteNote")}</span>
            </button>
          </div>
        </div>
      )}

      {movePick && (
        <div className="m-sheet-backdrop" onClick={() => setMovePick(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <p className="m-sheet-title">{t("mobile.moveNoteTo", { name: movePick.title })}</p>
            {["", ...moveFolders].map((dest) => (
              <button
                className="m-row"
                key={dest || "/"}
                onClick={() => {
                  const target = movePick;
                  setMovePick(null);
                  void vaultOps.moveNote(vault, target.path, dest);
                }}
              >
                <Folder className="m-accent" size={16} />
                <span>{dest || t("mobile.vaultRoot")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteView({
  vault,
  path,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.md$/i, "");
  const [doc, setDoc] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [info, setInfo] = useState<{
    props: Array<[string, string]>;
    backlinks: Array<{ path: string; title: string }>;
  } | null>(null);
  // Read-first (M4/E5): notes open rendered and read-only; the pen flips
  // into editing (and back), which also shows the keyboard toolbar.
  const [editing, setEditing] = useState(getMobileSettings().defaultView === "edit");
  useEffect(() => {
    let stale = false;
    void vaultOps.read(vault, path).then((text) => {
      if (!stale) setDoc(text);
    });
    void vaultOps.getBookmarks(vault).then((marks) => {
      if (!stale) setMarked(marks.includes(path));
    });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  const openInfo = () => {
    void (async () => {
      const q = vault.queryService;
      const props: Array<[string, string]> = [];
      const backlinks: Array<{ path: string; title: string }> = [];
      if (q) {
        const raw = await q.getFileProperties(path);
        for (const [k, v] of Object.entries(raw)) {
          props.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
        }
        const links = await q.getBacklinks(path);
        const seen = new Set<string>();
        for (const l of links) {
          if (seen.has(l.source_path)) continue;
          seen.add(l.source_path);
          backlinks.push({
            path: l.source_path,
            title: l.source_path.split("/").pop()!.replace(/\.md$/i, ""),
          });
        }
      }
      setInfo({ props, backlinks });
    })();
  };

  return (
    <div className="m-page m-page--note">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{title}</h1>
        <button
          aria-label={t("mobile.toggleBookmark")}
          aria-pressed={marked}
          className={`m-iconbtn${marked ? " is-active" : ""}`}
          onClick={() =>
            void vaultOps.toggleBookmark(vault, path).then((next) => setMarked(next))
          }
        >
          <Bookmark fill={marked ? "currentColor" : "none"} size={20} />
        </button>
        <button aria-label={t("mobile.noteInfo")} className="m-iconbtn" onClick={openInfo}>
          <Info size={20} />
        </button>
        <button
          aria-label={editing ? t("mobile.doneEditing") : t("mobile.editNote")}
          aria-pressed={editing}
          className={`m-iconbtn${editing ? " is-active" : ""}`}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? <Check size={20} /> : <Pencil size={20} />}
        </button>
      </header>
      {doc !== null && (
        <EditorHost
          editable={editing}
          initialDoc={doc}
          onOpenNote={onOpenNote}
          path={path}
          vault={vault}
        />
      )}

      {info && (
        <div className="m-sheet-backdrop" onClick={() => setInfo(null)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <p className="m-sheet-title">{t("mobile.noteInfo")}</p>
            {info.props.length > 0 && (
              <>
                <p className="m-sectionlabel">{t("mobile.properties")}</p>
                {info.props.map(([k, v]) => (
                  <div className="m-row m-row--static" key={k}>
                    <span className="m-prop-key">{k}</span>
                    <span className="m-prop-val">{v}</span>
                  </div>
                ))}
              </>
            )}
            <p className="m-sectionlabel">{t("mobile.backlinks")}</p>
            {info.backlinks.length === 0 ? (
              <p className="m-hint">{t("mobile.noBacklinks")}</p>
            ) : (
              info.backlinks.map((b) => (
                <button
                  className="m-row"
                  key={b.path}
                  onClick={() => {
                    setInfo(null);
                    onOpenNote(b.path);
                  }}
                >
                  <FileText size={16} />
                  <span>{b.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchView({
  vault,
  onOpenNote,
}: {
  vault: MobileVault;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 150);
  const [results, setResults] = useState<SearchResult[]>([]);
  useEffect(() => {
    if (!vault.searchAvailable || !debounced.trim()) {
      setResults([]);
      return;
    }
    let stale = false;
    void vaultOps.search(vault, debounced).then((rows) => {
      if (!stale) setResults(rows);
    });
    return () => {
      stale = true;
    };
  }, [vault, debounced]);

  return (
    <div className="m-page">
      <header className="m-header">
        <h1>{t("mobile.tabSearch")}</h1>
      </header>
      <TextInput
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("mobile.tabSearch")}
        value={query}
      />
      {!vault.searchAvailable ? (
        <EmptyState icon={<Search size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : (
        results.map((r) => (
          <button className="m-row m-result" key={r.path} onClick={() => onOpenNote(r.path)}>
            <FileText size={16} />
            <span>
              <span className="m-result-title">{r.path.split("/").pop()!.replace(/\.md$/i, "")}</span>
              {r.snippet ? (
                <span className="m-result-snippet">{renderSnippetNodes(r.snippet)}</span>
              ) : null}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function TodayView({ onOpenDate }: { onOpenDate: (iso: string) => void }) {
  const { t, i18n: i18nInstance } = useTranslation();
  // Date strip (M4/E6): the last weeks plus tomorrow, today preselected.
  const days: Date[] = [];
  for (let offset = -27; offset <= 1; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  const todayIso = isoOf(new Date());
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Land on today (the strip starts four weeks back).
    stripRef.current
      ?.querySelector(".is-today")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  const weekday = new Intl.DateTimeFormat(i18nInstance.language, { weekday: "short" });
  return (
    <div className="m-page">
      <header className="m-header">
        <h1>{t("mobile.tabToday")}</h1>
      </header>
      <div className="m-datestrip" ref={stripRef}>
        {days.map((d) => {
          const iso = isoOf(d);
          return (
            <button
              className={`m-datestrip-day${iso === todayIso ? " is-today" : ""}`}
              key={iso}
              onClick={() => onOpenDate(iso)}
            >
              <span className="m-datestrip-wd">{weekday.format(d)}</span>
              <span className="m-datestrip-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <button className="m-row" onClick={() => onOpenDate(todayIso)}>
        <Calendar className="m-accent" size={16} />
        <span>{todayIso}</span>
        <ChevronRight className="m-chevron" size={16} />
      </button>
    </div>
  );
}

function SyncIndicator() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  if (status.status === "off") return null;
  return (
    <span className="m-headicon">
      {status.status === "error" ? (
        <AlertTriangle className="m-error" size={16} />
      ) : (
        <Cloud className={status.status === "syncing" ? "m-chevron" : "m-accent"} size={16} />
      )}
    </span>
  );
}

function MoreView({
  onAddVault,
  onOpenVault,
  onOpenSettings,
  onOpenTags,
  onOpenBookmarks,
  activeVaultId,
}: {
  onAddVault: () => void;
  onOpenVault: (id: string) => void;
  onOpenSettings: () => void;
  onOpenTags: () => void;
  onOpenBookmarks: () => void;
  activeVaultId: string;
}) {
  const { t } = useTranslation();
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  useEffect(() => {
    const reload = () => void listVaults().then(setVaults);
    reload();
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [activeVaultId]);
  const later = [t("mobile.sectionBases")];
  return (
    <div className="m-page">
      <header className="m-header">
        <h1>{t("mobile.tabMore")}</h1>
      </header>
      <div className="m-row m-row--static">
        <span className="m-section-label">{t("mobile.vaults")}</span>
      </div>
      {vaults.map((v) => {
        const active = v.id === activeVaultId;
        return (
          <div className="m-row m-row--split" key={v.id}>
            <button
              className="m-row-main"
              disabled={active}
              onClick={() => void switchVault(v.id)}
            >
              <FolderClosed className={active ? "m-accent" : "m-chevron"} size={16} />
              <span>{v.name || t("mobile.vaultLocal")}</span>
              {active && <Check className="m-accent" size={16} />}
            </button>
            <button
              aria-label={t("mobile.vaultDetails")}
              className="m-iconbtn"
              onClick={() => onOpenVault(v.id)}
            >
              <ChevronRight className="m-chevron" size={18} />
            </button>
          </div>
        );
      })}
      <button className="m-row" onClick={onAddVault}>
        <Cloud className="m-accent" size={16} />
        <span>{t("mobile.vaultAdd")}</span>
        <ChevronRight className="m-chevron" size={16} />
      </button>
      <button className="m-row" onClick={onOpenTags}>
        <Hash className="m-accent" size={16} />
        <span>{t("mobile.tags")}</span>
        <ChevronRight className="m-chevron" size={16} />
      </button>
      <button className="m-row" onClick={onOpenBookmarks}>
        <Bookmark className="m-accent" size={16} />
        <span>{t("mobile.bookmarks")}</span>
        <ChevronRight className="m-chevron" size={16} />
      </button>
      <button className="m-row" onClick={onOpenSettings}>
        <SettingsIcon className="m-accent" size={16} />
        <span>{t("mobile.sectionSettings")}</span>
        <ChevronRight className="m-chevron" size={16} />
      </button>
      {later.map((label) => (
        <div className="m-row m-row--static" key={label}>
          <span>{label}</span>
          <span className="m-soon">{t("mobile.comingSoon")}</span>
        </div>
      ))}
    </div>
  );
}
