import { useEffect, useMemo } from "react";
import { App as CapApp } from "@capacitor/app";
import { DEFAULT_AI_APP_SETTINGS, semanticSourceOf, type AiAppSettings } from "@plainva/core";
import { aiVaultKey, createAiVaultStores, createVaultPolicy, LocalEmbeddings, type AiFileStore, type AiSession } from "@plainva/ui";
import { NOTE_INDEXED_EVENT, vaultOps, type MobileVault } from "../vaultService";
import { mobileLocalModels } from "./localModels";

/** How often the phone plans again without a signal: a sync pull that sent none still counts. */
const REPLAN_MS = 60_000;

/** One step, then the web view's turn: the model runs natively (or at the provider), the reading and cutting here. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Search by meaning on the phone (plan KI-Harness P2a-4/P2a-5): one
 * controller per open vault, following the device setting of the AI screen.
 * It embeds only while the app is in the foreground — in the background it
 * pauses, and the system would stop it anyway — and plans again whenever the
 * index moved: a vault change, a saved note, the return to the foreground.
 * For an own provider it gets the session's egress and this vault's privacy
 * rules, approvals and ledger.
 */
export function useMobileEmbeddings(vault: MobileVault | null, loaded: AiAppSettings | null, ai: { session: AiSession; files: AiFileStore }): LocalEmbeddings | null {
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
    return new LocalEmbeddings({
      bridge: mobileLocalModels,
      db: vault.db,
      query: vault.queryService,
      readText,
      ready: nextTurn,
      provider: {
        egress: session.egress,
        policy: createVaultPolicy({ readFile: readText, resolveLink: (target, from) => vaultOps.resolveWikiTarget(vault, target, from), encrypted }),
        encrypted,
        approvals: stores.approvals,
        ledger: stores.ledger,
        newId: () => crypto.randomUUID(),
        now: () => new Date(),
      },
    });
  }, [vault, session, aiFiles]);

  useEffect(() => () => void controller?.close(), [controller]);
  const source = useMemo(() => semanticSourceOf(settings), [settings]);
  useEffect(() => {
    void controller?.update({ source, mode: settings.searchMode });
  }, [controller, source, settings.searchMode]);

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
