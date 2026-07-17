import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import {
  PimCacheRepository,
  PimWorker,
  CalDavPimTarget,
  GooglePimTarget,
  GraphPimTarget,
  type IDatabaseAdapter,
  type IPimTarget,
  type PimAccountRow,
  type PimStatus,
} from "@plainva/core";
import { getPimCredentials } from "./pimCredentials";
import { buildPimAuthProvider } from "./pimAuth";

/**
 * Per-vault PIM runtime: cache repository + pull worker, bound to the vault's
 * index DB. Targets are built lazily per cycle from the keychain credentials
 * (never cached across cycles — a rotated Microsoft refresh token must be
 * re-read). UI refresh + status travel over window events so no component
 * tree needs re-wiring:
 *   plainva-pim-changed        — cache has fresh data, re-query
 *   plainva-pim-status         — { status, message } chip for the calendar tab
 */

export interface PimRuntime {
  cache: PimCacheRepository;
  worker: PimWorker;
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
  stop: () => void;
}

export function createPimRuntime(opts: { db: IDatabaseAdapter; vaultPath: string }): PimRuntime {
  const cache = new PimCacheRepository(opts.db);

  const buildTarget = async (account: PimAccountRow): Promise<IPimTarget | null> => {
    const creds = await getPimCredentials(opts.vaultPath, account.id);
    if (!creds) return null;
    if (creds.kind === "caldav") {
      return new CalDavPimTarget({ url: creds.url, user: creds.user, pass: creds.pass }, httpFetch);
    }
    const auth = buildPimAuthProvider(opts.vaultPath, account.id, creds);
    return creds.kind === "google" ? new GooglePimTarget(auth, httpFetch) : new GraphPimTarget(auth, httpFetch);
  };

  const worker = new PimWorker({
    cache,
    buildTarget,
    onDataChanged: () => {
      window.dispatchEvent(new CustomEvent("plainva-pim-changed"));
    },
    onStatusChange: (status: PimStatus, message?: string) => {
      window.dispatchEvent(new CustomEvent("plainva-pim-status", { detail: { status, message } }));
    },
  });

  return {
    cache,
    worker,
    buildTarget,
    stop: () => worker.stop(),
  };
}
