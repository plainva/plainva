import { GraphService, VaultQueryService, type IVaultAdapter } from "@plainva/core";
import { appDataDir } from "@tauri-apps/api/path";
import { exists as fsExists } from "@tauri-apps/plugin-fs";
import { TauriDatabaseAdapter } from "../adapters/TauriDatabaseAdapter";
import { TauriVaultAdapter } from "../adapters/TauriVaultAdapter";
import { RemoteVaultAdapter } from "../adapters/RemoteVaultAdapter";
import { indexDbFileName } from "./indexDbPath";
import type { WindowBus } from "./windowBus";

/**
 * Opening a vault in an auxiliary window (multi-window P0, client mode).
 *
 * The central window owns the background services; an auxiliary window gets
 * exactly four things and nothing else:
 *
 *   1. a read adapter on the vault,
 *   2. a write adapter that hands every mutation to the owner (RemoteVaultAdapter),
 *   3. a read connection to the index DB,
 *   4. the two query services that render from it.
 *
 * Everything the owner runs — indexer, file watcher, sync worker, encrypted
 * workspace worker, settings/secrets sideband, PIM worker, reminder scheduler,
 * backup scheduler, OKF conversion recovery, the undo queues — is absent by
 * construction, because this function is the ONLY way a client window opens a
 * vault. That is the point: a service list threaded through the owner's
 * `loadVault` as an `if (mode === "owner")` would grow a new entry every few
 * weeks and eventually one of them would be forgotten. Here a new service can
 * only reach an aux window if somebody adds it to this file, and
 * `clientVault.test.ts` pins what may appear.
 */
export interface ClientVaultServices {
  vaultPath: string;
  /** Writes go over the bus, reads stay local. Hand this to write paths. */
  vaultAdapter: IVaultAdapter;
  /** The plain read adapter, for callers that must not write at all. */
  readAdapter: IVaultAdapter;
  dbAdapter: TauriDatabaseAdapter;
  queryService: VaultQueryService;
  graphService: GraphService;
  dispose: () => Promise<void>;
}

/**
 * Where the index DB is, WITHOUT migrating anything.
 *
 * The owner does the one-time move of an in-vault `vault.db` into app-data and
 * decides on failure whether to keep the warm in-vault file. A client window
 * must never take part in that: two windows copying the same database around
 * is exactly the kind of race this architecture exists to avoid. It looks, in
 * order, at the app-data file the owner would have created and the legacy
 * in-vault file, and otherwise names the app-data path so the connection
 * fails loudly instead of silently indexing into a second database.
 */
export async function resolveClientIndexDbUrl(vaultPath: string): Promise<string> {
  const legacy = `${vaultPath}/.plainva/vault.db`;
  try {
    const target = `${await appDataDir()}/index/${await indexDbFileName(vaultPath)}`;
    if (await fsExists(target)) return `sqlite:${target}`;
    if (await fsExists(legacy)) return `sqlite:${legacy}`;
    return `sqlite:${target}`;
  } catch (e) {
    console.warn("[clientVault] app-data index path unavailable; falling back to the in-vault DB", e);
    return `sqlite:${legacy}`;
  }
}

/** Opens a vault read-mostly for an auxiliary window. */
export async function openClientVault(vaultPath: string, bus: WindowBus): Promise<ClientVaultServices> {
  const readAdapter = new TauriVaultAdapter(vaultPath);
  await readAdapter.initialize();

  const dbAdapter = new TauriDatabaseAdapter(await resolveClientIndexDbUrl(vaultPath));
  dbAdapter.attachReadOnly();

  // No initializeSchema() here on purpose: the schema (and every migration of
  // it) belongs to the window that owns the writes. A client that ran them
  // would race the owner on the very first open of a new vault.
  const queryService = new VaultQueryService(dbAdapter);
  const graphService = new GraphService(dbAdapter);
  const vaultAdapter = new RemoteVaultAdapter(readAdapter, bus);

  return {
    vaultPath,
    vaultAdapter,
    readAdapter,
    dbAdapter,
    queryService,
    graphService,
    dispose: async () => {
      // Detach, never close: the sql plugin's pool map is app-wide and keyed by
      // the connection string, so closing here would take the OWNER's index
      // connection down with it — the central window would start failing
      // queries the moment an auxiliary window was closed.
      dbAdapter.detach();
      await readAdapter.dispose().catch(() => {});
    },
  };
}
