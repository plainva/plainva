import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import i18n from "@plainva/ui/i18n";
import { toast } from "@plainva/ui";
import { getSettingsStore } from "../services/settingsStore";
import { RUN_IN_TRAY_KEY, enableTray } from "../services/background";
import { AUTO_OPEN_LAST_VAULT_KEY } from "./VaultContext";
import { OWNER_LABEL, getWindowBus, setBusVaultResolver } from "../services/windowBus";
import { installOwnerAppBus } from "../services/ownerBus";
import { currentWindowParams } from "../services/windowContext";
import {
  heldVaults,
  holdersOf,
  releaseHolder,
  setHolderVault,
  subscribeVaultRuntimes,
} from "../services/vaultRuntimes";
import { vaultNestingConflict, vaultNestingMessage } from "../services/vaultNesting";

/**
 * What the APP knows, as opposed to what a vault knows (multi-window stage D).
 *
 * Until stage C these two lived in one context, and that was honest while one
 * process could only hold one open vault: "the vault" and "the app" were the
 * same thing. With two windows able to show different vaults they come apart —
 * the recent list, the last-vault memory and the auto-open switch belong to the
 * app and exist exactly once, while the indexer, the watcher and the sync
 * worker belong to a vault and exist once PER open vault.
 *
 * So this context answers the questions that outlive any single vault: which
 * vaults were opened recently, whether the last one reopens on start, and which
 * one THIS window is looking at. The runtime stays where it already was, in
 * `VaultProvider` — one instance per held vault. Moving the seven-hundred-line
 * load path out of React would have been a rewrite where a split was enough,
 * and the untouched vault suites are the proof that nothing moved with it.
 *
 * `useVault()` keeps its shape: `VaultProvider` re-exports the lifecycle half
 * of this context, so none of the sixty-one consumers had to learn a second
 * hook for something they already had.
 */
interface AppContextType {
  /** Which vault this window shows; null means the splash screen. */
  shownVault: string | null;
  /** Every vault a window in this process currently holds open. */
  heldVaults: readonly string[];
  recentVaults: string[];
  autoOpenLastVault: boolean;
  /** True until the stored settings have been read (avoids a splash flash). */
  isBooting: boolean;
  openVault: (path: string) => Promise<void>;
  selectVault: () => Promise<void>;
  closeVault: () => Promise<void>;
  removeRecentVault: (path: string) => Promise<void>;
  setAutoOpenLastVault: (value: boolean) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const MAX_RECENTS = 10;

/**
 * What was open, as opposed to what was opened last (multi-window stage D).
 *
 * `lastVaultPath` is a single string, and a single string can only ever bring
 * one vault back: with two windows on two vaults, the second one was forgotten
 * on every restart — silently, because the app came up looking perfectly
 * normal, just missing a window. The list is written from the vaults actually
 * held, which is the only description of "open" that cannot drift.
 */
export const LAST_VAULT_PATHS_KEY = "lastVaultPaths";

/** The vaults that were open when the app last ran; the window restore reads it. */
export async function loadLastVaultPaths(): Promise<string[]> {
  try {
    const store = await getSettingsStore();
    const list = await store.get<string[]>(LAST_VAULT_PATHS_KEY);
    if (list?.length) return list;
    const single = await store.get<string>("lastVaultPath");
    return single ? [single] : [];
  } catch {
    return [];
  }
}

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [shownVault, setShownVault] = useState<string | null>(null);
  const [recentVaults, setRecentVaults] = useState<string[]>([]);
  const [autoOpenLastVault, setAutoOpen] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [held, setHeld] = useState<readonly string[]>(() => heldVaults());
  const shownVaultRef = useRef<string | null>(null);

  // The label is what a vault is held BY: a window, not a component. Reading it
  // once keeps the identity stable across re-renders, so a render can never
  // look like a different window acquiring the same vault.
  const label = useMemo(() => currentWindowParams().label ?? OWNER_LABEL, []);

  useEffect(() => subscribeVaultRuntimes(() => setHeld(heldVaults())), []);

