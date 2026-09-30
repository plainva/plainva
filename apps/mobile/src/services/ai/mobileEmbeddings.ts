import { useEffect, useMemo } from "react";
import { App as CapApp } from "@capacitor/app";
import { DEFAULT_AI_APP_SETTINGS, type AiAppSettings } from "@plainva/core";
import { LocalEmbeddings } from "@plainva/ui";
import { NOTE_INDEXED_EVENT, type MobileVault } from "../vaultService";
import { mobileLocalModels } from "./localModels";

/** How often the phone plans again without a signal: a sync pull that sent none still counts. */
const REPLAN_MS = 60_000;

/** One step, then the web view's turn: the model runs natively, the reading and cutting here. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Search by meaning on the phone (plan KI-Harness P2a-4): one controller per
 * open vault, following the device setting of the AI screen. It embeds only
 * while the app is in the foreground — in the background it pauses, and the
 * system would stop it anyway — and plans again whenever the index moved: a
 * vault change, a saved note, the return to the foreground.
 */
export function useMobileEmbeddings(vault: MobileVault | null, loaded: AiAppSettings | null): LocalEmbeddings | null {
  const settings = loaded ?? DEFAULT_AI_APP_SETTINGS;
  const controller = useMemo(() => {
    if (!vault?.db || !vault.queryService) return null;
    const files = vault.files;
    return new LocalEmbeddings({
      bridge: mobileLocalModels,
      db: vault.db,
      query: vault.queryService,
      readText: async (path) => {
        try {
          return (await files.exists(path)) ? await files.readTextFile(path) : null;
        } catch {
          return null;
        }
      },
      ready: nextTurn,
    });
  }, [vault]);

  useEffect(() => () => void controller?.close(), [controller]);
  useEffect(() => {
    void controller?.update({ model: settings.enabled ? settings.semanticModel : null, mode: settings.searchMode });
  }, [controller, settings.enabled, settings.semanticModel, settings.searchMode]);

  useEffect(() => {
    if (!controller) return;
    const replan = () => controller.indexChanged();
    window.addEventListener("m-vault-changed", replan);
    window.addEventListener(NOTE_INDEXED_EVENT, replan);
    const timer = setInterval(replan, REPLAN_MS);
    const listener = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) controller.resume("background");
      else controller.pause("background");
    });
    return () => {
      window.removeEventListener("m-vault-changed", replan);
      window.removeEventListener(NOTE_INDEXED_EVENT, replan);
      clearInterval(timer);
      void listener.then((handle) => handle.remove());
    };
  }, [controller]);

  return controller;
}
