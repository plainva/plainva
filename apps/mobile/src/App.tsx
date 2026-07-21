import { useCallback, useEffect, useRef, useState } from "react";
import { SheetGrip } from "./components/SheetGrip";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Cloud,
  Database as DatabaseIcon,
  Ellipsis,
  FileText,
  FolderPlus,
  Plus,
  StickyNote,
} from "lucide-react";
import { getVaultTemplates, scaffoldVaultTemplate } from "@plainva/ui";
import { vaultOps, getMobileVault, createLocalVault, type MobileVault } from "./services/vaultService";
import { createProviderFolder, foregroundSync, listProviderFolders, startSyncIfConfigured } from "./services/syncService";
import { startPim, stopPim } from "./services/pim/pimService";
import { cancelConnect, finishConnect, getPendingConnect, handleOAuthRedirect } from "./services/oauthService";
import { handlePimOAuthRedirect } from "./services/pim/pimOAuth";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { App as CapApp } from "@capacitor/app";
import { mPrompt, mSelect } from "./services/mobileDialogs";
import { TemplatePickSheet } from "./components/TemplatePickSheet";
import { BaseScreen } from "./screens/base/BaseScreen";
import { createDatabase } from "./services/baseOps";
import { SettingsScreen } from "./SettingsScreen";
import { TagsScreen } from "./TagsScreen";
import { BookmarksScreen } from "./BookmarksScreen";
import { getMobileSettings, updateMobileSettings } from "./services/mobileSettings";
import { AddVaultScreen } from "./AddVaultScreen";
import { VaultDetailScreen } from "./VaultDetailScreen";
import { BrowseScreen, createFolderPrompt } from "./screens/BrowseScreen";
import { TabHead } from "./components/TabHead";
import { AppearanceScreen } from "./screens/AppearanceScreen";
import { getActiveVaultEntry } from "./services/vaultRegistry";
import { NoteScreen } from "./screens/NoteScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { PimCalendarScreen } from "./screens/PimCalendarScreen";
import { PimAccountsScreen } from "./screens/PimAccountsScreen";
import { DatabasesScreen } from "./screens/DatabasesScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { GraphScreen } from "./screens/GraphScreen";
import { AboutAreaScreen, BackupAreaScreen, ContentAreaScreen, EditorAreaScreen } from "./screens/SettingsAreaScreens";
import { VaultsScreen } from "./screens/VaultsScreen";
import { CloudAccountsScreen } from "./screens/CloudAccountsScreen";
import {
  backStep,
  barTabs,
  initialNavState,
  navTop,
  popTop,
  pushCapturedNote,
  pushEntry,
  sanitizeTabSlots,
  tapTab,
  TAB_POOL,
  type NavEntry,
  type NavState,
  type TabScreenId,
} from "./navigation";
import { consumePendingShare, type PendingShare } from "./services/shareTarget";
import { haptics } from "./services/haptics";
import { isoOf } from "./lib/dates";

// Tab/stack shell (rebuilt in R2): the bottom bar carries up to four
// user-chosen screens around the fixed ＋ (M3 navigation bar); search and
// the More menu live in the top app bar. Every tab keeps its own stack; the
// bar hides while a note is open (editor focus). R3.1 moved app-wide screens
// (search/More/settings/vault) into an overlay stack ABOVE the tabs — any
// bottom-bar tap dismisses them, tapping the active tab returns to its root.

const dailyPathFor = (iso: string) => ({
  path: `${getMobileSettings().dailyFolder}/${iso}.md`,
  title: iso,
});

/** Pool-screen id -> pushable stack entry (More menu, R2.5). */
const SCREEN_ENTRY: Record<TabScreenId, NavEntry> = {
  notes: { kind: "folder", path: "" },
  today: { kind: "today", path: "" },
  tags: { kind: "tags", path: "" },
  bookmarks: { kind: "bookmarks", path: "" },
  calendar: { kind: "calendar", path: "" },
  databases: { kind: "databases", path: "" },
  graph: { kind: "graphmap", path: "" },
};

