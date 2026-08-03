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
  type PimEventDraft,
} from "@plainva/core";
import { webdavFetch, allowHttpOrigin } from "../../adapters/webdavHttp";
import type { MobileVault } from "../vaultService";
import { getPimCredentials, savePimCredentials, clearPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { buildPimAuthProvider } from "./pimAuth";
import {
  calendarPickerOptions,
  createCalendarEvent,
  deleteCalendarEvent,
  type EventTargets,
  parseGoogleUserInfo,
  parseMicrosoftMe,
  splitCalendarKey,
  updateCalendarEvent,
  VERIFIED_PROVIDER_IDENTITY_KEY,
  writableCalendarsOf,
} from "@plainva/ui";

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

/**
 * Whether the account cache is actually up.
 *
 * `listPimAccounts()` answers `[]` both when there are no accounts AND when the
 * runtime has not booted yet — indistinguishable, and the sync worker starts in
 * parallel with it. Anything that would DELETE based on an empty list has to ask
 * this first (see mobileSecretsPort: tombstones).
 */
export function isPimRuntimeReady(): boolean {
  return runtime !== null;
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
  let resolvedLabel = label;
  let config: Record<string, unknown> = {};
  try {
    if (creds.kind === "google" || creds.kind === "microsoft") {
      const auth = buildPimAuthProvider(runtime.vaultId, id, creds);
      const accessToken = await auth.getAccessToken();
      const profileResponse = await webdavFetch(
        creds.kind === "google"
          ? "https://openidconnect.googleapis.com/v1/userinfo"
          : "https://graph.microsoft.com/v1.0/me",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const profile = profileResponse.ok
        ? creds.kind === "google"
          ? parseGoogleUserInfo(await profileResponse.json())
          : parseMicrosoftMe(await profileResponse.json())
        : null;
      const target = creds.kind === "google"
        ? new GooglePimTarget(auth, webdavFetch)
        : new GraphPimTarget(auth, webdavFetch);
      await target.listCalendars();
      if (profile) {
        resolvedLabel = profile.label ?? resolvedLabel;
        config = { [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity };
      }
    }
  } catch (error) {
    await clearPimCredentials(runtime.vaultId, id).catch(() => undefined);
    throw error;
  }
  await runtime.cache.upsertAccount({ id, provider, label: resolvedLabel, config, enabled: true });
  if (state.status === "off") setState({ status: "idle", message: null });
  runtime.worker.start();
  runtime.worker.triggerImmediate();
}

/**
 * Replaces the credential of an EXISTING account (findings P6.1).
 *
 * The repair for an expired sign-in used to be "remove the account and connect
 * it again" — which throws away everything that hangs off the account id: the
 * calendar selection, the cached events, and the `plainva.pim` anchors of every
 * mirrored task (those point at the account, so a new id orphans them and the
 * next reconcile mirrors the same tasks a second time). Same id, same row, new
 * credential.
 */
export async function reauthorizePimAccount(accountId: string, creds: PimStoredCredentials): Promise<void> {
  if (!runtime) throw new Error("pim runtime not started");
  const existing = (await runtime.cache.listAccounts()).find((a) => a.id === accountId);
  if (!existing) throw new Error(`unknown pim account ${accountId}`);
  // A Google account re-signed with Microsoft credentials would leave a row
  // whose provider and secret disagree — every sync would fail with a message
  // nobody could act on.
  if (existing.provider !== creds.kind) throw new Error(`provider mismatch: ${existing.provider} account, ${creds.kind} credentials`);
  await savePimCredentials(runtime.vaultId, accountId, creds);
  // The recorded failure describes a credential that no longer exists. Left
  // standing it would keep the row red until some later cycle happens to
  // succeed — the worker clears it the same way on success (PimWorker).
  await runtime.cache.setScopeState(accountId, "account", { lastError: null }).catch(() => {});
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

/**
 * The calendars a new event may be written into, as picker options (S24). The
 * writability rule is the shared one — visibility is not a write permission, so
 * a calendar you currently hide is still a valid target.
 */
export async function writablePimCalendarOptions(): Promise<Array<{ value: string; label: string }>> {
  if (!runtime) return [];
  const [accounts, calendars] = await Promise.all([runtime.cache.listAccounts(), runtime.cache.listCalendars()]);
  const enabled = new Set(accounts.filter((a) => a.enabled).map((a) => a.id));
  const label = new Map(accounts.map((a) => [a.id, a.label]));
  return calendarPickerOptions(writableCalendarsOf(calendars, enabled), label, accounts.length > 1);
}

/** The provider target behind a "<accountId> <calendarId>" picker key. */
export async function pimTargetForCalendarKey(calendarKey: string): Promise<IPimTarget | null> {
  if (!runtime) return null;
  const key = splitCalendarKey(calendarKey);
  if (!key) return null;
  const account = (await runtime.cache.listAccounts()).find((a) => a.id === key.accountId);
  return account ? runtime.buildTarget(account) : null;
}

/**
 * Writing events (S24). The rules around the provider calls are the shared
 * ones — a move is create+delete, a moved remote means re-pull, a written
 * event shows at once — so the phone and the desktop cannot drift into
 * producing duplicates or losing edits on the same calendar.
 */
const eventTargets: EventTargets = {
  async targetFor(accountId: string) {
    if (!runtime) return null;
    const account = (await runtime.cache.listAccounts()).find((a) => a.id === accountId);
    return account ? runtime.buildTarget(account) : null;
  },
};

export async function createPimEvent(calendarKey: string, draft: PimEventDraft) {
  const key = splitCalendarKey(calendarKey);
  if (!key) throw new Error("no writable calendar selected");
  const out = await createCalendarEvent(eventTargets, key.accountId, key.calendarId, draft);
  pimSyncNow();
  return out;
}

export async function updatePimEvent(
  event: PimEventRow,
  draft: PimEventDraft,
  moveToCalendarKey?: string | null,
) {
  const move = moveToCalendarKey ? splitCalendarKey(moveToCalendarKey) : null;
  const out = await updateCalendarEvent(eventTargets, event, draft, move);
  if (out.kind !== "conflict") pimSyncNow();
  return out;
}

export async function deletePimEvent(event: PimEventRow): Promise<void> {
  await deleteCalendarEvent(eventTargets, event);
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
