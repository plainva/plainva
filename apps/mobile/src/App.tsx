import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Calendar,
  Cloud,
  Database as DatabaseIcon,
  FileText,
  FolderPlus,
  MoreVertical,
  Plus,
  Search,
  StickyNote,
} from "lucide-react";
import { vaultOps, getMobileVault, type MobileVault } from "./services/vaultService";
import { getSyncStatus, startSyncIfConfigured, subscribeSyncStatus, syncNow } from "./services/syncService";
import { handleOAuthRedirect } from "./services/oauthService";
import { App as CapApp } from "@capacitor/app";
import { Dialog } from "@capacitor/dialog";
import { BaseScreen } from "./screens/base/BaseScreen";
import { createDatabase } from "./services/baseOps";
import { SettingsScreen } from "./SettingsScreen";
import { TagsScreen } from "./TagsScreen";
import { BookmarksScreen } from "./BookmarksScreen";
import { getMobileSettings, updateMobileSettings } from "./services/mobileSettings";
import { AddVaultScreen } from "./AddVaultScreen";
import { VaultDetailScreen } from "./VaultDetailScreen";
import { BrowseScreen, createFolderPrompt } from "./screens/BrowseScreen";
import { NoteScreen } from "./screens/NoteScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { DatabasesScreen } from "./screens/DatabasesScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { sanitizeTabSlots, TAB_POOL, type TabScreenId } from "./navigation";
import { useLongPress } from "./lib/useLongPress";
import { isoOf } from "./lib/dates";

// Tab/stack shell (rebuilt in R2): the bottom bar carries up to four
// user-chosen screens around the fixed ＋ (M3 navigation bar); search and
// the More menu live in the top app bar. Every tab keeps its own stack; the
// bar hides while a note is open (editor focus).

type Entry = {
  kind:
    | "folder"
    | "note"
    | "sync"
    | "vault"
    | "base"
    | "settings"
    | "tags"
    | "bookmarks"
    | "search"
    | "more"
    | "today"
    | "calendar"
    | "databases";
  path: string;
};

const EMPTY_STACKS = (): Record<TabScreenId, Entry[]> => ({
  notes: [],
  today: [],
  tags: [],
  bookmarks: [],
  calendar: [],
  databases: [],
});

const dailyPathFor = (iso: string) => ({
  path: `${getMobileSettings().dailyFolder}/${iso}.md`,
  title: iso,
});

/** Pool-screen id -> pushable stack entry (More menu, R2.5). */
const SCREEN_ENTRY: Record<TabScreenId, Entry> = {
  notes: { kind: "folder", path: "" },
  today: { kind: "today", path: "" },
  tags: { kind: "tags", path: "" },
  bookmarks: { kind: "bookmarks", path: "" },
  calendar: { kind: "calendar", path: "" },
  databases: { kind: "databases", path: "" },
};

