import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "../services/settingsStore";
import { AUTO_OPEN_LAST_VAULT_KEY } from "./VaultContext";
import { OWNER_LABEL } from "../services/windowBus";
import { currentWindowParams } from "../services/windowContext";
import {
  heldVaults,
  releaseHolder,
  setHolderVault,
  subscribeVaultRuntimes,
} from "../services/vaultRuntimes";

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

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [shownVault, setShownVault] = useState<string | null>(null);
  const [recentVaults, setRecentVaults] = useState<string[]>([]);
  const [autoOpenLastVault, setAutoOpen] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [held, setHeld] = useState<readonly string[]>(() => heldVaults());

  // The label is what a vault is held BY: a window, not a component. Reading it
  // once keeps the identity stable across re-renders, so a render can never
  // look like a different window acquiring the same vault.
  const label = useMemo(() => currentWindowParams().label ?? OWNER_LABEL, []);

  useEffect(() => subscribeVaultRuntimes(() => setHeld(heldVaults())), []);

  // This window holds exactly what it shows. Registered as one move rather than
  // release-then-acquire: a release that lands first would tear the runtime
  // down between two renders even when the same vault is shown again.
  useEffect(() => {
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
    const store = await getSettingsStore();
    await store.set("lastVaultPath", path);
    const currentRecents = (await store.get<string[]>("recentVaults")) || [];
    const newRecents = [path, ...currentRecents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
    await store.set("recentVaults", newRecents);
    await store.save();
    setRecentVaults(newRecents);
    setShownVault(path);
  }, []);

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
    setShownVault(null);
    try {
      const store = await getSettingsStore();
      await store.set("lastVaultPath", null);
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
 * An app layer that shows exactly one fixed vault, for a client window.
 *
 * An auxiliary window is told which vault it belongs to and cannot change it —
 * the lifecycle calls throw rather than doing nothing, because a button that
 * silently does nothing is the failure mode this whole architecture avoids.
 */
const ownerOnly = async (): Promise<never> => {
  throw new Error("vault lifecycle is owner-only; an auxiliary window cannot run it");
};

export const StaticAppProvider: React.FC<{ vaultPath: string | null; children: ReactNode }> = ({ vaultPath, children }) => {
  const value = useMemo<AppContextType>(
    () => ({
      shownVault: vaultPath,
      heldVaults: vaultPath ? [vaultPath] : [],
      recentVaults: [],
      autoOpenLastVault: false,
      isBooting: false,
      openVault: ownerOnly,
      selectVault: ownerOnly,
      closeVault: ownerOnly,
      removeRecentVault: ownerOnly,
      setAutoOpenLastVault: ownerOnly,
    }),
    [vaultPath],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
