import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  Menu,
  Plus,
  Search,
} from "lucide-react";
import { EmptyState, TextInput, renderSnippetNodes, useDebouncedValue } from "@plainva/ui";
import type { SearchResult } from "@plainva/core";
import { vaultOps, getMobileVault, type FolderListing, type MobileVault } from "./services/vaultService";
import { getSyncStatus, startSyncIfConfigured, subscribeSyncStatus } from "./services/syncService";
import { handleOAuthRedirect } from "./services/oauthService";
import { listVaults, type VaultEntry } from "./services/vaultRegistry";
import { switchVault } from "./services/vaultService";
import { App as CapApp } from "@capacitor/app";
import { EditorHost } from "./EditorHost";
import { AddVaultScreen } from "./AddVaultScreen";
import { VaultDetailScreen } from "./VaultDetailScreen";
import { useSyncExternalStore } from "react";
import { AlertTriangle, Check, Cloud, FolderClosed } from "lucide-react";

// Tab/stack shell per the mobile UX plan (E1): four tabs plus the center
// capture action; every tab keeps its own navigation stack; the tab bar
// hides while a note is open (editor focus).

type TabId = "notes" | "search" | "today" | "more";
type Entry = { kind: "folder" | "note" | "sync" | "vault"; path: string };

const todayDailyPath = () => {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return { path: `Daily/${iso}.md`, title: iso };
};

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
    return () => {
      removed = true;
      if (handle) void handle.remove();
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
    void vaultOps.createNote(vault, "Inbox", "Note").then((path) => {
      setActiveTab("notes");
      push("notes", { kind: "note", path });
    });
  };

  const openToday = () => {
    const { path, title } = todayDailyPath();
    void vaultOps.ensureNote(vault, path, "Daily Note", title).then(() => {
      setActiveTab("today");
      setStacks((s) => ({ ...s, today: [{ kind: "note", path }] }));
    });
  };

  const noteOpen = top?.kind === "note";

  return (
    <div className="m-app">
      <div className="m-screen">
        {top?.kind === "sync" ? (
          <AddVaultScreen onBack={() => pop(activeTab)} vault={vault} />
        ) : top?.kind === "vault" ? (
          <VaultDetailScreen
            activeVault={vault}
            onBack={() => pop(activeTab)}
            vaultId={top.path}
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
            onOpenFolder={(path) => push("notes", { kind: "folder", path })}
            onOpenNote={openNote}
            vault={vault}
          />
        ) : activeTab === "search" ? (
          <SearchView onOpenNote={openNote} vault={vault} />
        ) : activeTab === "today" ? (
          <TodayIntro onOpen={openToday} />
        ) : (
          <MoreView
            activeVaultId={vault.vaultId}
            onAddVault={() => push("more", { kind: "sync", path: "" })}
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
            onClick={openToday}
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

function BrowseView({
  vault,
  folder,
  bump,
  onBack,
  onOpenFolder,
  onOpenNote,
}: {
  vault: MobileVault;
  folder: string;
  bump: number;
  onBack?: () => void;
  onOpenFolder: (path: string) => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<FolderListing>({ folders: [], notes: [] });
  const [recent, setRecent] = useState<Array<{ path: string; title: string }>>([]);
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

  return (
    <div className="m-page">
      <header className="m-header">
        {onBack && (
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1>{folder ? folder.split("/").pop() : "Plainva"}</h1>
        <SyncIndicator />
      </header>
      {recent.length > 0 && (
        <>
          <p className="m-sectionlabel">{t("mobile.recent")}</p>
          {recent.map((n) => (
            <button className="m-row" key={n.path} onClick={() => onOpenNote(n.path)}>
              <FileText size={16} />
              <span>{n.title}</span>
            </button>
          ))}
          <p className="m-sectionlabel">{t("mobile.folders")}</p>
        </>
      )}
      {listing.folders.map((name) => (
        <button
          className="m-row"
          key={name}
          onClick={() => onOpenFolder(folder ? `${folder}/${name}` : name)}
        >
          <Folder className="m-accent" size={16} />
          <span>{name}</span>
          <ChevronRight className="m-chevron" size={16} />
        </button>
      ))}
      {listing.notes.map((n) => (
        <button className="m-row" key={n.path} onClick={() => onOpenNote(n.path)}>
          <FileText size={16} />
          <span>{n.title}</span>
        </button>
      ))}
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
  const title = path.split("/").pop()!.replace(/\.md$/i, "");
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    void vaultOps.read(vault, path).then((text) => {
      if (!stale) setDoc(text);
    });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  return (
    <div className="m-page m-page--note">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{title}</h1>
      </header>
      {doc !== null && (
        <EditorHost initialDoc={doc} onOpenNote={onOpenNote} path={path} vault={vault} />
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

function TodayIntro({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-page">
      <header className="m-header">
        <h1>{t("mobile.tabToday")}</h1>
      </header>
      <button className="m-row" onClick={onOpen}>
        <Calendar className="m-accent" size={16} />
        <span>{todayDailyPath().title}</span>
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
  activeVaultId,
}: {
  onAddVault: () => void;
  onOpenVault: (id: string) => void;
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
  const later = [
    t("mobile.sectionBookmarksTags"),
    t("mobile.sectionBases"),
    t("mobile.sectionSettings"),
  ];
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
      {later.map((label) => (
        <div className="m-row m-row--static" key={label}>
          <span>{label}</span>
          <span className="m-soon">{t("mobile.comingSoon")}</span>
        </div>
      ))}
    </div>
  );
}
