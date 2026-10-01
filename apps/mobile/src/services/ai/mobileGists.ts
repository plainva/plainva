import { useEffect, useMemo } from "react";
import { App as CapApp } from "@capacitor/app";
import { DEFAULT_AI_APP_SETTINGS, type AiAppSettings } from "@plainva/core";
import { aiVaultKey, createAiVaultStores, createVaultPolicy, LocalGists, type AiFileStore, type AiSession } from "@plainva/ui";
import { NOTE_INDEXED_EVENT, vaultOps, type MobileVault } from "../vaultService";

/** One step, then the web view's turn: the model runs on the computer it was named for. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Gists on the phone (plan KI-Harness P2b-3): one controller per open vault,
 * following the device setting and the profile "Local" — it writes only while
 * that profile names a model on a server the phone counts as local (a custom
 * endpoint marked local), only in the foreground, and plans again whenever the
 * index moved.
 */
export function useMobileGists(vault: MobileVault | null, loaded: AiAppSettings | null, ai: { session: AiSession; files: AiFileStore }): LocalGists | null {
  const settings = loaded ?? DEFAULT_AI_APP_SETTINGS;
  const { session, files: aiFiles } = ai;
  const controller = useMemo(() => {
    if (!vault?.db || !vault.queryService) return null;
    const files = vault.files;
    const readText = async (path: string) => {
      try {
        return (await files.exists(path)) ? await files.readTextFile(path) : null;
      } catch {
        return null;
      }
    };
    const encrypted = () => vault.workspaceRuntime !== null;
    const stores = createAiVaultStores(aiFiles, aiVaultKey(vault.vaultId));
    return new LocalGists({
      db: vault.db,
      readText,
      policy: createVaultPolicy({ readFile: readText, resolveLink: (target, from) => vaultOps.resolveWikiTarget(vault, target, from), encrypted }),
      encrypted,
      ready: nextTurn,
      ledger: stores.ledger,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    });
  }, [vault, aiFiles]);

  useEffect(() => () => controller?.close(), [controller]);
  const profile = settings.profiles.local;
  useEffect(() => {
    controller?.update({ enabled: settings.enabled && settings.gists, completion: session.localCompletion() });
  }, [controller, session, settings.enabled, settings.gists, profile?.providerId, profile?.model, settings.custom]);

  useEffect(() => {
    if (!controller) return;
    const replan = () => controller.indexChanged();
    window.addEventListener("m-vault-changed", replan);
    window.addEventListener(NOTE_INDEXED_EVENT, replan);
    const listener = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) controller.resume("background");
      else controller.pause("background");
    });
    return () => {
      window.removeEventListener("m-vault-changed", replan);
      window.removeEventListener(NOTE_INDEXED_EVENT, replan);
      void listener.then((handle) => handle.remove());
    };
  }, [controller]);

  return controller;
}