export default function App() {
  const { i18n, t } = useTranslation();
  const [vault, setVault] = useState<MobileVault | null>(null);
  const [slots, setSlots] = useState<TabScreenId[]>(() =>
    sanitizeTabSlots(getMobileSettings().tabSlots),
  );
  const [nav, setNav] = useState<NavState>(() => initialNavState(slots[0]));
  const [bump, setBump] = useState(0);
  const [onboarded, setOnboarded] = useState(getMobileSettings().onboarded);
  const [quickCreate, setQuickCreate] = useState(false);
  const [oauthPick, setOauthPick] = useState(false);
  // Stable so the picker's navigation effect doesn't re-fetch every render.
  const oauthListFolders = useCallback((p: string) => {
    const prov = getPendingConnect();
    return prov ? listProviderFolders(prov, p) : Promise.resolve([]);
  }, []);
  const oauthCreateFolder = useCallback((p: string) => {
    const prov = getPendingConnect();
    return prov ? createProviderFolder(prov, p) : Promise.resolve();
  }, []);
  const [fromTemplate, setFromTemplate] = useState(false);
  // The Android back listener registers once; it reads the live state here.
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);
  const vaultRef = useRef(vault);
  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);
  // Package J intents: the [] URL effect and the resume poll only park them
  // here; the PendingIntentRunner below (rendered after the vault guard)
  // executes them with the real capture/openDaily closures.
  const [pendingShortcut, setPendingShortcut] = useState<string | null>(null);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  useEffect(() => {
    const onShortcut = (e: Event) => setPendingShortcut(String((e as CustomEvent).detail?.which ?? ""));
    const onPollShare = () => {
      void consumePendingShare().then((share) => {
        if (share) setPendingShare(share);
      });
    };
    window.addEventListener("m-shortcut", onShortcut);
    window.addEventListener("m-poll-share", onPollShare);
    onPollShare(); // cold start: the stashed intent is already waiting
    return () => {
      window.removeEventListener("m-shortcut", onShortcut);
      window.removeEventListener("m-poll-share", onPollShare);
    };
  }, []);

  const [vaultName, setVaultName] = useState("Plainva");
  useEffect(() => {
    void getMobileVault().then((v) => {
      setVault(v);
      void startSyncIfConfigured(v);
      void startPim(v);
    });
    void getActiveVaultEntry().then((e) => setVaultName(e.name || "Plainva"));
    const onChanged = () => setBump((n) => n + 1);
    // Vault switch (M3.5 isolation): drop all stacks (and any overlay), then
    // reboot the vault and restart sync for the newly active container.
    const onSwitched = () => {
      stopPim();
      setVault(null);
      setNav((s) => initialNavState(s.activeTab));
      void getMobileVault().then((v) => {
        setVault(v);
        setBump((n) => n + 1);
        void startSyncIfConfigured(v);
        void startPim(v);
      });
      void getActiveVaultEntry().then((e) => setVaultName(e.name || "Plainva"));
    };
    // Live settings (R2.2): re-read the tab order when settings change. The
    // active tab must stay a BAR tab (first three) — rearranging the active
    // one out of the bar falls back to the first bar slot.
    const onSettings = () => {
      const next = sanitizeTabSlots(getMobileSettings().tabSlots);
      setSlots((prev) => (prev.join() === next.join() ? prev : next));
      setNav((s) => (barTabs(next).includes(s.activeTab) ? s : { ...s, activeTab: barTabs(next)[0] }));
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

  // Live snapshot retention (package G): settings changes reach the active
  // vault's backup adapter without a reboot.
  useEffect(() => {
    if (!vault?.backup) return;
    const onSettings = () => {
      const ms = getMobileSettings();
      vault.backup?.updatePolicy({
        minSnapshotIntervalSeconds: ms.backupIntervalSeconds,
        maxBackupsPerFile: ms.backupMaxPerFile,
        maxAgeDays: ms.backupMaxAgeDays,
      });
    };
    window.addEventListener("m-settings-changed", onSettings);
    return () => window.removeEventListener("m-settings-changed", onSettings);
  }, [vault]);

  // Connect-time folder pick (#10): the OAuth redirect fires this event once it
  // holds a token; the picker browses the cloud folders and finishConnect then
  // creates the (fresh, isolated) vault with the chosen root.
  useEffect(() => {
    const onChoose = () => setOauthPick(true);
    window.addEventListener("plainva-oauth-choose-folder", onChoose);
    return () => window.removeEventListener("plainva-oauth-choose-folder", onChoose);
  }, []);

  // OAuth redirect (M3): the system browser returns via the custom scheme.
  // appUrlOpen covers the warm app; getLaunchUrl covers a cold start where
  // the redirect itself launched the app.
  useEffect(() => {
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    const routeAppUrl = async (url: string) => {
      // Launcher shortcuts (package J) ride the app scheme.
      if (url.startsWith("com.plainva.app://shortcut/")) {
        const which = url.split("/").pop();
        window.dispatchEvent(new CustomEvent("m-shortcut", { detail: { which } }));
        return;
      }
      // PIM (calendar) OAuth first — it only consumes a redirect matching its
      // own pending state, otherwise the sync handler takes it.
      if (await handlePimOAuthRedirect(url)) return;
      void handleOAuthRedirect(url);
    };
    void CapApp.addListener("appUrlOpen", ({ url }) => {
      void routeAppUrl(url);
    }).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    void CapApp.getLaunchUrl().then((r) => {
      if (r?.url) void routeAppUrl(r.url);
    });
    // Returning to the app pulls a fresh full listing (throttled to once a
    // minute in foregroundSync): WebView timers pause in the background, so
    // without this a user could wait for new remote files (they only arrive
    // through listings).
    let stateHandle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        foregroundSync();
        // Share target (package J): a warm share foregrounds the app.
        window.dispatchEvent(new CustomEvent("m-poll-share"));
      }
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

  // Android back gesture/button: overlay first, then the active tab's stack;
  // minimize only from a tab root (platform convention).
  useEffect(() => {
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("backButton", () => {
      const { next, minimize } = backStep(navRef.current);
      if (minimize) {
        void CapApp.minimizeApp();
      } else {
        setNav(next);
        setBump((n) => n + 1);
      }
    }).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      if (handle) void handle.remove();
    };
  }, []);

  if (!vault) return <div className="m-app" />;

  const top = navTop(nav);

  const push = (entry: NavEntry) => setNav((s) => pushEntry(s, entry));
  const pop = () => {
    setNav(popTop);
    setBump((n) => n + 1);
  };

  const openNote = (path: string) => {
    // .base targets (wiki links, embed taps) open the database screen (H).
    if (/.base$/i.test(path)) {
      push({ kind: "base", path });
      return;
    }
    // Real MRU (B2): the "Zuletzt" strip lists what was OPENED, not what synced.
    void vaultOps.pushRecent(vault, path);
    push({ kind: "note", path });
  };
  const openBase = (path: string) => {
    // Databases join the "Zuletzt" carousel too (mockup 1 shows one).
    void vaultOps.pushRecent(vault, path);
    push({ kind: "base", path });
  };

  /** The folder the user is looking at (capture + new-folder context). */
  const browseFolder = () => {
    const notesTop = nav.stacks.notes[nav.stacks.notes.length - 1];
    return nav.activeTab === "notes" && notesTop?.kind === "folder" ? notesTop.path : "";
  };

  const capture = () => {
    // Context-aware (P3): capture into the folder the user is looking at,
    // else the configurable inbox (R3.6).
    const folder = browseFolder() || getMobileSettings().inboxFolder;
    void vaultOps.createNote(vault, folder, "Note").then((path) => {
      setNav((s) => pushCapturedNote(s, slots, path));
    });
  };

  const openDaily = (iso: string) => {
    const { path, title } = dailyPathFor(iso);
    // Push into the current context: back returns to Today/Calendar (R2).
    // Fresh dailies seed from the configured template (package I).
    void vaultOps.ensureDailyNote(vault, path, title).then(() => openNote(path));
  };

  const runPendingIntents = (
    <PendingIntentRunner
      onCapture={capture}
      onCaptureShared={(share) => {
        void (async () => {
          const inbox = getMobileSettings().inboxFolder;
          const sanitize = (n: string) => ((n || "shared").split(/[\\/]/).pop() || "shared").replace(/[<>:"|?*]/g, "_").slice(0, 120) || "shared";
          const suffixed = (n: string, k: number) => { const d = n.lastIndexOf("."); return d > 0 ? `${n.slice(0, d)} ${k}${n.slice(d)}` : `${n} ${k}`; };
          const embeds: string[] = [];
          for (const f of share.files) {
            try {
              const binStr = atob(f.data);
              const bytes = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
              const rel = sanitize(f.name);
              let path = `Attachments/${rel}`;
              for (let k = 2; await vault.files.exists(path); k++) path = `Attachments/${suffixed(rel, k)}`;
              await vault.files.writeBinaryFile(path, bytes);
              // Images embed inline; other files are linked.
              embeds.push((f.mime || "").startsWith("image/") ? `![[${path}]]` : `[[${path}]]`);
            } catch { /* skip a bad payload, keep the rest */ }
          }
          const firstLine = share.text.split("\n")[0]?.slice(0, 60).trim() ?? "";
          const firstFileTitle = share.files[0] ? sanitize(share.files[0].name).replace(/\.[^.]+$/, "") : "";
          const title = share.subject.trim() || firstLine || firstFileTitle || "Note";
          const body = [share.text.trim(), ...embeds].filter(Boolean).join("\n\n");
          const notePath = await vaultOps.createNoteFromTemplate(vault, inbox, title, body);
          setNav((s2) => pushCapturedNote(s2, slots, notePath));
        })();
      }}
      onOpenToday={() => openDaily(isoOf(new Date()))}
      pendingShare={pendingShare}
      pendingShortcut={pendingShortcut}
      setPendingShare={setPendingShare}
      setPendingShortcut={setPendingShortcut}
    />
  );

  const noteOpen = top?.kind === "note";

  const finishOnboarding = (connectCloud: boolean) => {
    setOnboarded(true);
    void updateMobileSettings({ onboarded: true });
    if (connectCloud) {
      // Cloud branch (2026-07-13): existing vault vs. a NEW vault in the cloud
      // (order: place -> template -> connection, matching the desktop splash).
      void (async () => {
        const choice = await mSelect({
          title: t("mobile.onboardingCloud"),
          options: [
            { value: "existing", label: t("mobile.onboardingCloudExisting"), desc: t("mobile.onboardingCloudExistingDesc") },
            { value: "new", label: t("mobile.onboardingCloudNew"), desc: t("mobile.onboardingCloudNewDesc") },
          ],
          value: "existing",
        });
        if (choice === "existing") {
          push({ kind: "sync", path: "" });
        } else if (choice === "new") {
          const defs = getVaultTemplates(i18n.language);
          const pick = await mSelect({
            title: t("mobile.templatePick"),
            options: [
              { value: "", label: t("splash.emptyVault") },
              ...defs.map((d) => ({ value: d.id, label: d.name })),
            ],
            value: "",
          });
          if (pick === null) return;
          push({ kind: "sync", path: "", createTemplateId: pick });
        }
      })();
      return;
    }
    // Local start: offer the shared structure templates (package I). Only a
    // vault this boot created gets the offer — the one-time onboarding also
    // shows once on existing installs, whose content must never gain folders.
    void (async () => {
      if (!vault.freshlySeeded) return;
      const defs = getVaultTemplates(i18n.language);
      const pick = await mSelect({
        title: t("mobile.templatePick"),
        options: [
          { value: "", label: t("splash.emptyVault") },
          ...defs.map((d) => ({ value: d.id, label: d.name })),
        ],
        value: "",
      });
      const def = defs.find((d) => d.id === pick);
      if (!def) return;
      await scaffoldVaultTemplate({
        adapter: vault.files,
        template: def,
        vaultName: "Plainva",
        subfoldersHeading: t("indexMd.subfoldersHeading"),
      });
      const ts = def.settings;
      if (ts) {
        await updateMobileSettings({
          ...(ts.dailyNotesFolder !== undefined ? { dailyFolder: ts.dailyNotesFolder } : {}),
          ...(ts.templateFolder !== undefined ? { templateFolder: ts.templateFolder } : {}),
          ...(ts.dailyNoteTemplate !== undefined ? { dailyTemplate: ts.dailyNoteTemplate } : {}),
        });
      }
      await vault.indexer?.indexVaultFull();
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    })().catch((e) => console.error("template scaffold failed", e));
  };

  // Create a NEW vault on demand (Vaults section), 2026-07-13 order: place
  // (on this device / online) -> structure template -> destination. The online
  // branch hands the template to the connect screen; local continues here.
  const createVaultFlow = () => {
    void (async () => {
      const where = await mSelect({
        title: t("mobile.vaultCreate"),
        options: [
          { value: "local", label: t("mobile.vaultLocal"), desc: t("mobile.vaultCreateLocalDesc") },
          { value: "online", label: t("mobile.vaultCreateOnline"), desc: t("mobile.vaultCreateOnlineDesc") },
        ],
        value: "local",
      });
      if (where === null) return;
      const defs = getVaultTemplates(i18n.language);
      const pick = await mSelect({
        title: t("mobile.templatePick"),
        options: [
          { value: "", label: t("splash.emptyVault") },
          ...defs.map((d) => ({ value: d.id, label: d.name })),
        ],
        value: "",
      });
      if (pick === null) return;
      if (where === "online") {
        push({ kind: "sync", path: "", createTemplateId: pick });
        return;
      }
      const { value: rawName, cancelled } = await mPrompt({
        title: t("mobile.vaultCreate"),
        message: t("mobile.vaultCreateName"),
      });
      const name = rawName?.trim();
      if (cancelled || !name) return;
      await createLocalVault(name); // creates + switches to the new (seeded) vault
      const nv = await getMobileVault();
      const def = defs.find((d) => d.id === pick);
      if (def) {
        await scaffoldVaultTemplate({
          adapter: nv.files,
          template: def,
          vaultName: name,
          subfoldersHeading: t("indexMd.subfoldersHeading"),
        });
        const ts = def.settings;
        if (ts) {
          await updateMobileSettings({
            ...(ts.dailyNotesFolder !== undefined ? { dailyFolder: ts.dailyNotesFolder } : {}),
            ...(ts.templateFolder !== undefined ? { templateFolder: ts.templateFolder } : {}),
            ...(ts.dailyNoteTemplate !== undefined ? { dailyTemplate: ts.dailyNoteTemplate } : {}),
          });
        }
        await nv.indexer?.indexVaultFull();
      }
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    })().catch((e) => console.error("create vault failed", e));
  };

  const quickNewFolder = () => {
    setQuickCreate(false);
    createFolderPrompt(vault, browseFolder(), t);
  };

  // New note from a template (R3.4): pick a template, name the note, land in
  // the editor — full template text, placeholders interpolated (vaultOps).
  const quickNewFromTemplate = (item: { path: string; title: string }) => {
    void (async () => {
      const raw = await vaultOps.read(vault, item.path);
      const { value, cancelled } = await mPrompt({
        title: t("mobile.newFromTemplate"),
        initial: item.title,
      });
      const name = value?.trim().replace(/[\\/]/g, "-");
      if (cancelled || !name) return;
      const folder = browseFolder() || getMobileSettings().inboxFolder;
      const path = await vaultOps.createNoteFromTemplate(vault, folder, name, raw);
      setNav((s) => pushCapturedNote(s, slots, path));
    })();
  };

  // New database (R4.5): name prompt, stored in the folder the user is
  // looking at, one table view sourced on that folder (shared serializer).
  const quickNewDatabase = () => {
    setQuickCreate(false);
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("mobile.newDatabase"),
        message: t("mobile.newDatabasePrompt"),
      });
      const name = value?.trim().replace(/[\\/]/g, "-");
      if (cancelled || !name) return;
      const path = await createDatabase(vault, browseFolder(), name, t("database.viewTable"));
      // Mini wizard (E3): a fresh database opens straight into configure.
      push({ kind: "base", path, configOpen: true });
    })();
  };

  const activeDef = TAB_POOL.find((p) => p.id === nav.activeTab)!;

  return (
    <div className="m-app">
      {runPendingIntents}
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

      {/* One shared large head on every tab root — title, search and ⋮ sit in
          the same spot everywhere (maintainer feedback: nothing may jump).
          The ⋮ opens the SETTINGS directly (redesign P3); the area overview
          lives behind the bar's fixed More tab instead. */}
      {!top && (
        <TabHead
          onSettings={() => push({ kind: "settings", path: "" })}
          onSearch={() => push({ kind: "search", path: "" })}
          title={nav.activeTab === "notes" ? vaultName : t(activeDef.labelKey)}
        />
      )}

      <div
        className="m-screen"
      >
        {top?.kind === "tags" ? (
          <TagsScreen
            bump={bump}
            key={top.path}
            onBack={pop}
            onOpenNote={openNote}
            onOpenTag={(tag) => push({ kind: "tags", path: tag })}
            tag={top.path}
            vault={vault}
          />
        ) : top?.kind === "bookmarks" ? (
          <BookmarksScreen bump={bump} onBack={pop} onOpenNote={openNote} vault={vault} />
        ) : top?.kind === "settings" ? (
          <SettingsScreen
            onBack={pop}
            onOpenArea={(id) =>
              id === "appearance"
                ? push({ kind: "appearance", path: "" })
                : id === "cloudAccounts"
                  ? push({ kind: "cloudaccounts", path: "" })
                  : id === "sync"
                    ? push({ kind: "vault", path: vault.vaultId })
                    : push({ kind: "settingsArea", path: id })
            }
            onOpenVaults={() => push({ kind: "vaults", path: "" })}
          />
        ) : top?.kind === "settingsArea" ? (
          top.path === "editor" ? (
            <EditorAreaScreen onBack={pop} />
          ) : top.path === "content" ? (
            <ContentAreaScreen onBack={pop} vault={vault} />
          ) : top.path === "backup" ? (
            <BackupAreaScreen onBack={pop} />
          ) : (
            <AboutAreaScreen onBack={pop} />
          )
        ) : top?.kind === "vaults" ? (
          <VaultsScreen
            activeVaultId={vault.vaultId}
            onAddVault={() => push({ kind: "sync", path: "" })}
            onBack={pop}
            onCreateVault={createVaultFlow}
            onOpenVault={(id) => push({ kind: "vault", path: id })}
          />
        ) : top?.kind === "cloudaccounts" ? (
          <CloudAccountsScreen
            onAddVault={() => push({ kind: "sync", path: "" })}
            onBack={pop}
            onOpenCalendarAccounts={() => push({ kind: "pimaccounts", path: "" })}
            onOpenVault={(id) => push({ kind: "vault", path: id })}
          />
        ) : top?.kind === "sync" ? (
          <AddVaultScreen createTemplateId={top.createTemplateId} onBack={pop} vault={vault} />
        ) : top?.kind === "vault" ? (
          <VaultDetailScreen
            activeVault={vault}
            onBack={pop}
            vaultId={top.path}
          />
        ) : top?.kind === "base" ? (
          <BaseScreen
            initialConfigOpen={top.configOpen}
            key={top.path}
            onBack={pop}
            onOpenNote={openNote}
            path={top.path}
            vault={vault}
          />
        ) : top?.kind === "note" ? (
          <NoteScreen
            key={top.path}
            onBack={pop}
            onOpenNote={openNote}
            onRenamed={(newPath) =>
              // Retarget the open entry in place — the note keeps its stack slot.
              setNav((st) => {
                if (st.overlay.length > 0) {
                  const next = [...st.overlay];
                  next[next.length - 1] = { ...next[next.length - 1], path: newPath };
                  return { ...st, overlay: next };
                }
                const stack = st.stacks[st.activeTab];
                if (stack.length === 0) return st;
                const next = [...stack];
                next[next.length - 1] = { ...next[next.length - 1], path: newPath };
                return { ...st, stacks: { ...st.stacks, [st.activeTab]: next } };
              })
            }
            path={top.path}
            vault={vault}
          />
        ) : top?.kind === "appearance" ? (
          <AppearanceScreen onBack={pop} />
        ) : top?.kind === "search" ? (
          <SearchScreen onBack={pop} onOpenNote={openNote} vault={vault} />
        ) : top?.kind === "more" ? (
          <MoreScreen
            onBack={pop}
            onOpenScreen={(id) => push(SCREEN_ENTRY[id])}
            onReorder={(next) => void updateMobileSettings({ tabSlots: next })}
            order={slots}
          />
        ) : top?.kind === "today" ? (
          <TodayScreen bump={bump} onBack={pop} onOpenDate={openDaily} onOpenNote={openNote} vault={vault} />
        ) : top?.kind === "calendar" ? (
          <CalendarScreen bump={bump} onBack={pop} onOpenDate={openDaily} onOpenPim={() => push({ kind: "pimcalendar", path: "" })} vault={vault} />
        ) : top?.kind === "pimcalendar" ? (
          <PimCalendarScreen bump={bump} onBack={pop} onOpenSettings={() => push({ kind: "pimaccounts", path: "" })} />
        ) : top?.kind === "pimaccounts" ? (
          <PimAccountsScreen bump={bump} onBack={pop} />
        ) : top?.kind === "databases" ? (
          <DatabasesScreen bump={bump} onBack={pop} onCreate={quickNewDatabase} onOpenBase={openBase} vault={vault} />
        ) : top?.kind === "graphmap" ? (
          <GraphScreen bump={bump} onBack={pop} onOpenNote={openNote} vault={vault} />
        ) : top?.kind === "folder" ? (
          <BrowseScreen
            bump={bump}
            folder={top.path}
            onBack={pop}
            onOpenBase={openBase}
            onOpenFolder={(path) => push({ kind: "folder", path })}
            onOpenNote={openNote}
            vault={vault}
          />
        ) : nav.activeTab === "notes" ? (
          <BrowseScreen
            bump={bump}
            folder=""
            onOpenBase={openBase}
            onOpenFolder={(path) => push({ kind: "folder", path })}
            onOpenNote={openNote}
            vault={vault}
          />
        ) : nav.activeTab === "today" ? (
          <TodayScreen bump={bump} onOpenDate={openDaily} onOpenNote={openNote} vault={vault} />
        ) : nav.activeTab === "tags" ? (
          <TagsScreen
            bump={bump}
            onOpenNote={openNote}
            onOpenTag={(tag) => push({ kind: "tags", path: tag })}
            tag=""
            vault={vault}
          />
        ) : nav.activeTab === "bookmarks" ? (
          <BookmarksScreen bump={bump} onOpenNote={openNote} vault={vault} />
        ) : nav.activeTab === "calendar" ? (
          <CalendarScreen bump={bump} onOpenDate={openDaily} onOpenPim={() => push({ kind: "pimcalendar", path: "" })} vault={vault} />
        ) : nav.activeTab === "graph" ? (
          <GraphScreen bump={bump} onOpenNote={openNote} vault={vault} />
        ) : (
          <DatabasesScreen bump={bump} onCreate={quickNewDatabase} onOpenBase={openBase} vault={vault} />
        )}
      </div>

      {/* Capture floats as a FAB above the bar (redesign P3: the bar's center
          slot went to the fixed More tab). Only on tab roots — pushed screens
          (note editor, bases with their own FAB) keep their surface clean. */}
      {onboarded && !top && (
        <button
          aria-label={t("mobile.newNote")}
          className="pv-fab m-fab-float m-fab-float--above-tabs"
          data-testid="capture-fab"
          onClick={() => setQuickCreate(true)}
        >
          <Plus size={24} />
        </button>
      )}

      {!noteOpen && (
        <nav aria-label="Tabs" className="m-tabbar">
          {barTabs(slots).map((id) => (
            <TabButton def={TAB_POOL.find((p) => p.id === id)!} key={id} active={nav.activeTab === id && nav.overlay.length === 0} onClick={() => { haptics.light(); setNav((s) => tapTab(s, id)); }} />
          ))}
          {/* Fixed More tab: opens the area overview (arrange + everything
              else); tapping it again keeps it open, any other tab dismisses. */}
          <button
            className={`m-tab${top?.kind === "more" ? " is-active" : ""}`}
            onClick={() => {
              haptics.light();
              setNav((s) => (navTop(s)?.kind === "more" ? s : pushEntry({ ...s, overlay: [] }, { kind: "more", path: "" })));
            }}
          >
            <span className="m-tab-pill">
              <Ellipsis size={20} />
            </span>
            <span className="m-tab-label">{t("mobile.tabMore")}</span>
          </button>
        </nav>
      )}

      {oauthPick && (
        <CloudFolderPickerSheet
          title={t("mobile.syncFolder")}
          listFolders={oauthListFolders}
          createFolder={oauthCreateFolder}
          onPick={(folder) => { setOauthPick(false); void finishConnect(folder); }}
          onClose={() => { setOauthPick(false); cancelConnect(); }}
        />
      )}
      {quickCreate && (
        <div className="m-sheet-backdrop" onClick={() => setQuickCreate(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setQuickCreate(false)} />
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
                setFromTemplate(true);
              }}
            >
              <StickyNote size={18} />
              <span>{t("mobile.newFromTemplate")}</span>
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

      {fromTemplate && (
        <TemplatePickSheet
          onClose={() => setFromTemplate(false)}
          onPick={quickNewFromTemplate}
          title={t("mobile.newFromTemplate")}
          vault={vault}
        />
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


/** Executes parked package-J intents once the vault closures exist (hook-rule safe). */
function PendingIntentRunner({
  pendingShortcut,
  pendingShare,
  setPendingShortcut,
  setPendingShare,
  onCapture,
  onCaptureShared,
  onOpenToday,
}: {
  pendingShortcut: string | null;
  pendingShare: PendingShare | null;
  setPendingShortcut: (v: string | null) => void;
  setPendingShare: (v: PendingShare | null) => void;
  onCapture: () => void;
  onCaptureShared: (share: PendingShare) => void;
  onOpenToday: () => void;
}) {
  useEffect(() => {
    if (!pendingShortcut) return;
    setPendingShortcut(null);
    if (pendingShortcut === "new-note") onCapture();
    else if (pendingShortcut === "today") onOpenToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShortcut]);
  useEffect(() => {
    if (!pendingShare) return;
    setPendingShare(null);
    onCaptureShared(pendingShare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare]);
  return null;
}
