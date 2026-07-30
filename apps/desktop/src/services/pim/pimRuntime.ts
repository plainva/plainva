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
import { getPimCredentials, type PimStoredCredentials } from "./pimCredentials";
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

/**
 * The credentials shape for an account whose sign-in lives in the shared
 * account slot: an EMPTY refresh token, which is precisely what the auth
 * provider treats as "ask the broker". CalDAV never gets here — it has no
 * broker and no account slot, so a missing slot really does mean not connected.
 */
function brokerBackedCredentials(account: PimAccountRow): PimStoredCredentials | null {
  const clientId = typeof account.config.clientId === "string" ? account.config.clientId : "";
  if (account.provider === "google") {
    const clientSecret = typeof account.config.clientSecret === "string" ? account.config.clientSecret : "";
    return { kind: "google", clientId, clientSecret, refreshToken: "" };
  }
  if (account.provider === "microsoft") return { kind: "microsoft", clientId, refreshToken: "" };
  return null;
}

export function createPimRuntime(opts: {
  db: IDatabaseAdapter;
  vaultPath: string;
  /** Fires after every completed worker cycle (idle OR error) — the stage-3
   * task reconciler hangs here (local edits must push even when no remote
   * data changed). */
  onCycleEnd?: () => void;
}): PimRuntime {
  const cache = new PimCacheRepository(opts.db);

  const buildTarget = async (account: PimAccountRow): Promise<IPimTarget | null> => {
    // An account connected through the union consent has NO per-service slot —
    // its one sign-in lives in the account slot and is read through the broker.
    // Treating a missing slot as "cannot be served" therefore skipped exactly
    // those accounts, every cycle, in silence: no target, no error, and an empty
    // calendar list that looked like the account had nothing (finding
    // 2026-07-30). The row itself carries what is needed to ask the broker.
    const creds = (await getPimCredentials(opts.vaultPath, account.id))  ?? brokerBackedCredentials(account);
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
      if (status !== "syncing") opts.onCycleEnd?.();
    },
  });

  return {
    cache,
    worker,
    buildTarget,
    stop: () => worker.stop(),
  };
}
