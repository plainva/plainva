import { useMemo, useState } from "react";
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
import { EmptyState, TextInput } from "@plainva/ui";
import { memoryVault } from "./vault/memoryVault";
import { EditorHost } from "./EditorHost";

// Tab/stack shell per the mobile UX plan (E1): four tabs plus the center
// capture action; every tab keeps its own navigation stack; the tab bar
// hides while a note is open (editor focus).

type TabId = "notes" | "search" | "today" | "more";
type Entry = { kind: "folder" | "note"; path: string };

const todayDailyPath = () => {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return { path: `Daily/${iso}.md`, title: iso };
};

export default function App() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("notes");
  const [stacks, setStacks] = useState<Record<TabId, Entry[]>>({
    notes: [],
    search: [],
    today: [],
    more: [],
  });
  const [bump, setBump] = useState(0);

  const stack = stacks[activeTab];
  const top = stack[stack.length - 1];

  const push = (tab: TabId, entry: Entry) =>
    setStacks((s) => ({ ...s, [tab]: [...s[tab], entry] }));
  const pop = (tab: TabId) => setStacks((s) => ({ ...s, [tab]: s[tab].slice(0, -1) }));

  const openNote = (path: string) => push(activeTab, { kind: "note", path });

  const capture = () => {
    const path = memoryVault.createNote("Inbox", "Note");
    setActiveTab("notes");
    push("notes", { kind: "note", path });
    setBump((n) => n + 1);
  };

  const openToday = () => {
    const { path, title } = todayDailyPath();
    memoryVault.ensureNote(path, "Daily Note", title);
    setActiveTab("today");
    setStacks((s) => ({ ...s, today: [{ kind: "note", path }] }));
  };

  const noteOpen = top?.kind === "note";

  return (
    <div className="m-app">
      <div className="m-screen">
        {top?.kind === "note" ? (
          <NoteView path={top.path} onBack={() => pop(activeTab)} onOpenNote={openNote} />
        ) : activeTab === "notes" ? (
          <BrowseView
            folder={top?.kind === "folder" ? top.path : ""}
            key={`${top?.path ?? "root"}-${bump}`}
            onBack={top ? () => pop("notes") : undefined}
            onOpenFolder={(path) => push("notes", { kind: "folder", path })}
            onOpenNote={openNote}
          />
        ) : activeTab === "search" ? (
          <SearchView />
        ) : activeTab === "today" ? (
          <TodayIntro onOpen={openToday} />
        ) : (
          <MoreView />
        )}
      </div>

      {!noteOpen && (
        <nav className="m-tabbar" aria-label="Tabs">
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
  folder,
  onBack,
  onOpenFolder,
  onOpenNote,
}: {
  folder: string;
  onBack?: () => void;
  onOpenFolder: (path: string) => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { folders, notes } = useMemo(() => memoryVault.listFolder(folder), [folder]);
  const recent = useMemo(() => (folder ? [] : memoryVault.recent(2)), [folder]);
  return (
    <div className="m-page">
      <header className="m-header">
        {onBack && (
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1>{folder ? folder.split("/").pop() : "Hello Vault"}</h1>
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
      {folders.map((name) => (
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
      {notes.map((n) => (
        <button className="m-row" key={n.path} onClick={() => onOpenNote(n.path)}>
          <FileText size={16} />
          <span>{n.title}</span>
        </button>
      ))}
    </div>
  );
}

function NoteView({
  path,
  onBack,
  onOpenNote,
}: {
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const title = path.split("/").pop()!.replace(/\.md$/i, "");
  return (
    <div className="m-page m-page--note">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{title}</h1>
      </header>
      <EditorHost onOpenNote={onOpenNote} path={path} />
    </div>
  );
}

function SearchView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  return (
    <div className="m-page">
      <header className="m-header">
        <h1>{t("mobile.tabSearch")}</h1>
      </header>
      <TextInput
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("sidebar.searchPlaceholder", { defaultValue: t("mobile.tabSearch") })}
        value={query}
      />
      <EmptyState icon={<Search size={20} />}>{t("mobile.comingSoon")}</EmptyState>
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

function MoreView() {
  const { t } = useTranslation();
  const sections = [
    t("mobile.sectionVaultSync"),
    t("mobile.sectionBookmarksTags"),
    t("mobile.sectionBases"),
    t("mobile.sectionSettings"),
  ];
  return (
    <div className="m-page">
      <header className="m-header">
        <h1>{t("mobile.tabMore")}</h1>
      </header>
      {sections.map((label) => (
        <div className="m-row m-row--static" key={label}>
          <span>{label}</span>
          <span className="m-soon">{t("mobile.comingSoon")}</span>
        </div>
      ))}
    </div>
  );
}
