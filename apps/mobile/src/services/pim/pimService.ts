import {
  PimCacheRepository,
  PimWorker,
  CalDavPimTarget,
  GooglePimTarget,
  GraphPimTarget,
  type IPimTarget,
  type PimAccountRow,
  type PimStatus,
  type PimEventRow,
  type PimCalendar,
} from "@plainva/core";
import { webdavFetch, allowHttpOrigin } from "../../adapters/webdavHttp";
import type { MobileVault } from "../vaultService";
import { getPimCredentials, savePimCredentials, clearPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { buildPimAuthProvider } from "./pimAuth";

/**
 * Mobile PIM runtime (calendar) — the phone-side twin of the desktop
 * pimRuntime: a per-vault cache repository + pull worker bound to the vault's
 * index DB, targets built lazily per cycle from the SecureStore credentials
 * (never cached — a rotated token must be re-read). Status + data travel over
 * window events so screens just re-query:
 *   m-pim-changed  — cache has fresh data, re-query
 * A subscribe/getState store drives the calendar screen's status chip.
 */

type PimUiStatus = "off" | "idle" | "syncing" | "error";

interface PimState {
  status: PimUiStatus;
  message: string | null;
  lastSyncAt: number | null;
}

interface Runtime {
  cache: PimCacheRepository;
  worker: PimWorker;
  vaultId: string;
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
}

let runtime: Runtime | null = null;
let state: PimState = { status: "off", message: null, lastSyncAt: null };
const listeners = new Set<() => void>();

function setState(next: Partial<PimState>): void {
  const finished = state.status === "syncing" && next.status === "idle";
  state = { ...state, ...next, lastSyncAt: finished ? Date.now() : state.lastSyncAt };
  for (const l of listeners) l();
}

export function subscribePimStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPimStatus(): PimState {
  return state;
}

async function buildTargetFor(vaultId: string, account: PimAccountRow): Promise<IPimTarget | null> {
  const creds = await getPimCredentials(vaultId, account.id);
  if (!creds) return null;
  if (creds.kind === "caldav") {
    void allowHttpOrigin(creds.url);
    return new CalDavPimTarget({ url: creds.url, user: creds.user, pass: creds.pass }, webdavFetch);
  }
  const auth = buildPimAuthProvider(vaultId, account.id, creds);
  return creds.kind === "google" ? new GooglePimTarget(auth, webdavFetch) : new GraphPimTarget(auth, webdavFetch);
}

/** Boots the PIM runtime for the active vault; starts the worker only when at
 * least one account is configured. No-op without an index DB (web dev server). */
export async function startPim(vault: MobileVault): Promise<void> {
  if (runtime || !vault.db) return;
  const cache = new PimCacheRepository(vault.db);
  const worker = new PimWorker({
    cache,
    buildTarget: (account) => buildTargetFor(vault.vaultId, account),
    onDataChanged: () => window.dispatchEvent(new CustomEvent("m-pim-changed")),
    onStatusChange: (status: PimStatus, message?: string) => {
      setState({ status: status === "syncing" ? "syncing" : status === "error" ? "error" : "idle", message: message ?? null });
    },
  });
  runtime = { cache, worker, vaultId: vault.vaultId, buildTarget: (a) => buildTargetFor(vault.vaultId, a) };
  const accounts = await cache.listAccounts();
  if (accounts.some((a) => a.enabled)) {
    setState({ status: "idle", message: null });
    worker.start();
  } else {
    setState({ status: "off", message: null });
  }
}

export function stopPim(): void {
  runtime?.worker.stop();
  runtime = null;
  setState({ status: "off", message: null });
}

export function getPimCache(): PimCacheRepository | null {
  return runtime?.cache ?? null;
}

export function pimSyncNow(): void {
  void runtime?.worker.triggerImmediate();
}

export async function listPimAccounts(): Promise<PimAccountRow[]> {
  return (await runtime?.cache.listAccounts()) ?? [];
}

export async function listPimCalendars(): Promise<Array<PimCalendar & { accountId: string; selected: boolean }>> {
  return (await runtime?.cache.listCalendars()) ?? [];
}

export async function setPimCalendarSelected(accountId: string, calId: string, selected: boolean): Promise<void> {
  await runtime?.cache.setCalendarSelected(accountId, calId, selected);
  pimSyncNow();
}

export async function listPimEvents(rangeStartTs: number, rangeEndTs: number): Promise<PimEventRow[]> {
  return (await runtime?.cache.listEvents(rangeStartTs, rangeEndTs)) ?? [];
}

let idCounter = 0;
function newAccountId(): string {
  // Time-free (no Date.now dependency for determinism in tests); a per-boot
  // counter plus the vault id keeps ids unique within a vault.
  idCounter += 1;
  return `pim-${runtime?.vaultId ?? "v"}-${idCounter}-${Math.round(performance.now())}`;
}

/** Adds a PIM account (credentials to SecureStore, row to the cache) and kicks
 * a sync so its calendars/events populate. Requires a booted runtime. */
export async function addPimAccount(
  provider: PimStoredCredentials["kind"],
  label: string,
  creds: PimStoredCredentials,
): Promise<void> {
  if (!runtime) throw new Error("pim runtime not started");
  const id = newAccountId();
  await savePimCredentials(runtime.vaultId, id, creds);
  await runtime.cache.upsertAccount({ id, provider, label, config: {}, enabled: true });
  if (state.status === "off") setState({ status: "idle", message: null });
  runtime.worker.start();
  runtime.worker.triggerImmediate();
}

export async function removePimAccount(accountId: string): Promise<void> {
  if (!runtime) return;
  await clearPimCredentials(runtime.vaultId, accountId);
  await runtime.cache.deleteAccount(accountId);
  if ((await runtime.cache.listAccounts()).length === 0) setState({ status: "off", message: null });
  pimSyncNow();
}

/** Responds to an invitation (accept/decline/tentative) via the account's target. */
export async function respondToPimEvent(event: PimEventRow, response: "accepted" | "declined" | "tentative"): Promise<void> {
  if (!runtime) throw new Error("pim runtime not started");
  const account = (await runtime.cache.listAccounts()).find((a) => a.id === event.accountId);
  if (!account) throw new Error("account not found");
  const target = await runtime.buildTarget(account);
  if (!target?.respondToEvent) throw new Error("responding is not supported for this account");
  await target.respondToEvent({ calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href }, response);
  pimSyncNow();
}
