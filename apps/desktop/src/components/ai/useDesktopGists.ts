import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_AI_APP_SETTINGS, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { aiVaultKey, createAiVaultStores, createVaultPolicy, LocalGists, type AiState } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { desktopAiFiles, getDesktopAiSession } from "../../services/ai/desktopAi";
import { idleMoment } from "./useDesktopEmbeddings";

const NOOP_SUBSCRIBE = () => () => undefined;
const NO_STATE = (): AiState | null => null;

/**
 * Gists in the central window (plan KI-Harness P2b-3): one controller per
 * open vault, following the device setting and the profile "Local" — it
 * writes only while that profile names a model on this computer, in idle
 * moments, and plans again whenever the index moved. The auxiliary windows
 * have no AI session and get none.
 */
export function useDesktopGists({
  vaultAdapter,
  queryService,
  vaultPath,
  encrypted,
}: {
  vaultAdapter: IVaultAdapter | null;
  queryService: VaultQueryService | null;
  vaultPath: string | null;
  encrypted: boolean;
}): LocalGists | null {
  const { dbAdapter, fileTreeVersion } = useVault();
  const session = useMemo(() => getDesktopAiSession(), []);
  const state = useSyncExternalStore(session ? session.subscribe : NOOP_SUBSCRIBE, session ? session.getState : NO_STATE, session ? session.getState : NO_STATE);
  const settings = state?.loaded ? state.settings : DEFAULT_AI_APP_SETTINGS;
  const encryptedNow = useRef(encrypted);
  useLayoutEffect(() => {
    encryptedNow.current = encrypted;
  });

  // Built in an effect: its closures read the encryption flag when they run, never while rendering.
  const [controller, setController] = useState<LocalGists | null>(null);
  useEffect(() => {
    if (!session || !dbAdapter || !vaultAdapter || !queryService || !vaultPath) {
      setController(null);
      return;
    }
    const readText = async (path: string) => {
      try {
        return (await vaultAdapter.exists(path)) ? await vaultAdapter.readTextFile(path) : null;
      } catch {
        return null;
      }
    };
    const stores = createAiVaultStores(desktopAiFiles, aiVaultKey(vaultPath));
    const encrypted = () => encryptedNow.current;
    const created = new LocalGists({
      db: dbAdapter,
      readText,
      policy: createVaultPolicy({ readFile: readText, resolveLink: (target) => queryService.resolveNotePath(target), encrypted }),
      encrypted,
      ready: idleMoment,
      ledger: stores.ledger,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    });
    setController(created);
    return () => created.close();
  }, [session, dbAdapter, vaultAdapter, queryService, vaultPath]);

  // The setting and the profile "Local" decide; the session says whether that profile runs on this computer.
  const profile = settings.profiles.local;
  useEffect(() => {
    controller?.update({ enabled: settings.enabled && settings.gists, completion: session?.localCompletion() ?? null });
  }, [controller, session, settings.enabled, settings.gists, profile?.providerId, profile?.model, settings.custom]);
  useEffect(() => {
    controller?.indexChanged();
  }, [controller, fileTreeVersion]);

  return controller;
}
