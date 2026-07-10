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
import { EditorHost } from "./EditorHost";
import { SyncScreen } from "./SyncScreen";
import { useSyncExternalStore } from "react";
import { AlertTriangle, Cloud } from "lucide-react";

// Tab/stack shell per the mobile UX plan (E1): four tabs plus the center
// capture action; every tab keeps its own navigation stack; the tab bar
// hides while a note is open (editor focus).

type TabId = "notes" | "search" | "today" | "more";
type Entry = { kind: "folder" | "note" | "sync"; path: string };

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
    window.addEventListener("m-vault-changed", onChanged);
    return () => window.removeEventListener("m-vault-changed", onChanged);
  }, []);

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
          <SyncScreen onBack={() => pop(activeTab)} vault={vault} />
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
          <MoreView onOpenSync={() => push("more", { kind: "sync", path: "" })} />
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

function MoreView({ onOpenSync }: { onOpenSync: () => void }) {
  const { t } = useTranslation();
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
      <button className="m-row" onClick={onOpenSync}>
        <Cloud className="m-accent" size={16} />
        <span>{t("mobile.sectionVaultSync")}</span>
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
