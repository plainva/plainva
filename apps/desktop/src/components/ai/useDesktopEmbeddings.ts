import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_AI_APP_SETTINGS, semanticSourceOf, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { aiVaultKey, createAiVaultStores, createVaultPolicy, LocalEmbeddings, type AiState } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { desktopAiFiles, getDesktopAiSession } from "../../services/ai/desktopAi";
import { desktopLocalModels } from "../../services/ai/localModels";

const NOOP_SUBSCRIBE = () => () => undefined;
const NO_STATE = (): AiState | null => null;

/**
 * Hands the next step an idle moment of the web view: the model runs on a
 * native thread (or at the provider), so the only work here is reading and
 * cutting a few notes, and it waits until the window has nothing else to do.
 */
function idleMoment(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 0);
  });
}

/**
 * Search by meaning in the central window (plan KI-Harness P2a-4/P2a-5): one
 * controller per open vault, following the device setting of the AI page and
 * planning again whenever the index moved. For an own provider it gets the
 * session's egress and this vault's privacy rules, approvals and ledger. The
 * auxiliary windows have no AI session and get none.
 */
export function useDesktopEmbeddings({
  vaultAdapter,
  queryService,
  vaultPath,
  encrypted,
}: {
  vaultAdapter: IVaultAdapter | null;
  queryService: VaultQueryService | null;
  vaultPath: string | null;
  encrypted: boolean;
}): LocalEmbeddings | null {
  const { dbAdapter, fileTreeVersion } = useVault();
  const session = useMemo(() => getDesktopAiSession(), []);
  const state = useSyncExternalStore(session ? session.subscribe : NOOP_SUBSCRIBE, session ? session.getState : NO_STATE, session ? session.getState : NO_STATE);
  const settings = state?.loaded ? state.settings : DEFAULT_AI_APP_SETTINGS;
  // The controller is built once per vault; whether the workspace is encrypted is read when it matters.
  const encryptedNow = useRef(encrypted);
  useLayoutEffect(() => {
    encryptedNow.current = encrypted;
  });

  // Built in an effect: its closures read the encryption flag when they run, never while rendering.
  const [controller, setController] = useState<LocalEmbeddings | null>(null);
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
    const created = new LocalEmbeddings({
      bridge: desktopLocalModels,
      db: dbAdapter,
      query: queryService,
      readText,
      ready: idleMoment,
      provider: {
        egress: session.egress,
        policy: createVaultPolicy({ readFile: readText, resolveLink: (target) => queryService.resolveNotePath(target), encrypted }),
        encrypted,
        approvals: stores.approvals,
        ledger: stores.ledger,
        newId: () => crypto.randomUUID(),
        now: () => new Date(),
      },
    });
    setController(created);
    // Closed with its vault.
    return () => {
      void created.close();
    };
  }, [session, dbAdapter, vaultAdapter, queryService, vaultPath]);

  // The setting decides: what computes (only while the AI is on), and the mode.
  const source = useMemo(() => semanticSourceOf(settings), [settings]);
  useEffect(() => {
    void controller?.update({ source, mode: settings.searchMode });
  }, [controller, source, settings.searchMode]);
  // Every moved index is a reason to plan again; the plan itself is cheap.
  useEffect(() => {
    controller?.indexChanged();
  }, [controller, fileTreeVersion]);

  return controller;
}