export default function App() {
  const { t } = useTranslation();
  const [vault, setVault] = useState<MobileVault | null>(null);
  const [slots, setSlots] = useState<TabScreenId[]>(() =>
    sanitizeTabSlots(getMobileSettings().tabSlots),
  );
  const [activeTab, setActiveTab] = useState<TabScreenId>(slots[0]);
  const [stacks, setStacks] = useState<Record<TabScreenId, Entry[]>>(EMPTY_STACKS);
  const [bump, setBump] = useState(0);
  const [onboarded, setOnboarded] = useState(getMobileSettings().onboarded);
  const [quickCreate, setQuickCreate] = useState(false);
  // ＋: tap captures, long-press opens the quick-create sheet (R3).
  const fabPress = useLongPress<undefined>(() => setQuickCreate(true));

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
      setStacks(EMPTY_STACKS());
      void getMobileVault().then((v) => {
        setVault(v);
        setBump((n) => n + 1);
        void startSyncIfConfigured(v);
      });
    };
    // Live settings (R2.2): re-read the tab slots when settings change.
    const onSettings = () => {
      const next = sanitizeTabSlots(getMobileSettings().tabSlots);
      setSlots((prev) => (prev.join() === next.join() ? prev : next));
      setActiveTab((tab) => (next.includes(tab) ? tab : next[0]));
    };
    window.addEventListener("m-vault-changed", onChanged);
    window.addEventListener("m-vault-switched", onSwitched);
    window.addEventListener("m-settings-changed", onSettings);
    return () => {
      window.removeEventListener("m-vault-changed", onChanged);
      window.removeEventListener("m-vault-switched", onSwitched);
      window.removeEventListener("m-settings-changed", onSettings);
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
      // Going to the background: Android may kill the process without any
      // further callback (M1) — flush pending editor saves NOW, best-effort.
      else void import("./services/vaultService").then(({ noteSaver }) => noteSaver.flushAll()).catch(() => {});
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

  const push = (tab: TabScreenId, entry: Entry) =>
    setStacks((s) => ({ ...s, [tab]: [...s[tab], entry] }));
  const pop = (tab: TabScreenId) => {
    setStacks((s) => ({ ...s, [tab]: s[tab].slice(0, -1) }));
    setBump((n) => n + 1);
  };

  const openNote = (path: string) => push(activeTab, { kind: "note", path });
  const openBase = (path: string) => push(activeTab, { kind: "base", path });

  /** The folder the user is looking at (capture + new-folder context). */
  const browseFolder = () => {
    const notesTop = stacks.notes[stacks.notes.length - 1];
    return activeTab === "notes" && notesTop?.kind === "folder" ? notesTop.path : "";
  };

  const capture = () => {
    // Context-aware (P3): capture into the folder the user is looking at.
    const folder = browseFolder() || "Inbox";
    void vaultOps.createNote(vault, folder, "Note").then((path) => {
      if (slots.includes("notes")) setActiveTab("notes");
      push(slots.includes("notes") ? "notes" : activeTab, { kind: "note", path });
    });
  };

  const openDaily = (iso: string) => {
    const { path, title } = dailyPathFor(iso);
    // Push into the active stack: back returns to Today/Calendar (R2).
    void vaultOps.ensureNote(vault, path, "Daily Note", title).then(() => openNote(path));
  };

  const noteOpen = top?.kind === "note";

  const finishOnboarding = (connectCloud: boolean) => {
    setOnboarded(true);
    void updateMobileSettings({ onboarded: true });
    if (connectCloud) push(activeTab, { kind: "sync", path: "" });
  };

  const quickNewFolder = () => {
    setQuickCreate(false);
    createFolderPrompt(vault, browseFolder(), t);
  };

  // New database (R4.5): name prompt, stored in the folder the user is
  // looking at, one table view sourced on that folder (shared serializer).
  const quickNewDatabase = () => {
    setQuickCreate(false);
    void (async () => {
      const { value, cancelled } = await Dialog.prompt({
        title: t("mobile.newDatabase"),
        message: t("mobile.newDatabasePrompt"),
      });
      const name = value?.trim().replace(/[\\/]/g, "-");
      if (cancelled || !name) return;
      const path = await createDatabase(vault, browseFolder(), name, t("database.viewTable"));
      push(activeTab, { kind: "base", path });
    })();
  };

  const activeDef = TAB_POOL.find((p) => p.id === activeTab)!;

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

      {!top && (
        <header className="m-topbar">
          <h1>{activeTab === "notes" ? "Plainva" : t(activeDef.labelKey)}</h1>
          <span className="m-headactions">
            {activeTab === "notes" && (
              <button
                aria-label={t("mobile.newFolder")}
                className="m-iconbtn"
                onClick={() => createFolderPrompt(vault, "", t)}
              >
                <FolderPlus size={22} />
              </button>
            )}
            <button
              aria-label={t("mobile.tabSearch")}
              className="m-iconbtn"
              onClick={() => push(activeTab, { kind: "search", path: "" })}
            >
              <Search size={22} />
            </button>
            <button
              aria-label={t("mobile.tabMore")}
              className="m-iconbtn"
              onClick={() => push(activeTab, { kind: "more", path: "" })}
            >
              <MoreVertical size={22} />
            </button>
            <SyncIndicator />
          </span>
        </header>
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
          <BaseScreen
            key={top.path}
            onBack={() => pop(activeTab)}
            onOpenNote={openNote}
            path={top.path}
            vault={vault}
          />
        ) : top?.kind === "note" ? (
          <NoteScreen
            key={top.path}
            onBack={() => pop(activeTab)}
            onOpenNote={openNote}
            path={top.path}
            vault={vault}
          />
        ) : top?.kind === "search" ? (
          <SearchScreen onBack={() => pop(activeTab)} onOpenNote={openNote} vault={vault} />
        ) : top?.kind === "more" ? (
          <MoreScreen
            activeVaultId={vault.vaultId}
            onAddVault={() => push(activeTab, { kind: "sync", path: "" })}
            onBack={() => pop(activeTab)}
            onOpenScreen={(id) => push(activeTab, SCREEN_ENTRY[id])}
            onOpenSettings={() => push(activeTab, { kind: "settings", path: "" })}
            onOpenVault={(id) => push(activeTab, { kind: "vault", path: id })}
          />
        ) : top?.kind === "today" ? (
          <TodayScreen onBack={() => pop(activeTab)} onOpenDate={openDaily} />
        ) : top?.kind === "calendar" ? (
          <CalendarScreen bump={bump} onBack={() => pop(activeTab)} onOpenDate={openDaily} vault={vault} />
        ) : top?.kind === "databases" ? (
          <DatabasesScreen bump={bump} onBack={() => pop(activeTab)} onOpenBase={openBase} vault={vault} />
        ) : top?.kind === "folder" ? (
          <BrowseScreen
            bump={bump}
            folder={top.path}
            onBack={() => pop(activeTab)}
            onOpenBase={openBase}
            onOpenFolder={(path) => push(activeTab, { kind: "folder", path })}
            onOpenNote={openNote}
            vault={vault}
          />
        ) : activeTab === "notes" ? (
          <BrowseScreen
            bump={bump}
            folder=""
            onOpenBase={openBase}
            onOpenFolder={(path) => push("notes", { kind: "folder", path })}
            onOpenNote={openNote}
            vault={vault}
          />
        ) : activeTab === "today" ? (
          <TodayScreen onOpenDate={openDaily} />
        ) : activeTab === "tags" ? (
          <TagsScreen
            onOpenNote={openNote}
            onOpenTag={(tag) => push("tags", { kind: "tags", path: tag })}
            tag=""
            vault={vault}
          />
        ) : activeTab === "bookmarks" ? (
          <BookmarksScreen onOpenNote={openNote} vault={vault} />
        ) : activeTab === "calendar" ? (
          <CalendarScreen bump={bump} onOpenDate={openDaily} vault={vault} />
        ) : (
          <DatabasesScreen bump={bump} onOpenBase={openBase} vault={vault} />
        )}
      </div>

      {!noteOpen && (
        <nav aria-label="Tabs" className="m-tabbar">
          {slots.slice(0, 2).map((id) => (
            <TabButton def={TAB_POOL.find((p) => p.id === id)!} key={id} active={activeTab === id} onClick={() => setActiveTab(id)} />
          ))}
          <button
            aria-label={t("mobile.newNote")}
            className="m-fab"
            onClick={() => {
              if (fabPress.clicked()) capture();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setQuickCreate(true);
            }}
            onPointerCancel={fabPress.clear}
            onPointerDown={() => fabPress.start(undefined)}
            onPointerLeave={fabPress.clear}
            onPointerUp={fabPress.clear}
          >
            <Plus size={24} />
          </button>
          {slots.slice(2).map((id) => (
            <TabButton def={TAB_POOL.find((p) => p.id === id)!} key={id} active={activeTab === id} onClick={() => setActiveTab(id)} />
          ))}
        </nav>
      )}

      {quickCreate && (
        <div className="m-sheet-backdrop" onClick={() => setQuickCreate(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <p className="m-sheet-title">{t("mobile.quickCreate")}</p>
            <button
              className="m-row"
              onClick={() => {
                setQuickCreate(false);
                capture();
              }}
            >
              <StickyNote size={18} />
              <span>{t("mobile.newNote")}</span>
            </button>
            <button
              className="m-row"
              onClick={() => {
                setQuickCreate(false);
                openDaily(isoOf(new Date()));
              }}
            >
              <Calendar size={18} />
              <span>{t("mobile.newDaily")}</span>
            </button>
            <button className="m-row" onClick={quickNewFolder}>
              <FolderPlus size={18} />
              <span>{t("mobile.newFolder")}</span>
            </button>
            <button className="m-row" onClick={quickNewDatabase}>
              <DatabaseIcon size={18} />
              <span>{t("mobile.newDatabase")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  def,
  active,
  onClick,
}: {
  def: (typeof TAB_POOL)[number];
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = def.icon;
  return (
    <button className={`m-tab${active ? " is-active" : ""}`} onClick={onClick}>
      <span className="m-tab-pill">
        <Icon size={20} />
      </span>
      <span className="m-tab-label">{t(def.labelKey)}</span>
    </button>
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
