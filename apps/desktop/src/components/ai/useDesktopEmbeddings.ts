import { useEffect, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_AI_APP_SETTINGS, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { LocalEmbeddings, type AiState } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { getDesktopAiSession } from "../../services/ai/desktopAi";
import { desktopLocalModels } from "../../services/ai/localModels";

const NOOP_SUBSCRIBE = () => () => undefined;
const NO_STATE = (): AiState | null => null;

/**
 * Hands the next step an idle moment of the web view: the model runs on a
 * native thread, so the only work here is reading and cutting a few notes,
 * and it waits until the window has nothing else to do.
 */
function idleMoment(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 0);
  });
}

/**
 * Search by meaning in the central window (plan KI-Harness P2a-4): one
 * controller per open vault, following the device setting of the AI page and
 * planning again whenever the index moved. The auxiliary windows have no AI
 * session and get none.
 */
export function useDesktopEmbeddings({ vaultAdapter, queryService }: { vaultAdapter: IVaultAdapter | null; queryService: VaultQueryService | null }): LocalEmbeddings | null {
  const { dbAdapter, fileTreeVersion } = useVault();
  const session = useMemo(() => getDesktopAiSession(), []);
  const state = useSyncExternalStore(session ? session.subscribe : NOOP_SUBSCRIBE, session ? session.getState : NO_STATE, session ? session.getState : NO_STATE);
  const settings = state?.loaded ? state.settings : DEFAULT_AI_APP_SETTINGS;

  const controller = useMemo(() => {
    if (!session || !dbAdapter || !vaultAdapter || !queryService) return null;
    return new LocalEmbeddings({
      bridge: desktopLocalModels,
      db: dbAdapter,
      query: queryService,
      readText: async (path) => {
        try {
          return (await vaultAdapter.exists(path)) ? await vaultAdapter.readTextFile(path) : null;
        } catch {
          return null;
        }
      },
      ready: idleMoment,
    });
  }, [session, dbAdapter, vaultAdapter, queryService]);

  // Closed with its vault.
  useEffect(() => () => void controller?.close(), [controller]);
  // The setting decides: a model only while the AI is on, and the mode.
  useEffect(() => {
    void controller?.update({ model: settings.enabled ? settings.semanticModel : null, mode: settings.searchMode });
  }, [controller, settings.enabled, settings.semanticModel, settings.searchMode]);
  // Every moved index is a reason to plan again; the plan itself is cheap.
  useEffect(() => {
    controller?.indexChanged();
  }, [controller, fileTreeVersion]);

  return controller;
}