  /**
   * Bring back the windows of the OTHER vaults that were open (stage D).
   *
   * The shown vault's windows are restored in `App`, which waits for its index
   * to settle. The vaults nobody shows have no such place — and they are the
   * whole point of the stored list: a window on vault B was simply gone after a
   * restart, silently, because the app came up looking perfectly normal.
   *
   * Restoring the WINDOW is enough to bring the vault back: each one registers
   * its hold on arrival, and that is what makes the central window build the
   * runtime. Tied to auto-open on purpose — with it off the user asked for a
   * clean start, and putting three windows back would not be that.
   */
  const restoredOthers = useRef(false);
  useEffect(() => {
    if (label !== OWNER_LABEL || isBooting || restoredOthers.current) return;
    if (!autoOpenLastVault) return;
    restoredOthers.current = true;
    void (async () => {
      try {
        const { getRestoreWindowsSetting, restoreAuxWindows } = await import("../services/windowManager");
        if (!(await getRestoreWindowsSetting())) return;
        for (const path of await loadLastVaultPaths()) {
          if (path === shownVaultRef.current) continue;
          // Folders move between sessions: two vaults remembered as separate
          // can overlap by the next start, and restoring them both is the one
          // way this rule could be walked around (§ 6.6). Named, not silent —
          // a window that does not come back otherwise looks like a bug.
          const clash = vaultNestingConflict(path, heldVaults());
          if (clash) {
            toast.error(vaultNestingMessage(clash));
            continue;
          }
          await restoreAuxWindows(path);
        }
      } catch (e) {
        // The app is usable without its extra windows, so this never blocks.
        console.warn("[AppContext] could not restore the windows of the other vaults", e);
      }
    })();
  }, [label, isBooting, autoOpenLastVault]);

  // Tell the other windows how many vaults are open (stage D). Only the central
  // window knows — a client sees its own and nothing else — and the one thing
  // they need it for is their window title.
  useEffect(() => {
    if (label !== OWNER_LABEL) return;
    void getWindowBus()
      .then((bus) => bus.broadcast("vaults-open", { paths: [...held] }, null))
      .catch(() => {
        /* no other window listening */
      });
  }, [label, held]);

  // Every message this window sends carries the vault it is looking at. Read
  // through a function rather than captured, because the central window changes
  // vaults while its bus stays the same (stage D).
  const isOwner = label === OWNER_LABEL;
  useEffect(() => {
    if (!isOwner) return;
    setBusVaultResolver(() => shownVaultRef.current);
  }, [isOwner]);

