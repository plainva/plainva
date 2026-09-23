import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { newEntries, requestNew, type NewHandlers } from "@plainva/ui";
import { NavBar } from "./components/NavBar";
import { tabTapped } from "./services/tabTap";
import { useTranslation } from "react-i18next";
import { Cloud, FileText, Plus } from "lucide-react";
import {
  BAR_LAYOUT_CHANGED_EVENT,
  barDef,
  getVaultTemplates,
  ICON,
  journalTodayKey,
  setPlaceProvider,
  sanitizeAreaOrder,
  scaffoldVaultTemplate,
  toast,
  type AreaOrder,
} from "@plainva/ui";
import { useCommentShell } from "./hooks/useCommentShell";
import { AdaptiveLayout } from "./components/AdaptiveLayout";
import { makeOpenAttachment, routeVaultPath } from "./services/openAttachment";
import { vaultOps, getMobileVault, createLocalVault, chooseVaultPlace, createVaultInPickedFolder, type MobileVault } from "./services/vaultService";
import { startSyncIfConfigured } from "./services/syncService";
import { useBackupSchedule } from "./services/useBackupSchedule";
import { useIndexAutoUpdate } from "./services/useIndexAutoUpdate";
import { startPim, stopPim } from "./services/pim/pimService";
import { onAppBackground, onAppForeground } from "./services/appLifecycle";
import { recordProcessExitsOnBoot } from "./services/processExits";
import { startMobileMail, stopMobileMail } from "./services/mail/mailRuntime";
import { useConnectRun } from "./hooks/useConnectRun";
import { useConnectionRun } from "./hooks/useConnectionRun";
import { resumePimOAuthResult } from "./services/pim/pimOAuth";
import { useDeepLinkNav } from "./hooks/useDeepLinkNav";
import { useSoftKeyboard } from "./hooks/useSoftKeyboard";
import { cancelConnect, finishConnect, listPendingConnectFolders as oauthListFolders, createPendingConnectFolder as oauthCreateFolder, restorePendingConnect } from "./services/oauthService";
import { routeAppUrl } from "./services/appUrlRoutes";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { App as CapApp } from "@capacitor/app";
import { mPrompt, mSelect } from "./services/mobileDialogs";
import { askBeforeLeaving } from "./services/leaveQuestion";
import { createNavActions, restoreSession } from "./services/navActions";
import { bindConflictStore } from "./services/conflictState";
import { useNavPersistence } from "./services/sessionState";
import { TemplatePickSheet } from "./components/TemplatePickSheet";
import { JournalCaptureSheet } from "./components/JournalCaptureSheet";
import { createDatabase } from "./services/baseOps";
import { createTemplatePrompt, newNoteFromTemplate } from "./services/templatePrompt";
import { applyTemplateSettings, getMobileSettings, updateMobileSettings } from "./services/mobileSettings";
import {
  loadMobileBar,
  migrateMobileBarLayout,
  mirrorLegacyBarFields,
  shownBarTabs,
  saveMobileBar,
} from "./services/mobileBar";
import { createFolderPrompt } from "./screens/BrowseScreen";
import { getActiveVaultEntry } from "./services/vaultRegistry";
import { AreasSheet } from "./components/AreasSheet";
import { StartupSheets } from "./components/StartupSheets";
import { markReleaseDialogSeen, pendingReleaseDialog, type ReleaseDialog } from "./services/mobileWhatsNew";
import {
  activeFolderPath,
  backStep,
  ensureVisibleTab,
  hidesTabBar,
  initialNavState,
  navTop,
  pushCapturedNote,
  pushEntry,
  activeNotePath,
  reservesFabStrip, showsCaptureFab,
  tapTab,
  SCREEN_ENTRY,
  type NavState,
} from "./navigation";
import { PendingIntentRunner } from "./PendingIntentRunner";
import { ShareInbox } from "./components/ShareInbox";
import { haptics } from "./services/haptics";
import { closeTopSheet } from "./services/sheetStack";
import { buildMobileCommands } from "./services/mobileCommands";
import { getWindowClass, isRailClass, subscribeWindowClass } from "./services/windowClass";
import { useAdaptiveSplit } from "./hooks/useAdaptiveSplit";
import { FabMenu } from "./components/FabMenu";

