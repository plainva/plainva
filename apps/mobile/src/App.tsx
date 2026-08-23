import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NavBar } from "./components/NavBar";
import { tabTapped } from "./services/tabTap";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Cloud,
  Database as DatabaseIcon,
  FileText,
  FolderPlus,
  Plus,
  StickyNote,
} from "lucide-react";
import {
  BAR_LAYOUT_CHANGED_EVENT,
  barDef,
  buildDailyNotePath,
  getVaultTemplates,
  ICON,
  sanitizeAreaOrder,
  scaffoldVaultTemplate,
  toast,
  type AreaOrder,
} from "@plainva/ui";
import { AdaptiveLayout } from "./components/AdaptiveLayout";
import { makeOpenAttachment, routeVaultPath } from "./services/openAttachment";
import { vaultOps, getMobileVault, createLocalVault, type MobileVault } from "./services/vaultService";
import { createProviderFolder, foregroundSync, listProviderFolders, startSyncIfConfigured } from "./services/syncService";
import { useBackupSchedule } from "./services/useBackupSchedule";
import { useIndexAutoUpdate } from "./services/useIndexAutoUpdate";
import { startPim, stopPim } from "./services/pim/pimService";
import { startMobileMail, stopMobileMail } from "./services/mail/mailRuntime";
import { useConnectRun } from "./hooks/useConnectRun";
import { useDeepLinkNav } from "./hooks/useDeepLinkNav";
import { useSoftKeyboard } from "./hooks/useSoftKeyboard";
import { cancelConnect, finishConnect, getPendingConnect, handleOAuthRedirect } from "./services/oauthService";
import { handlePimOAuthRedirect } from "./services/pim/pimOAuth";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { App as CapApp } from "@capacitor/app";
import { mPrompt, mSelect } from "./services/mobileDialogs";
import { askBeforeLeaving } from "./services/leaveQuestion";
import { createNavActions } from "./services/navActions";
import { TemplatePickSheet } from "./components/TemplatePickSheet";
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
  showsCaptureFab,
  tapTab,
  SCREEN_ENTRY,
  type NavState,
} from "./navigation";
import { PendingIntentRunner } from "./PendingIntentRunner";
import { consumePendingShare, type PendingShare } from "./services/shareTarget";
import { haptics } from "./services/haptics";
import { closeTopSheet } from "./services/sheetStack";
import { buildMobileCommands } from "./services/mobileCommands";
import { getWindowClass, isRailClass, subscribeWindowClass } from "./services/windowClass";
import { useAdaptiveSplit } from "./hooks/useAdaptiveSplit";
import { FabMenu } from "./components/FabMenu";
import { isoOf } from "./lib/dates";

// Tab/stack shell (rebuilt in R2): the bottom bar carries up to four
// user-chosen screens around the fixed ＋ (M3 navigation bar); search and
// the More menu live in the top app bar. Every tab keeps its own stack; the
// bar hides while a note is open (editor focus). R3.1 moved app-wide screens
// (search/More/settings/vault) into an overlay stack ABOVE the tabs — any
// bottom-bar tap dismisses them, tapping the active tab returns to its root.

/**
 * Same file name as the desktop would choose. It used to be hard-coded ISO
 * here, so a vault set to another daily-note format got a SECOND note for the
 * same day the moment the phone touched it (S14).
 */
const dailyPathFor = (iso: string) => {
  const s = getMobileSettings();
  const [y, m, d] = iso.split("-").map(Number);
  const { fullPath, dateStr } = buildDailyNotePath(new Date(y, m - 1, d), s.dailyFormat, s.dailyFolder);
  return { path: fullPath, title: dateStr };
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

  useEffect(() => {
    void getMobileVault().then((v) => {
      setVault(v);
      void adoptBar(v.vaultId);
      void startSyncIfConfigured(v).catch((e) => console.error("[boot] sync start failed", e));
      void startPim(v).catch((e) => console.error("[boot] pim start failed", e));
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
        // The scheduled archive (S36) is a CATCH-UP, not a clock: a phone gets
        // no background timer, so "due" is checked whenever the app is in front.
        window.dispatchEvent(new CustomEvent("m-backup-due"));
        // Share target (package J): a warm share foregrounds the app.
        window.dispatchEvent(new CustomEvent("m-poll-share"));
      }
      // Going to the background: Android may kill the process without any
      // further callback (M1) — flush pending editor saves NOW, best-effort.
      else {
        void import("./services/vaultService").then(({ noteSaver }) => noteSaver.flushAll()).catch(() => {});
        // P7.3: drop every pooled IMAP session. The OS suspends the sockets, and
        // a resumed connection is dead without saying so — reusing it would hang
        // the next mail action instead of failing fast.
        void import("@plainva/ui/mail").then(({ releaseMailSessions }) => releaseMailSessions()).catch(() => {});
      }
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
    const { path, title } = dailyPathFor(iso);
    // Push into the current context: back returns to Today/Calendar (R2).
    // Fresh dailies seed from the configured template (package I).
    void vaultOps.ensureDailyNote(vault, path, title).then((created) => {
      // null = the daily template's questions were cancelled, so no note exists.
      if (created) openNote(path);
    });
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
          if (notePath) setNav((s2) => pushCapturedNote(s2, slots, notePath));
        })();
      }}
      onOpenCalendar={() => setNav((n) => pushEntry(n, { kind: "pimcalendar", path: "" }))}
      onOpenNote={openNote}
      onOpenToday={() => openDaily(isoOf(new Date()))}
      pendingShare={pendingShare}
      pendingShortcut={pendingShortcut}
      setPendingShare={setPendingShare}
      setPendingShortcut={setPendingShortcut}
    />
  );

  // Input surfaces hide the bar (see navigation.hidesTabBar): a tap on it
  // clears the overlay and would drop the unfinished work behind them.
  // The bar hides on surfaces that hold an unfinished input, because a tap on
  // it drops the overlay stack and the draft with it. A RAIL does not have that
  // problem — it is not under the thumb, and the leave guard asks either way —
  // so from medium the navigation stays where a wide window expects it (S14).
  const barHidden = hidesTabBar(top) && windowClass === "compact";

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
      await applyTemplateSettings(def.settings);
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
  const commands = buildMobileCommands({
    newNote: capture,
    newFromTemplate: () => setFromTemplate(true),
    newFolder: quickNewFolder,
    newDatabase: quickNewDatabase,
    openDaily: () => openDaily(isoOf(new Date())),
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
    commands,
    barLayout, onBarLayout,
  };

  const hasFab = onboarded && showsCaptureFab(top, nav.activeTab); // reserves --m-fab-space
  return (
    <div className={`m-app${isKeyboardOpen ? " is-keyboard-open" : ""}${hasFab ? " has-fab" : ""}`}>
      {runPendingIntents}
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
          items={[
            { icon: <StickyNote size={ICON.head} />, label: t("mobile.newNote"), onClick: capture },
            {
              icon: <StickyNote size={ICON.head} />,
              label: t("mobile.newFromTemplate"),
              onClick: () => setFromTemplate(true),
            },
            {
              icon: <Calendar size={ICON.head} />,
              label: t("mobile.newDaily"),
              onClick: () => openDaily(isoOf(new Date())),
            },
            { icon: <FolderPlus size={ICON.head} />, label: t("mobile.newFolder"), onClick: quickNewFolder },
            { icon: <DatabaseIcon size={ICON.head} />, label: t("mobile.newDatabase"), onClick: quickNewDatabase },
          ]}
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