  // The requests that belong to the PROCESS rather than to a vault — window
  // routing, the compose hand-over, the mail queue — are installed once here.
  // Installing them per vault would answer one click twice as soon as a second
  // vault is open.
  useEffect(() => {
    if (!isOwner) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void installOwnerAppBus()
      .then((off) => {
        if (cancelled) off();
        else stop = off;
      })
      .catch((e) => console.warn("[AppContext] no window bus in this window", e));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [isOwner]);

  // Restores the tray from the setting, once per process rather than once per
  // vault. A start that fails — the environment can change between sessions —
  // turns the setting off rather than leaving a switch that claims a way back
  // which is not there.
  //
  // The trailing catch is not decoration. This effect used to sit in
  // ReminderHost, which mounts only once a vault is open; here it runs on every
  // start, splash included, and there the settings store may not answer at all.
  // Unguarded, that rejection left the production bundle throwing on startup.
  useEffect(() => {
    if (!isOwner) return;
    void (async () => {
      const store = await getSettingsStore();
      if ((await store.get<boolean>(RUN_IN_TRAY_KEY)) !== true) return;
      try {
        await enableTray();
      } catch {
        await store.set(RUN_IN_TRAY_KEY, false);
        await store.save();
      }
    })().catch((e) => console.warn("[AppContext] could not restore the tray", e));
  }, [isOwner]);

  // Remembers the open set, never an empty one: the last window to close drains
  // the held list, and writing that would erase the memory in the one moment it
  // is about to be needed.
  useEffect(() => {
    if (!isOwner || isBooting || held.length === 0) return;
    void (async () => {
      const store = await getSettingsStore();
      await store.set(LAST_VAULT_PATHS_KEY, [...held]);
      await store.save();
    })().catch((e) => console.warn("[AppContext] could not remember the open vaults", e));
  }, [isOwner, isBooting, held]);

  // This window holds exactly what it shows. Registered as one move rather than
  // release-then-acquire: a release that lands first would tear the runtime
  // down between two renders even when the same vault is shown again.
  useEffect(() => {
    shownVaultRef.current = shownVault;
    setHolderVault(shownVault, label);
  }, [shownVault, label]);

  // A window that goes away must not leave a vault pinned open — the failure
  // would be invisible: a sync worker polling for a window nobody can see.
  useEffect(() => {
    const drop = () => releaseHolder(label);
    window.addEventListener("beforeunload", drop);
    return () => {
      window.removeEventListener("beforeunload", drop);
      releaseHolder(label);
    };
  }, [label]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getSettingsStore();
        const savedPath = await store.get<string>("lastVaultPath");
        let savedRecents = (await store.get<string[]>("recentVaults")) || [];

        // Legacy migration: a remembered vault that never made it into the list.
        if (savedPath && !savedRecents.includes(savedPath)) {
          savedRecents = [savedPath, ...savedRecents].slice(0, MAX_RECENTS);
          await store.set("recentVaults", savedRecents);
          await store.save();
        }

        const savedLanguage = await store.get<string>("appLanguage");
        if (savedLanguage) {
          // Loads the bundle on demand first — locales are lazy chunks (P2.8).
          import("@plainva/ui/i18n").then(({ changeAppLanguage }) => {
            changeAppLanguage(savedLanguage).catch(console.error);
          });
        }

        // Bestand carried one remembered vault; seed the list from it once so a
        // first start after the update restores what the user had.
        if (savedPath && !(await store.get<string[]>(LAST_VAULT_PATHS_KEY))) {
          await store.set(LAST_VAULT_PATHS_KEY, [savedPath]);
          await store.save();
        }

        const autoOpen = (await store.get<boolean>(AUTO_OPEN_LAST_VAULT_KEY)) ?? false;
        if (cancelled) return;
        setRecentVaults(savedRecents);
        setAutoOpen(autoOpen);
        if (savedPath && autoOpen) setShownVault(savedPath);
      } catch (e) {
        console.error("[AppContext] could not read the stored settings", e);
      } finally {
        if (!cancelled) setIsBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openVault = useCallback(async (path: string) => {
    // Overlapping vaults are refused, not warned about (stage D, § 6.6). The
    // vaults this window alone holds do not count: switching from a folder to
    // one inside it is a move, not an overlap — nothing else is looking at the
    // one being left.
    const others = heldVaults().filter((held) => {
      const holders = holdersOf(held);
      return holders.some((holder) => holder !== label);
    });
    const clash = vaultNestingConflict(path, others);
    if (clash) {
      toast.error(vaultNestingMessage(clash));
      return;
    }
    const store = await getSettingsStore();
    await store.set("lastVaultPath", path);
    const currentRecents = (await store.get<string[]>("recentVaults")) || [];
    const newRecents = [path, ...currentRecents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
    await store.set("recentVaults", newRecents);
    await store.save();
    setRecentVaults(newRecents);
    setShownVault(path);
  }, [label]);

  const selectVault = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: i18n.t("splash.selectVaultFolderTitle"),
    });
    if (selected && typeof selected === "string") await openVault(selected);
  }, [openVault]);

  const closeVault = useCallback(async () => {
    // The runtime tears itself down when its provider unmounts; the app layer
    // only stops looking. In this order the UI answers immediately even when
    // the teardown has to wait for a sync cycle to drain.
    const closed = shownVaultRef.current;
    setShownVault(null);
    try {
      const store = await getSettingsStore();
      await store.set("lastVaultPath", null);
      // A deliberate close is remembered as closed — otherwise the vault would
      // come back on the next start and the button would look like it failed.
      if (closed) {
        const open = (await store.get<string[]>(LAST_VAULT_PATHS_KEY)) ?? [];
        await store.set(LAST_VAULT_PATHS_KEY, open.filter((p) => p !== closed));
      }
      await store.save();
    } catch (e) {
      console.error("[AppContext] could not forget the last vault", e);
    }
  }, []);

  const removeRecentVault = useCallback(async (path: string) => {
    const store = await getSettingsStore();
    const currentRecents = (await store.get<string[]>("recentVaults")) || [];
    const newRecents = currentRecents.filter((p) => p !== path);
    await store.set("recentVaults", newRecents);
    const last = await store.get<string>("lastVaultPath");
    if (last === path) await store.set("lastVaultPath", null);
    const open = (await store.get<string[]>(LAST_VAULT_PATHS_KEY)) ?? [];
    if (open.includes(path)) await store.set(LAST_VAULT_PATHS_KEY, open.filter((p) => p !== path));
    await store.save();
    setRecentVaults(newRecents);
  }, []);

  const setAutoOpenLastVault = useCallback(async (value: boolean) => {
    setAutoOpen(value);
    try {
      const store = await getSettingsStore();
      await store.set(AUTO_OPEN_LAST_VAULT_KEY, value);
      await store.save();
    } catch (e) {
      console.error("Failed to persist autoOpenLastVault:", e);
    }
  }, []);

  const value = useMemo<AppContextType>(
    () => ({
      shownVault,
      heldVaults: held,
      recentVaults,
      autoOpenLastVault,
      isBooting,
      openVault,
      selectVault,
      closeVault,
      removeRecentVault,
      setAutoOpenLastVault,
    }),
    [shownVault, held, recentVaults, autoOpenLastVault, isBooting, openVault, selectVault, closeVault, removeRecentVault, setAutoOpenLastVault],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error("useApp must be used within an AppProvider");
  return context;
};