// Tab/stack shell (rebuilt in R2): the bottom bar carries up to four
// user-chosen screens around the fixed ＋ (M3 navigation bar); search and
// the More menu live in the top app bar. Every tab keeps its own stack; the
// bar hides while a note is open (editor focus). R3.1 moved app-wide screens
// (search/More/settings/vault) into an overlay stack ABOVE the tabs — any
// bottom-bar tap dismisses them, tapping the active tab returns to its root.

/** The local day an ISO key names. Path and file name come from the shared daily-note rule (S14, plan Journal J2). */
const dayOfIso = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export default function App() {
  const { i18n, t } = useTranslation();
  const [vault, setVault] = useState<MobileVault | null>(null);
  // The bar's arrangement, from the shared bar model (S10). Starts at the
  // model's default and is replaced once the vault's own value is read — a
  // synchronous first paint matters more here than a moment of the default,
  // because this state decides which tab the app opens on.
  const [barLayout, setBarLayout] = useState<AreaOrder>(() =>
    sanitizeAreaOrder(undefined, barDef("mobileBar").spec),
  );
  /** Areas sheet: the one place that reaches every area (E10). */
  const [areasOpen, setAreasOpen] = useState(false);
  // The shape decides the list, and the list decides which tab opens first.
  // Both shapes start from the same arranged head, but reading the rule rather
  // than one of its two answers is what keeps that true if the rule changes.
  const [nav, setNav] = useState<NavState>(() =>
    initialNavState(shownBarTabs(barLayout, isRailClass(getWindowClass()))[0]),
  );
  const [bump, setBump] = useState(0);
  const [onboarded, setOnboarded] = useState(getMobileSettings().onboarded);
  /** Release highlights / welcome on this start (H5) — resolved once. */
  const [releaseDialog, setReleaseDialog] = useState<ReleaseDialog>("none");
  const [quickCreate, setQuickCreate] = useState(false);
  // Which layout the window is in (S13) — read here, with the other stores, so
  // it is never behind a conditional return.
  const windowClass = useSyncExternalStore(subscribeWindowClass, getWindowClass);
  const slots = shownBarTabs(barLayout, isRailClass(windowClass));
  const [oauthPick, setOauthPick] = useState(false);
  const [fromTemplate, setFromTemplate] = useState(false);
  // The capture sheet's journal kind (plan Journal, J4). `null` = closed; the text is what a kind switch brought along.
  const [journalCapture, setJournalCapture] = useState<{ text: string } | null>(null);
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
  useEffect(() => {
    const onShortcut = (e: Event) => setPendingShortcut(String((e as CustomEvent).detail?.which ?? ""));
    window.addEventListener("m-shortcut", onShortcut);
    return () => {
      window.removeEventListener("m-shortcut", onShortcut);
    };
  }, []);

  /**
   * Where this phone can find a position (plan Journal-Erweiterungen, X7).
   *
   * The native plugin, not `navigator.geolocation`: a WKWebView answers that
   * with nothing at all. The permission is asked for on the first press of the
   * button, never at startup - the plugin's own request runs inside the call.
   */
  useEffect(() => {
    setPlaceProvider(async () => {
      const { Geolocation } = await import("@capacitor/geolocation");
      const permitted = await Geolocation.checkPermissions().catch(() => null);
      if (permitted?.location !== "granted") {
        const asked = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (asked.location !== "granted") throw new Error("permission denied");
      }
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 });
      return { latitude: position.coords.latitude, longitude: position.coords.longitude };
    });
    return () => setPlaceProvider(null);
  }, []);

  // What this start owes the user (H5). Runs once: an existing install that
  // just updated sees the highlights; a fresh one sees nothing here, because
  // the onboarding screen below is this platform's welcome (BS5).
  useEffect(() => {
    void pendingReleaseDialog(getMobileSettings().onboarded).then(setReleaseDialog);
  }, []);

  const [vaultName, setVaultName] = useState("Plainva");
  /** Which vault the bar was read for — the change listener has no props. */
  const barVaultRef = useRef<string | null>(null);
  /**
   * Reads the bar for a vault — migrating the phone's two legacy settings into
   * the shared model the first time (S10), which is why this runs on boot and
   * on every vault switch rather than once.
   */
  const adoptBar = useCallback(async (vaultId: string) => {
    barVaultRef.current = vaultId;
    await migrateMobileBarLayout(vaultId);
    const next = await loadMobileBar(vaultId);
    setBarLayout(next);
    // Read, not closed over: this callback is deliberately dependency-free.
    setNav((s) => ensureVisibleTab(s, shownBarTabs(next, isRailClass(getWindowClass()))));
  }, []);

  /**
   * A deliberate change to the bar — kept, mirrored and stored. Reads the vault
   * from state, not from the ref: `renderRoute` receives this during render, so
   * as far as the compiler knows it could be called there.
   */
  const onBarLayout = useCallback((next: AreaOrder) => {
    setBarLayout(next);
    mirrorLegacyBarFields(next);
    void saveMobileBar(vault?.vaultId ?? null, next);
  }, [vault]);

  useBackupSchedule(vault, vaultName);
  useIndexAutoUpdate(vault, vaultName);
  useNavPersistence(vault, nav); // the session outlives the app (P6)
  const connectionRun = useConnectionRun();

  useEffect(() => {
    void getMobileVault().then((v) => {
      setVault(v);
      bindConflictStore(v.vaultId); // unresolved conflicts survive the restart (P1)
      void restoreSession(v, setNav).finally(() => window.dispatchEvent(new Event("m-connect-run-changed")));
      void adoptBar(v.vaultId);
      void startSyncIfConfigured(v).catch((e) => console.error("[boot] sync start failed", e));
      void startPim(v).then(resumePimOAuthResult).catch((e) => console.error("[boot] pim start failed", e));
      startMobileMail(v);
    });
    void getActiveVaultEntry().then((e) => setVaultName(e.name || "Plainva"));
    const onChanged = () => setBump((n) => n + 1);
    // Vault switch (M3.5 isolation): drop all stacks (and any overlay), then
    // reboot the vault and restart sync for the newly active container.
    const onSwitched = () => {
      stopPim();
      stopMobileMail();
      setVault(null);
      setNav((s) => initialNavState(s.activeTab));
      void getMobileVault().then((v) => {
        setVault(v);
        bindConflictStore(v.vaultId);
        setBump((n) => n + 1);
        void adoptBar(v.vaultId);
        void startSyncIfConfigured(v).catch((e) => console.error("[switch] sync start failed", e));
        void startPim(v).catch((e) => console.error("[switch] pim start failed", e));
        startMobileMail(v);
      });
      void getActiveVaultEntry().then((e) => setVaultName(e.name || "Plainva"));
    };
    const onSettings = () => {
      void getActiveVaultEntry().then((e) => setVaultName(e.name || "Plainva"));
    };
    /**
     * The bar changed — here, on the desktop, or through the settings sync.
     * Re-read rather than trust the event payload: the value may have come
     * from another device, and the model is the only thing that knows whether
     * it is still valid for this pool.
     */
    const onBarLayout = () => {
      const id = barVaultRef.current;
      if (id) void adoptBar(id);
    };
    // Accounts arrived through the settings sync (plan P3). They were written
    // straight into the vault database, so the runtimes are still holding the
    // state from before — without this the imported calendar stays empty and
    // the mailbox invisible until the next app start.
    const onAccountsImported = () => {
      void getMobileVault().then((v) => {
        stopPim();
        void startPim(v).catch((e) => console.error("[import] pim restart failed", e));
        stopMobileMail();
        startMobileMail(v);
        setBump((n) => n + 1);
      });
    };
    const onRevealFile = (event: Event) => {
      const { path, vaultId } = (event as CustomEvent<{ path: string; vaultId: string }>).detail;
      if (barVaultRef.current !== vaultId) return;
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      setNav(st => pushEntry(st, { kind: "folder", path: folder }));
    };
    window.addEventListener("m-reveal-file", onRevealFile);
    window.addEventListener("m-vault-changed", onChanged);
    window.addEventListener("m-vault-switched", onSwitched);
    window.addEventListener("m-settings-changed", onSettings);
    window.addEventListener("m-accounts-imported", onAccountsImported);
    window.addEventListener(BAR_LAYOUT_CHANGED_EVENT, onBarLayout);
    return () => {
      window.removeEventListener("m-vault-changed", onChanged);
      window.removeEventListener("m-vault-switched", onSwitched);
      window.removeEventListener("m-settings-changed", onSettings);
      window.removeEventListener("m-accounts-imported", onAccountsImported);
      window.removeEventListener("m-reveal-file", onRevealFile);
      window.removeEventListener(BAR_LAYOUT_CHANGED_EVENT, onBarLayout);
    };
  }, [adoptBar]);

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

  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useSoftKeyboard(setIsKeyboardOpen);

  // Connect-time folder pick (#10): the OAuth redirect fires this event once it
  // holds a token; the picker browses the cloud folders and finishConnect then
  // creates the (fresh, isolated) vault with the chosen root.
  useEffect(() => {
    const onChoose = () => setOauthPick(true);
    window.addEventListener("plainva-oauth-choose-folder", onChoose);
    void restorePendingConnect().catch(e => console.error("[boot] pending connection", e));
    return () => window.removeEventListener("plainva-oauth-choose-folder", onChoose);
  }, []);

  // OAuth redirect (M3): the system browser returns via the custom scheme.
  // appUrlOpen covers the warm app; getLaunchUrl covers a cold start where
  // the redirect itself launched the app.
  useEffect(() => {
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("appUrlOpen", ({ url }) => {
      void routeAppUrl(url);
    }).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    // What the system says about the last time this app ended (Android 17's
    // memory limiter kills without a word) — folded into the diagnostics once
    // per start, before anything else can be blamed (plan 2026-09-04, P1).
    void recordProcessExitsOnBoot();
    void CapApp.getLaunchUrl().then((r) => {
      if (r?.url) void routeAppUrl(r.url);
    });
    // A WebView pauses its timers in the background, so every cycle that would
    // tick on its own has to be caught up on return. What that means in detail
    // lives in services/appLifecycle.
    let stateHandle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) onAppForeground();
      else onAppBackground();
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
      // A sheet is navigation state (S12): back closes the topmost one and
      // stops there, instead of popping the screen out from under it.
      if (closeTopSheet()) return;
      const { next, minimize } = backStep(navRef.current);
      if (minimize) {
        void CapApp.minimizeApp();
        return;
      }
      void askBeforeLeaving().then((ok) => {
        if (!ok) return;
        setNav(next);
        setBump((n) => n + 1);
      });
    }).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      if (handle) void handle.remove();
    };
  }, []);

  useConnectRun(setNav);
  useDeepLinkNav(setNav);

  // Whether a tablet stands two columns, and whether the navigator is folded
  // away. Above the early return with the rest: it holds state and a
  // subscription, so skipping it on the render without a vault would change
  // the hook order on the next one.
  const { splitPossible, twoColumn, navCollapsed, toggleNav } = useAdaptiveSplit(onboarded);

  // Long press on the navigation bar opens the areas sheet (P5/E10) — the
  // shortcut next to the discoverable title ▾. A short tap must stay a tab
  // switch, so the timer is cancelled on pointerup/leave. Declared above the
  // early return: hooks must run in the same order on every render.

  useCommentShell(vault, useCallback((entry) => setNav((s) => pushEntry(s, entry)), []));
  if (!vault) return <div className="m-app" />;

  const top = navTop(nav);

  // push / pop / replace live together in services/navActions: `pop` is the
  // only asynchronous one, and that asymmetry is what #47 tripped over.
  const { push, pop, replace } = createNavActions(setNav, setBump);


  // What a tapped vault path becomes. Declared before `openNote` because that
  // one delegates to it — an attachment must never reach the note screen.
  const openAttachment = makeOpenAttachment(vault, (path) => push({ kind: "imageviewer", path }), () =>
    toast.warning(t("mobile.openAttachmentFailed")),
  );

  const openNote = (path: string) => {
    // Databases, images and attachments are routed by the feature (issue #55);
    // every path into the app comes through here, so this is the one gate.
    if (routeVaultPath(path, { openBase: (p) => push({ kind: "base", path: p }), openAttachment })) return;
    void vaultOps.noteOpened(vault, path); // real MRU (B2) + next cold start (T6)
    push({ kind: "note", path });
  };
  const openBase = (path: string) => {
    // Databases join the "Zuletzt" carousel too (mockup 1 shows one).
    void vaultOps.pushRecent(vault, path);
    push({ kind: "base", path });
  };

  /** The folder the user is looking at (capture + new-folder context). */
  const browseFolder = () => {
    return activeFolderPath(nav);
  };

  const capture = () => {
    // Context-aware (P3): capture into the folder the user is looking at,
    // else the configurable inbox (R3.6).
    const folder = browseFolder() || getMobileSettings().inboxFolder;
    void vaultOps.createNote(vault, folder, "Note").then((path) => {
      // null = the template's questions were cancelled, so nothing was created.
      if (path) setNav((s) => pushCapturedNote(s, slots, path));
    });
  };

  const openDaily = (iso: string) => {
    // Push into the current context: back returns to Today/Calendar (R2).
    // Fresh dailies seed from the configured template (package I).
    void vaultOps.ensureDailyNote(vault, dayOfIso(iso)).then((daily) => {
      // null = the daily template's questions were cancelled, so no note exists.
      if (daily) openNote(daily.path);
    });
  };

  const runPendingIntents = (
    <PendingIntentRunner
      onCapture={capture}
      onNewTask={() => { requestNew("task"); void tabTapped("tasks", setNav); }}
      onJournal={() => setJournalCapture({ text: "" })}
      onOpenCalendar={(focus) => setNav((n) => pushEntry(n, { kind: "pimcalendar", path: focus ? JSON.stringify(focus) : "" }))}
      onOpenNote={openNote}
      onOpenToday={() => openDaily(journalTodayKey())}
      pendingShortcut={pendingShortcut}
      setPendingShortcut={setPendingShortcut}
    />
  );

  // Input surfaces hide the bar (see navigation.hidesTabBar): a tap on it
  // clears the overlay and would drop the unfinished work behind them.
  // The bar hides on surfaces that hold an unfinished input, because a tap on
  // it drops the overlay stack and the draft with it. A RAIL does not have that
  // problem — it is not under the thumb, and the leave guard asks either way —
  // so from medium the navigation stays where a wide window expects it (S14).
  const focusedSetup = !!connectionRun?.pending.length && ["sync", "pimaccounts", "mailaccounts"].includes(top?.kind ?? "");
  const barHidden = focusedSetup || (hidesTabBar(top) && windowClass === "compact");

  const finishOnboarding = (connectCloud: boolean) => {
    void markReleaseDialogSeen(); // the welcome screen IS the first run (H5)
    setReleaseDialog("none");
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
      if (!vault.claimTemplateCreation()) return;
      const defs = getVaultTemplates(i18n.language);
      const pick = await mSelect({
        title: t("mobile.templatePick"),
        options: [
          { value: "", label: t("splash.emptyVault") },
          ...defs.map((d) => ({ value: d.id, label: d.name })),
        ],
        value: "",
      });
      const def = defs.find((d) => d.id === pick) ?? null;
      await scaffoldVaultTemplate({
        adapter: vault.adapter,
        isNewVault: vault.freshlySeeded,
        template: def,
        vaultName: "Plainva",
        subfoldersHeading: t("indexMd.subfoldersHeading"),
      });
      await applyTemplateSettings(def?.settings);
      await vault.indexer?.indexVaultFull();
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    })().catch((e) => console.error("template scaffold failed", e));
  };

  // Create a NEW vault on demand (Vaults section), 2026-07-13 order: place
  // (on this device / online) -> structure template -> destination. The online
  // branch hands the template to the connect screen; local continues here.
  const createVaultFlow = () => {
    void (async () => {
      const where = await chooseVaultPlace();
      if (where === null) return;
      if (where === "folder") { await createVaultInPickedFolder(); return; }
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
      const def = defs.find((d) => d.id === pick) ?? null;
      await createLocalVault(name, def);
      const nv = await getMobileVault();
      if (def) {
        await applyTemplateSettings(def.settings);
        await nv.indexer?.indexVaultFull();
      }
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    })().catch((e) => console.error("create vault failed", e));
  };

  const quickNewFolder = () => {
    setQuickCreate(false);
    createFolderPrompt(vault, browseFolder(), t);
  };

  const quickNewFromTemplate = (item: { path: string; title: string }) => {
    void newNoteFromTemplate(vault, t, item, browseFolder() || getMobileSettings().inboxFolder).then((p) => {
      if (p) setNav((s) => pushCapturedNote(s, slots, p));
    });
  };

  // Create a fresh template (parity gap template-authoring); the prompt and
  // the shared rule live in services/templatePrompt.
  const quickCreateTemplate = () => {
    void createTemplatePrompt(vault, t).then((created) => {
      if (created) setNav((s) => pushCapturedNote(s, slots, created));
    });
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

  // What this shell can do, from the shared registry (S15). The list is built
  // per render because availability is a question, not a constant — a
  // note-scoped command must not linger after the note closes.
  /**
   * "New …" in the catalog's vocabulary (Design-Runde E4) — the FAB and the
   * palette read the same handlers, so both offer the same things in the same
   * groups and order as the desktop. A term and a task are made where they
   * live: the tab opens and takes the request.
   */
  const newHandlers: NewHandlers = {
    note: capture,
    noteFromTemplate: () => setFromTemplate(true),
    daily: () => openDaily(journalTodayKey()),
    journal: () => setJournalCapture({ text: "" }),
    folder: quickNewFolder,
    base: quickNewDatabase,
    event: () => { requestNew("event"); void tabTapped("today", setNav); },
    task: () => { requestNew("task"); void tabTapped("tasks", setNav); },
  };
  const commands = buildMobileCommands({
    newNote: capture,
    newFromTemplate: () => setFromTemplate(true),
    newFolder: quickNewFolder,
    newDatabase: quickNewDatabase,
    openDaily: () => openDaily(journalTodayKey()),
    newEvent: newHandlers.event,
    newTask: newHandlers.task,
    newJournalEntry: newHandlers.journal,
    openJournal: () => setNav((st) => tapTab(st, "journal")),
    openSearch: () => push({ kind: "search", path: "" }),
    openFindReplace: () => push({ kind: "findreplace", path: "" }),
    openGraph: () => setNav((st) => tapTab(st, "graph")),
    openTasks: () => setNav((st) => tapTab(st, "tasks")),
    openCalendar: () => setNav((st) => tapTab(st, "calendar")),
    openMail: () => setNav((st) => tapTab(st, "mail")),
    openSettings: () => push({ kind: "settings", path: "" }),
    switchVault: () => push({ kind: "vaults", path: "" }),
    refreshVault: () => setBump((n) => n + 1),
    activeNote: () => activeNotePath(top),
  });

  const routeCtx = {
    vault, vaultName, bump, push, pop, replace, setNav,
    openNote, openBase, openDaily, createVaultFlow, quickNewDatabase,
    openAttachment,
    captureNote: capture,
    captureJournal: (text = "") => setJournalCapture({ text }),
    commands,
    barLayout, onBarLayout,
  };

  const hasFab = onboarded && showsCaptureFab(top, nav.activeTab); // the strip: reservesFabStrip
  return (
    <div className={`m-app${isKeyboardOpen ? " is-keyboard-open" : ""}${onboarded && reservesFabStrip(top, nav.activeTab) ? " has-fab" : ""}`}>
      {runPendingIntents}
      <ShareInbox key={vault.vaultId} vault={vault} vaultName={vaultName} onChooseVault={() => push({ kind: "vaults", path: "" })} onUnlock={() => push({ kind: "settingsArea", path: "security" })} onImported={(path) => setNav(state => pushCapturedNote(state, slots, path))} />
      {!onboarded && (
        <div className="m-onboarding">
          <h1>{t("mobile.onboardingTitle")}</h1>
          <p className="m-hint">{t("mobile.onboardingBody")}</p>
          <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => finishOnboarding(false)}>
            <FileText className="m-accent" size={ICON.touch} />
            <span className="m-onboarding-label">{t("mobile.onboardingLocal")}</span>
            <span className="m-onboarding-desc">{t("mobile.onboardingLocalDesc")}</span>
          </button>
          <button className="pv-card pv-card--flat m-onboarding-card" onClick={() => finishOnboarding(true)}>
            <Cloud className="m-accent" size={ICON.touch} />
            <span className="m-onboarding-label">{t("mobile.onboardingCloud")}</span>
            <span className="m-onboarding-desc">{t("mobile.onboardingCloudDesc")}</span>
          </button>
        </div>
      )}

      <AdaptiveLayout activeTab={nav.activeTab} ctx={routeCtx} top={top} twoColumn={twoColumn} />

      {/* Capture floats above the bar on tab roots and folder screens only. */}
      {hasFab && (
        <FabMenu
          icon={<Plus size={ICON.touch} />}
          items={newEntries(t, newHandlers).flatMap((g) =>
            g.items.map((it) => ({ icon: <it.icon size={ICON.head} />, label: it.label, group: g.id, onClick: it.run })),
          )}
          label={t("mobile.quickCreate")}
          onOpenChange={setQuickCreate}
          open={quickCreate}
        />
      )}

      {!barHidden && (
        <NavBar
          activeTab={nav.overlay.length === 0 ? nav.activeTab : null}
          areasOpen={areasOpen}
          navCollapsed={navCollapsed}
          onOpenAreas={() => setAreasOpen(true)}
          onOpenSettings={() => setNav((st) => pushEntry({ ...st, overlay: [] }, { kind: "settings", path: "" }))}
          onPick={(id) => void tabTapped(id, setNav)}
          onToggleNav={splitPossible ? toggleNav : undefined}
          tabs={slots}
        />
      )}

      <StartupSheets
        onOpenOkf={() => setNav((s) => pushEntry({ ...s, overlay: [] }, { kind: "okfconversion", path: "" }))}
        onReleaseSeen={() => setReleaseDialog("none")}
        releaseDialog={releaseDialog}
        showRelease={onboarded}
        vault={vault}
      />

      {areasOpen && (
        <AreasSheet
          active={nav.activeTab}
          order={barLayout}
          onArrange={() => {
            setAreasOpen(false);
            // Straight to the setting that arranges the bar — noticing "this
            // should be in the bar" and fixing it is one tap apart.
            setNav((s) => pushEntry({ ...s, overlay: [] }, { kind: "more", path: "" }));
          }}
          onClose={() => setAreasOpen(false)}
          onPick={(id) => {
            setAreasOpen(false);
            haptics.light();
            // In the bar → switch tabs. Outside it → push the screen as an
            // overlay, so back returns to where the user came from.
            setNav((s) =>
              slots.includes(id)
                ? tapTab(s, id)
                : pushEntry({ ...s, overlay: [] }, SCREEN_ENTRY[id])
            );
          }}
        />
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
      {journalCapture && (
        <JournalCaptureSheet
          initialText={journalCapture.text}
          onClose={() => setJournalCapture(null)}
          onSwitchToTask={(text) => { setJournalCapture(null); requestNew("task", text); void tabTapped("tasks", setNav); toast.info(t("journal.handoverTask")); }}
          vault={vault}
        />
      )}
      {fromTemplate && (
        <TemplatePickSheet
          onClose={() => setFromTemplate(false)}
          onPick={quickNewFromTemplate}
          onCreate={quickCreateTemplate}
          title={t("mobile.newFromTemplate")}
          vault={vault}
        />
      )}
    </div>
  );
}

/** Executes parked package-J intents once the vault closures exist (hook-rule safe). */