/**
 * The app layer of a client window (stage D).
 *
 * Until stage D this was a fixed vault: an auxiliary window was told which one
 * it belonged to and every lifecycle call threw. With several vaults open that
 * is one restriction too many — a full second window is a WORKPLACE, and a
 * workplace whose vault switcher is greyed out is a workplace you have to leave
 * to change what you work on.
 *
 * What it may do and what it may not follows the same line as everywhere else:
 * this window decides what IT shows, the central one owns the runtimes. So
 * `openVault`/`closeVault` change this window (and the hold that goes with it),
 * while everything that changes the process or the stored settings — forgetting
 * a recent vault, the auto-open switch — stays with the owner. Those two still
 * throw rather than doing nothing: a button that silently does nothing is the
 * failure mode this architecture exists to avoid.
 */
const ownerOnly = async (): Promise<never> => {
  throw new Error("vault lifecycle is owner-only; an auxiliary window cannot run it");
};

export const ClientAppProvider: React.FC<{ vaultPath: string | null; children: ReactNode }> = ({ vaultPath, children }) => {
  const [shown, setShown] = useState<string | null>(vaultPath);
  const [recents, setRecents] = useState<string[]>([]);
  const [openVaults, setOpenVaults] = useState<readonly string[]>(() => (vaultPath ? [vaultPath] : []));

  // The whole picture comes from the central window; until it arrives, what
  // this window shows is the only vault it can honestly claim is open.
  useEffect(() => {
    let off: (() => void) | undefined;
    void (async () => {
      try {
        const bus = await getWindowBus();
        off = await bus.onBroadcast("vaults-open", ({ paths }) => setOpenVaults(paths));
      } catch {
        /* no bus (browser/test) */
      }
    })();
    return () => off?.();
  }, []);

  // Read-only: the aux capability carries `store:default` for exactly this kind
  // of lookup. The list is the owner's, written when IT opens a vault — this
  // window only needs it to offer the switcher something to switch to.
  useEffect(() => {
    void (async () => {
      try {
        const store = await getSettingsStore();
        setRecents((await store.get<string[]>("recentVaults")) ?? []);
      } catch {
        /* no store: the switcher falls back to picking a folder */
      }
    })();
  }, [shown]);

  const value = useMemo<AppContextType>(
    () => ({
      shownVault: shown,
      // What the PROCESS holds, as the central window last reported it. This
      // window still renders only `shownVault`; the list is what the title rule
      // asks for ("is there a second vault to tell me apart from?").
      heldVaults: openVaults,
      recentVaults: recents,
      autoOpenLastVault: false,
      isBooting: false,
      openVault: async (path: string) => setShown(path),
      selectVault: async () => {
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected === "string") setShown(selected);
      },
      closeVault: async () => setShown(null),
      removeRecentVault: ownerOnly,
      setAutoOpenLastVault: ownerOnly,
    }),
    [shown, recents, openVaults],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
