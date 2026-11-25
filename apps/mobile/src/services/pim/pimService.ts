import { confirmedAccessOf, sameStoredValue, withOwnConfirmedAccess, CONFIRMED_ACCESS_KEY } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import type { TaskListRuntime } from "@plainva/ui";
import {
  CalDavPimTarget,
  DevicePimTarget,
  GooglePimTarget,
  GraphPimTarget,
  type IPimTarget,
  type PimAccountRow,
  type PimBlockRef,
  type PimEventRow,
  type PimCalendar,
  type PimTaskList,
  type PimEventDraft,
} from "@plainva/core";
import { webdavFetch, allowHttpOrigin } from "../../adapters/webdavHttp";
import { getMobileVault, type MobileVault } from "../vaultService";
import { phoneTemplateVault } from "../templateVault";
import { applyTemplateInteractive } from "../templateInteractive";
import { getMobileSettings } from "../mobileSettings";
import { getPimCredentials, savePimCredentials, clearPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { pimTargetCredentials, refusingUnconfirmed } from "./pimTargetCredentials";
import { buildPimAuthProvider } from "./pimAuth";
import { calendarGrantProbe } from "../accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "../cloudAccountsStore";
import { recordConnectOutcome } from "../connectQueue";
import { adoptedPimConfig, confirmationEndpoint, confirmEndpointsIn, confirmTypedEndpointsIn, adoptPreferenceForCard, droppingOwnConfirmedAccess, reportingTo, ownConfirmedAccessConfig, passwordAccountIdentity, pimPasswordAccesses, samePimPasswordAccount, assertConnectionIdentity, formatPimCycle, logDiagnostic, removeEmptyPasswordDuplicates, ServiceConnectionError, ServiceCheckError, timedDevicePimPort, withAccountCredentialLock, withBoundCard, type ServiceConnectionContext } from "@plainva/ui";
import { devicePimPort, isDevicePimSupported, requestDevicePimAccess, type DevicePimStatus } from "../../platform/devicePim";
import { Capacitor } from "@capacitor/core";
import { mobileSyncDeviceId, noteAccountRemovedLocally } from "../mobileSettingsSync";
import {
  accountToAdoptInto,
  adoptAccountInto,
  calendarPickerOptions,
  checkUnlistedCreates,
  createCalendarEvent,
  createChange,
  refusalReason,
  toast,
  type CreatedEventChange,
  applyPendingEventWrites,
  deleteEventWithBlockers,
  detachBlockerAndUpdate,
  linkCalendarBlocks,
  mayChangeEvent,
  recordBlockers,
  resolveBlockers,
  sourceOfBlocker,
  updateEventWithBlockers,
  type BlockFollowDeps,
  type BlockFollowReport,
  type EventWriteOutcome,
  type FollowedWriteOutcome,
  type ResolvedBlocker,
  draftToRow,
  pendingEventRow,
  type ShownEventRow,
  pendingEventWrites,
  writeEventOptimistically,
  etagStamp,
  type EventTargets,
  parseGoogleUserInfo,
  type VerifiedProviderProfile,
  parseMicrosoftMe,
  resolveOrCreateMeetingNote,
  markFreshNote, parkTemplateCaret,
  splitCalendarKey,
  verifiedProviderIdentityKey,
  verifiedProviderIdentityOf,
  VERIFIED_PROVIDER_IDENTITY_KEY,
  writableCalendarsOf,
  seriesDeleteSubject,
} from "@plainva/ui";
import {
  getPimStatus,
  pimSyncNow,
  restartPimAccountAfterLogin,
  runtime,
  setPimState,
  startPimRuntime,
  stopPim,
} from "./pimRuntime";

export {
  getPimCache,
  getPimStatus,
  isPimRuntimeReady,
  pimForegroundSync,
  pimSyncNow,
  resetPimForegroundThrottle,
  restartPimAccountAfterLogin,
  stopPim,
  subscribePimStatus,
} from "./pimRuntime";

/**
 * Mobile PIM service (calendar and tasks) — the phone's side of the PIM
 * runtime in pimRuntime.ts: provider targets built lazily per cycle from the
 * SecureStore credentials (never cached — a rotated token must be re-read),
 * accounts, calendars and task lists, event writes and meeting notes. The
 * runtime itself (cache, worker, status store, the triggers that ask for a
 * cycle) lives in pimRuntime.ts and is re-exported here, so the app keeps
 * importing from one place; it moved out so that it can be loaded — and
 * tested — without the sign-in store, the provider clients and, through them,
 * the whole shared UI package (Befunde 2026-09-24, Z2).
 */

/** `buildTargetFor` for the sync and "Check connection": an unconfirmed CalDAV address is refused with its name (review of F57, O-5). */
const syncTargetFor = refusingUnconfirmed(buildTargetFor);

async function buildTargetFor(vaultId: string, account: PimAccountRow): Promise<IPimTarget | null> {
  // The device account has no credential — the permission is the sign-in
  // (EventKit plan E5/E6), so it is answered before the secret store is asked.
  // Every write to the device's store and every read of a reminder list is
  // timed into the diagnostics log (plan Befunde 2026-10-06, T4): what the
  // system answered and how long it took - no title, no list name.
  if (account.provider === "device") {
    return isDevicePimSupported() ? new DevicePimTarget(timedDevicePimPort(devicePimPort(), (line) => logDiagnostic("device", line))) : null;
  }
  // None for an account signed out on this phone (review finding 3), nor for
  // a CalDAV address it has not confirmed (F57): `pimTargetCredentials`.
  const creds = await pimTargetCredentials(vaultId, account.id);
  if (!creds) return null;
  if (creds.kind === "caldav") {
    void allowHttpOrigin(creds.url);
    return new CalDavPimTarget({ url: creds.url, user: creds.user, pass: creds.pass }, webdavFetch);
  }
  const auth = buildPimAuthProvider(vaultId, account.id, creds);
  return creds.kind === "google" ? new GooglePimTarget(auth, webdavFetch) : new GraphPimTarget(auth, webdavFetch);
}

/** Boots the PIM runtime for the active vault (pimRuntime.ts) with the phone's
 * sign-in store, provider clients and diagnostics log. No-op without an index
 * DB (web dev server). */
export async function startPim(vault: MobileVault): Promise<void> {
  wirePendingEventWrites();
  // A sign-in "Remove account" could not delete is tried again first, as on
  // the desktop: it must be gone before anything reads the vault's sign-ins.
  const { settleOwedAccountSignIns } = await import("../accountBroker");
  await settleOwedAccountSignIns(vault.vaultId).catch((e) => console.error("[pim] deleting owed sign-ins failed", e));
  // A calendar or mailbox that still signs in on its own hands that sign-in
  // to its card before the calendar starts (account sign-in plan K2).
  const { migrateVaultGrants } = await import("../accountGrantMigration");
  await migrateVaultGrants(vault.vaultId).catch((e) => console.error("[pim] moving sign-ins to their accounts failed", e));
  await startPimRuntime(vault, {
    buildTarget: buildTargetFor,
    syncTarget: syncTargetFor,
    accountAuthRevision: async (vaultId, account) =>
      account.provider === "device" ? undefined : (await getPimCredentials(vaultId, account.id))?.loginRevision,
    parkedMessage: i18n.t("pim.signInRequired"),
    onCycle: (info) => logDiagnostic("pim", formatPimCycle(info)),
    // Under it the worker records how this phone reached a password account (GitHub issue 174).
    deviceId: () => mobileSyncDeviceId(),
    // The other half of "did a change made in Reminders arrive here" (T4).
    onDeviceChanged: () => logDiagnostic("device", "store changed, cycle requested"),
  });
  // A calendar switched off for the vault on another device stands still here too (E3).
  const { applyCalendarSwitches } = await import("../serviceSwitches");
  await applyCalendarSwitches(vault.vaultId).catch(() => undefined);
  // Rows of older builds learn their address, then empty duplicates of one
  // Nextcloud go (GitHub issue 174). Not in the connect lane: a restart after an import
  // already runs in it, and no connect starts before the runtime it waits for.
  await backfillCalDavAddresses(vault.vaultId).catch((e) => console.error("[pim] CalDAV addresses", e));
  await foldEmptyCalendarDuplicates(vault.vaultId).catch((e) => console.error("[pim] empty duplicates", e));
}

/**
 * CalDAV rows written by the phone before 0.9.0 carried no address and no
 * user (`config: {}`): the settings of the desktop could never find them, so
 * every device added a row of its own for the same Nextcloud (GitHub issue 174). The
 * sign-in of the row knows both; they are copied into the row once. A row
 * without a readable sign-in stays as it is.
 */
async function backfillCalDavAddresses(vaultId: string): Promise<void> {
  const owner = runtime;
  if (!owner) return;
  for (const row of await owner.cache.listAccounts()) {
    if (row.provider !== "caldav" || (typeof row.config?.url === "string" && typeof row.config?.user === "string")) continue;
    const creds = await getPimCredentials(vaultId, row.id).catch(() => null);
    if (creds?.kind !== "caldav" || !creds.url || !creds.user) continue;
    if (runtime !== owner) return;
    await owner.cache.upsertAccount({ ...row, config: { ...row.config, url: creds.url, user: creds.user } });
  }
}

/**
 * Removes calendar rows that only duplicate another of the same password
 * access and carry nothing (GitHub issue 174, the shared `planEmptyPasswordDuplicates`):
 * no sign-in here, nothing fetched, no card with another service. Local only,
 * no deletion mark — the device that has its sign-in keeps its row.
 */
export async function foldEmptyCalendarDuplicates(vaultId: string): Promise<string[]> {
  const owner = runtime;
  if (!owner || owner.vaultId !== vaultId) return [];
  const assertCurrent = () => { if (runtime !== owner) throw new Error("pim runtime changed"); };
  return removeEmptyPasswordDuplicates({
    listAccounts: () => { assertCurrent(); return owner.cache.listAccounts(); },
    listCalendars: (id) => owner.cache.listCalendars(id),
    listTaskLists: (id) => owner.cache.listTaskLists(id),
    deleteAccount: (id) => { assertCurrent(); return owner.cache.deleteAccount(id); },
    listCards: () => loadCloudAccounts(vaultId),
    hasCredentials: async (id) => (await getPimCredentials(vaultId, id)) !== null,
  });
}

/** True while this vault carries the device account (at most one, plan E7). */
export async function hasDevicePimAccount(): Promise<boolean> {
  const rows = await listPimAccounts().catch(() => []);
  return rows.some((a) => a.provider === "device");
}

/**
 * The device's calendars as an account (plan E5): one tap asks the system for
 * full access; granted, the account row is written without a secret (there is
 * none) and the worker pulls the calendars. Denied, the caller gets the state
 * and says so — the card offers the way into the system settings, never a
 * second dialog.
 */
export async function connectDevicePimAccount(label: string): Promise<{ ok: true } | { ok: false; status: DevicePimStatus }> {
  if (!runtime) throw new Error("pim runtime not started");
  if (await hasDevicePimAccount()) return { ok: true };
  const status = await requestDevicePimAccess();
  if (status.events !== "fullAccess") return { ok: false, status };
  const id = newAccountId();
  await runtime.cache.upsertAccount({
    id,
    provider: "device",
    label,
    // `device: true` marks the row the profile export skips (E8); the platform
    // is what the card names in "Erinnerungen gibt es auf Android nicht".
    config: { device: true, platform: Capacitor.getPlatform() },
    enabled: true,
  });
  if (getPimStatus().status === "off") setPimState({ status: "idle", message: null });
  runtime.worker.start();
  void runtime.worker.triggerImmediate();
  return { ok: true };
}

/** "Check connection" (account sign-in plan E6): reads the account's calendars with what this phone holds; throws when that fails. */
export async function checkPimAccount(vaultId: string, accountId: string): Promise<void> {
  const row = (await listPimAccounts()).find((entry) => entry.id === accountId);
  // Said in words, not as a bare English "not connected" that reached the row
  // as the provider's answer (plan "Verbinden", V0): no calendar account here
  // is "not connected yet", one without a sign-in here is "not signed in".
  if (!row) throw new ServiceCheckError("failed", "connection.notConnected");
  // An address this phone has not confirmed is refused with its name, and
  // the row says Confirm address (F57, O3; `syncTargetFor`).
  const target = await syncTargetFor(vaultId, row);
  if (!target) throw new ServiceCheckError("signin");
  await target.listCalendars();
}

/** A calendar account running or standing still here (the account switch of plan "Verbinden", E3); its cache stays. */
export async function setPimAccountEnabled(accountId: string, enabled: boolean): Promise<void> {
  const row = (await listPimAccounts()).find((entry) => entry.id === accountId);
  if (!row || !runtime || row.enabled === enabled) return;
  await runtime.cache.upsertAccount({ ...row, enabled });
  if (enabled) pimSyncNow();
}

/**
 * The index database was rebuilt and the settings sync has not applied the
 * document yet (`restoreAccountsAfterRebuild`): an account's absence here
 * says nothing about it.
 */
export async function pimAccountsHeldAfterRebuild(): Promise<boolean> {
  if (!runtime) return false;
  return (await runtime.cache.accountsAfterRebuild().catch(() => null)) === "held";
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

/**
 * The events a SCREEN shows: what the cache holds, with the writes that are on
 * their way laid over it (issue 119). Reminders and the widget keep reading
 * {@link listPimEvents} — they act on what the provider confirmed.
 */
export async function listShownPimEvents(rangeStartTs: number, rangeEndTs: number): Promise<ShownEventRow[]> {
  const cached = await listPimEvents(rangeStartTs, rangeEndTs);
  // A new series is drawn by its occurrences in this window until a sync lists it (issue 119).
  const shown = applyPendingEventWrites(cached, pendingEventWrites.snapshot(), { startTs: rangeStartTs, endTs: rangeEndTs });
  // The chain mark of a blocker and of an event that has blockers is drawn
  // from the linkage (K3) — derived here, once, for every screen that lists
  // events. Until then the phone had the action and no sign of its result.
  if (shown === cached) return linkCalendarBlocks(shown);
  // A created event comes from the overlay, not from the range query.
  return linkCalendarBlocks(shown.filter((row) => cached.includes(row) || (row.start.ts < rangeEndTs && row.end.ts >= rangeStartTs)));
}

/**
 * Lets settled writes go once the cache agrees with them. Asked per event and
 * not per screen range: a screen that shows today must not conclude that an
 * event deleted from next week is gone from the cache.
 */
async function reconcilePendingEventWrites(): Promise<void> {
  const cache = runtime?.cache;
  const writes = pendingEventWrites.snapshot();
  if (!cache || writes.length === 0) return;
  const found: PimEventRow[] = [];
  for (const write of writes) {
    const ref = write.kind === "create" ? write.row : write.ref;
    if (write.kind !== "create") {
      // A stamp speaks about every row of its object (R2): a series' master
      // and occurrences share the etag. A delete or a change of a whole
      // series speaks about its occurrences (R7), and the series' own row may
      // not be cached at all (Google, Microsoft, the device). So all of them
      // are asked for.
      const rows = await cache.findEventsByUid(ref.uid.split("#")[0]).catch(() => []);
      found.push(...rows.filter((row) => row.accountId === ref.accountId && row.calendarId === ref.calendarId));
      continue;
    }
    const row = await cache.getEventByUid(ref.accountId, ref.calendarId, ref.uid).catch(() => null);
    if (row) found.push(row);
  }
  pendingEventWrites.reconcile(found);
}

let pendingWritesWired = false;
/**
 * A write that begins, settles or is refused changes what the screens show;
 * they already reload on `m-pim-changed`. A finished cycle fires it too, which
 * is the moment the cache may have caught up with a settled write.
 *
 * Wired when the runtime starts, not when this module loads: at load time the
 * shared package this store comes from may not have run yet (the modules
 * import each other), and the app then did not start at all.
 */
function wirePendingEventWrites(): void {
  if (pendingWritesWired || typeof window === "undefined") return;
  pendingWritesWired = true;
  pendingEventWrites.subscribe(() => window.dispatchEvent(new CustomEvent("m-pim-changed")));
  window.addEventListener("m-pim-changed", () => void reconcilePendingEventWrites());
  // A created event no sync has listed for a while is asked about (issue 119):
  // it leaves the screen only when the provider says it does not hold it -
  // with a message and the way to create it again.
  window.setInterval(() => void checkUnlistedCreates(pendingEventWrites, (accountId) => eventTargets.targetFor(accountId), reportCreateLost), 60_000);
}

function reportCreateLost(created: CreatedEventChange): void {
  logDiagnostic("pim", "created event not held by the provider");
  const draft = created.draft;
  const key = `${created.row.accountId} ${created.row.calendarId}`;
  toast.error(
    i18n.t("pim.eventCreateLost", { title: created.row.title }),
    draft
      ? {
          label: i18n.t("pim.eventWriteRetry"),
          run: () => void createPimEvent(key, draft).catch((err: unknown) => toast.error(i18n.t("pim.eventWriteRefused", { reason: refusalReason(err) }))),
        }
      : undefined,
  );
}

/**
 * Restarts the runtime after accounts arrived through the settings sync — but
 * never under a sign-in that is being stored.
 *
 * The import fires when the app returns to the foreground, which is exactly
 * when Google's or Microsoft's dialog hands back: the plain stop-and-start
 * replaced the runtime in the middle of `addPimAccount`, the connection failed
 * with "pim runtime changed", and the screen said the target account or vault
 * had changed. Neither had. The restart now queues behind the connection (and
 * a connection that starts during the restart waits for the new runtime).
 */
export function restartPimAfterImport(vault: MobileVault): Promise<void> {
  const restart = withAccountCredentialLock(`pim-connect:${vault.vaultId}`, async () => {
    stopPim();
    await startPim(vault);
  }).finally(() => { if (pendingRestart === settled) pendingRestart = null; });
  // What a connection awaits never rejects: a failed restart is the caller's
  // to report, and the connection then says "not started" on its own.
  const settled = restart.catch(() => {});
  pendingRestart = settled;
  return restart;
}
let pendingRestart: Promise<void> | null = null;

let idCounter = 0;
function newAccountId(): string {
  // Time-free (no Date.now dependency for determinism in tests); a per-boot
  // counter plus the vault id keeps ids unique within a vault.
  idCounter += 1;
  return `pim-${runtime?.vaultId ?? "v"}-${idCounter}-${Math.round(performance.now())}`;
}

/** Adds a PIM account (credentials to SecureStore, row to the cache) and kicks
 * a sync so its calendars/events populate. Requires a booted runtime. */
/**
 * The provider-owned identity of a sign-in — the thing that lets two devices
 * recognise the SAME account.
 *
 * Without it a row can only ever be matched by label, which the sync refuses
 * to do on its own, so the account is duplicated on every device that receives
 * it (finding 2026-08-19). It is best-effort by design: the caller decides
 * whether a missing profile is fatal (adding an account) or merely a stamp that
 * has to wait (re-authorising one).
 */
async function fetchVerifiedProfile(
  auth: { getAccessToken(): Promise<string> },
  kind: "google" | "microsoft",
): Promise<VerifiedProviderProfile | null> {
  const response = await webdavFetch(
    kind === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me",
    { headers: { Authorization: `Bearer ${await auth.getAccessToken()}` } },
  );
  if (!response.ok) return null;
  const body = await response.json();
  return kind === "google" ? parseGoogleUserInfo(body) : parseMicrosoftMe(body);
}

/**
 * Whether a CalDAV address and its credentials find calendars - the
 * sign-in step's question (settings plan 2026-10-29, E5). The same probe
 * `addPimAccount` runs, without writing anything.
 */
export async function probeCalDav(creds: { url: string; user: string; pass: string }): Promise<number> {
  await allowHttpOrigin(creds.url);
  const calendars = await new CalDavPimTarget({ url: creds.url, user: creds.user, pass: creds.pass }, webdavFetch).listCalendars();
  if (!calendars.length) throw new Error("No calendars found on this server.");
  return calendars.length;
}

export async function addPimAccount(
  provider: PimStoredCredentials["kind"], label: string, creds: PimStoredCredentials, context?: ServiceConnectionContext,
): Promise<string> {
  await pendingRestart;
  const owner = runtime;
  if (!owner) throw new Error("pim runtime not started");
  return withAccountCredentialLock(`pim-connect:${owner.vaultId}`, () => {
    // Another vault is a different target; the same vault restarted is not.
    if (runtime?.vaultId !== owner.vaultId) throw new Error("pim runtime changed");
    return addPimAccountInVault(provider, label, creds, context);
  });
}

async function addPimAccountInVault(
  provider: PimStoredCredentials["kind"],
  label: string,
  creds: PimStoredCredentials,
  context?: ServiceConnectionContext,
): Promise<string> {
  const owner = runtime;
  if (!owner) throw new Error("pim runtime not started");
  const assertCurrent = () => { if (runtime !== owner) throw new Error("pim runtime changed"); };
  if (context && context.vaultId !== owner.vaultId) throw new ServiceConnectionError("accountChanged");
  const source = context?.cloudAccountId ? (await loadCloudAccounts(owner.vaultId)).find(r => r.id === context.cloudAccountId) : undefined;
  assertCurrent();
  if (context?.cloudAccountId && !source) throw new ServiceConnectionError("accountChanged");
  if (source && (provider === "google" || provider === "microsoft") && source.family !== provider) throw new ServiceConnectionError("accountChanged");
  if (provider !== creds.kind) throw new Error("pim provider mismatch");
  creds = { ...creds, loginRevision: crypto.randomUUID() };
  const id = newAccountId();
  let resolvedLabel = label;
  let config: Record<string, unknown> = {};
  let validatedCalendars: PimCalendar[];
  let validatedLists: PimTaskList[];
  // Probe in memory, including token rotation. A failed or abandoned probe
  // must not create a credential or clean up a slot in another vault.
  if (creds.kind === "google" || creds.kind === "microsoft") {
    const provisionalAuth = !creds.refreshToken && !(creds.kind === "google" && creds.nativeGoogle) && source
      ? await calendarGrantProbe(owner.vaultId, source.id, creds.kind, creds)
      : undefined;
    const auth = buildPimAuthProvider(owner.vaultId, id, creds, {
      onRotation: async (_previous, next) => { assertCurrent(); creds = next; },
      provisionalAuth,
    });
    const profile = await fetchVerifiedProfile(auth, creds.kind);
    assertCurrent();
    assertConnectionIdentity(context?.expectedIdentity ?? source?.verifiedProviderIdentity, profile?.identity ?? null);
    if (!source?.verifiedProviderIdentity && source?.label.includes("@") && source.label.trim().toLowerCase() !== profile?.label?.trim().toLowerCase()) throw new ServiceConnectionError("wrongAccount");
    const target = creds.kind === "google"
      ? new GooglePimTarget(auth, webdavFetch)
      : new GraphPimTarget(auth, webdavFetch);
    validatedCalendars = await target.listCalendars();
    validatedLists = await target.listTaskLists();
    if (profile) {
      resolvedLabel = profile.label ?? resolvedLabel;
      config = { [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity };
    }
  } else {
    // Typed here (the CalDAV form): its address counts as confirmed (F57).
    await confirmEndpointsIn(owner.vaultId, [confirmationEndpoint(creds.url)]);
    await allowHttpOrigin(creds.url);
    assertCurrent();
    const target = new CalDavPimTarget(creds, webdavFetch);
    validatedCalendars = await target.listCalendars();
    validatedLists = await target.listTaskLists();
    if (!validatedCalendars.length) throw new Error("No calendars found on this server.");
    // The address and the user are the account of a CalDAV row, as on the
    // desktop: without them in the row the settings of another device never
    // found it, and a further connect never found it either (GitHub issue 174).
    // How THIS device reached it, and the principal the server confirmed,
    // under this device's id (see confirmedAccess.ts).
    config = { url: creds.url, user: creds.user, ...ownConfirmedAccessConfig(await Promise.resolve().then(() => mobileSyncDeviceId()).catch(() => null), target.confirmedAccess?.()) };
  }
  assertCurrent();
  const known = await owner.cache.listAccounts();
  assertCurrent();
  let adoptInto = accountToAdoptInto(known, {
    id, provider, identity: verifiedProviderIdentityOf({ config }), config,
  }, adoptPreferenceForCard(source ? [source] : [], source?.id));
  // The account's calendar row arrived with the settings of another device and
  // was never signed in here. "Add the calendar" for that account IS the
  // sign-in of that row: a second row beside it was refused below as "the
  // target account changed", which nothing had. Only a row without a
  // credential on this device is taken over, and only when the sign-in is
  // proven to be the account's - by its verified identity or, for a record
  // that has none yet, by its address.
  const boundId = source?.services.calendar?.pimAccountId;
  if (!adoptInto && source && boundId && boundId !== id) {
    const bound = known.find((a) => a.id === boundId && a.provider === provider);
    const verified = verifiedProviderIdentityOf({ config });
    // A password account is the same by the one rule (`samePimPasswordAccount`):
    // the card's label is whatever the card was called — for a share run it is
    // the label that was just typed — so comparing it said yes to every row,
    // and "Alice" got the sign-in, the settings and the calendars of "alice".
    // A row that names no address yet (a device on 0.8.7 published it so) has
    // nothing to contradict the card that binds it, and is taken over.
    const sameAccount = source.verifiedProviderIdentity
      ? !!verified && verifiedProviderIdentityKey(verified) === verifiedProviderIdentityKey(source.verifiedProviderIdentity)
      : provider === "caldav"
        ? !!bound && (pimPasswordAccesses(bound).every((access) => passwordAccountIdentity(access.url, access.user) === null && !access.principal) || samePimPasswordAccount(bound, { provider, config }))
        : source.label.includes("@") && source.label.trim().toLowerCase() === resolvedLabel.trim().toLowerCase();
    if (bound && sameAccount && !(await getPimCredentials(owner.vaultId, bound.id))) adoptInto = bound;
    assertCurrent();
  }
  if (source) {
    const connectedId = adoptInto?.id ?? id;
    const records = await loadCloudAccounts(owner.vaultId);
    assertCurrent();
    const current = records.find(r => r.id === source.id);
    // A card that still names a calendar row this device no longer has is
    // free to take the new one (Sammelplan § 3.105): only a row that exists
    // makes the card another connection's.
    const holds = current?.services.calendar?.pimAccountId;
    if (!current || current.family !== source.family || (holds && holds !== connectedId && known.some((a) => a.id === holds))) throw new ServiceConnectionError("accountChanged");
    const verified = verifiedProviderIdentityOf({ config }) ?? undefined;
    if (provider === "google" || provider === "microsoft") assertConnectionIdentity(current.verifiedProviderIdentity, verified ?? null);
    const previous = await getPimCredentials(owner.vaultId, connectedId);
    const nextRecord = { ...current, label: resolvedLabel, ...(verified ? { verifiedProviderIdentity: verified } : {}), services: { ...current.services, calendar: { pimAccountId: connectedId } } };
    try {
      assertCurrent();
      await savePimCredentials(owner.vaultId, connectedId, creds);
      assertCurrent();
      await saveCloudAccounts(owner.vaultId, withBoundCard(records, nextRecord));
      assertCurrent();
      const persisted = (await loadCloudAccounts(owner.vaultId)).find(r => r.id === source.id);
      if (!sameStoredValue(persisted, nextRecord)) throw new ServiceConnectionError("storageFailed");
      assertCurrent();
      await owner.cache.upsertAccount({ id: connectedId, provider, label: resolvedLabel, config: adoptedPimConfig(adoptInto?.config, config), enabled: true });
    } catch (error) {
      // Roll back only our own credential revision. A later sign-in belongs
      // to its caller; neither failure nor a vault switch may erase it.
      const saved = await getPimCredentials(owner.vaultId, connectedId);
      if (saved?.loginRevision === creds.loginRevision) {
        if (previous) await savePimCredentials(owner.vaultId, connectedId, previous);
        else await clearPimCredentials(owner.vaultId, connectedId);
      }
      const latest = await loadCloudAccounts(owner.vaultId);
      if (sameStoredValue(latest.find(r => r.id === source.id), nextRecord)) {
        await saveCloudAccounts(owner.vaultId, latest.map(r => r.id === source.id ? current : r));
      }
      throw error;
    }
    assertCurrent();
    await owner.cache.replaceCalendars(connectedId, validatedCalendars);
    await owner.cache.replaceTaskLists(connectedId, validatedLists);
    await restartPimAccountAfterLogin(owner.vaultId, connectedId);
    await recordConnectOutcome(context, "calendar", { state: adoptInto ? "alreadyConnected" : "connected", bindingId: connectedId });
    return connectedId;
  }
  if (adoptInto) {
    await adoptAccountInto(
      {
        getCredentials: (v, accountId) => { assertCurrent(); return getPimCredentials(v, accountId); },
        saveCredentials: (v, accountId, c) => { assertCurrent(); return savePimCredentials(v, accountId, c as PimStoredCredentials); },
        clearCredentials: (v, accountId) => { assertCurrent(); return clearPimCredentials(v, accountId); },
        reassignRows: (from, to) => { assertCurrent(); return owner.cache.reassignAccountRows(from, to); },
        deleteAccount: (accountId) => { assertCurrent(); return owner.cache.deleteAccount(accountId); },
      },
      { vault: owner.vaultId, freshId: id, targetId: adoptInto.id, validatedCreds: creds },
    );
    assertCurrent();
    await owner.cache.upsertAccount({ ...adoptInto, label: resolvedLabel, config: adoptedPimConfig(adoptInto.config, config), enabled: true });
  } else {
    await savePimCredentials(owner.vaultId, id, creds);
    assertCurrent();
    await owner.cache.upsertAccount({ id, provider, label: resolvedLabel, config, enabled: true });
  }
  assertCurrent();
  const connectedId = adoptInto?.id ?? id;
  assertCurrent();
  await owner.cache.replaceCalendars(connectedId, validatedCalendars);
  await owner.cache.replaceTaskLists(connectedId, validatedLists);
  await restartPimAccountAfterLogin(owner.vaultId, connectedId);
  await recordConnectOutcome(context, "calendar", { state: adoptInto ? "alreadyConnected" : "connected", bindingId: connectedId });
  return connectedId;
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
export async function reauthorizePimAccount(accountId: string, creds: PimStoredCredentials, context?: ServiceConnectionContext): Promise<void> {
  await pendingRestart;
  const owner = runtime;
  if (!owner) throw new Error("pim runtime not started");
  // Under the same lock as a new connection, so that a restart of the runtime
  // (restartPimAfterImport) waits for a sign-in that is being stored.
  return withAccountCredentialLock(`pim-connect:${owner.vaultId}`, () => {
    if (runtime?.vaultId !== owner.vaultId) throw new ServiceConnectionError("accountChanged");
    return reauthorizePimAccountInVault(accountId, creds, context);
  });
}

async function reauthorizePimAccountInVault(accountId: string, creds: PimStoredCredentials, context?: ServiceConnectionContext): Promise<void> {
  creds = { ...creds, loginRevision: crypto.randomUUID() };
  const target = runtime;
  if (!target) throw new Error("pim runtime not started");
  const assertCurrent = () => { if (runtime !== target || (context && context.vaultId !== target.vaultId)) throw new ServiceConnectionError("accountChanged"); };
  assertCurrent();
  const existing = (await target.cache.listAccounts()).find((a) => a.id === accountId);
  if (!existing) throw new Error(`unknown pim account ${accountId}`);
  // A Google account re-signed with Microsoft credentials would leave a row
  // whose provider and secret disagree — every sync would fail with a message
  // nobody could act on.
  if (existing.provider !== creds.kind) throw new Error(`provider mismatch: ${existing.provider} account, ${creds.kind} credentials`);
  let profile: VerifiedProviderProfile | null = null;
  let caldavAccess: Record<string, unknown> | null = null;
  if (creds.kind === "google" || creds.kind === "microsoft") {
    const auth = buildPimAuthProvider(target.vaultId, accountId, creds, { onRotation: async (_previous, next) => { assertCurrent(); creds = next; } });
    profile = await fetchVerifiedProfile(auth, creds.kind);
    assertCurrent();
    assertConnectionIdentity(context?.expectedIdentity ?? verifiedProviderIdentityOf(existing) ?? undefined, profile?.identity ?? null);
    const providerTarget = creds.kind === "google" ? new GooglePimTarget(auth, webdavFetch) : new GraphPimTarget(auth, webdavFetch);
    await providerTarget.listCalendars();
    await providerTarget.listTaskLists();
  } else {
    // The repair form starts empty (`signInAgain` in PimAccountsScreen opens
    // it without the address): what it sends was typed here, and sending
    // confirms it (F57; review of F57, O3: typed means a form that started
    // empty or an endpoint other than the one it came with).
    await confirmTypedEndpointsIn(target.vaultId, [confirmationEndpoint(creds.url)], []);
    await allowHttpOrigin(creds.url);
    const caldav = new CalDavPimTarget(creds, webdavFetch);
    if (!(await caldav.listCalendars()).length) throw new Error("No calendars found on this server.");
    // The repair form can change the server and the user: the row names what
    // it now signs in to, or a later connect of the old access would adopt
    // into it and overwrite this password (GitHub issue 174). Only THIS
    // device's entry of the confirmed accesses is replaced; another device's
    // stays as that device confirmed it. The desktop has no such form; a
    // reconnect there is a fresh connect that writes the same fields.
    const access = caldav.confirmedAccess?.();
    const device = await Promise.resolve().then(() => mobileSyncDeviceId()).catch(() => null);
    caldavAccess = {
      url: creds.url,
      user: creds.user,
      ...(access && device ? { [CONFIRMED_ACCESS_KEY]: withOwnConfirmedAccess(confirmedAccessOf(existing.config), device, access) } : {}),
    };
  }
  assertCurrent();
  await savePimCredentials(target.vaultId, accountId, creds);
  assertCurrent();
  const config: Record<string, unknown> = { ...existing.config, ...(profile ? { [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity } : {}), ...(caldavAccess ?? {}) };
  await target.cache.upsertAccount({ ...existing, label: profile?.label ?? existing.label, config, enabled: true });
  assertCurrent();
  await restartPimAccountAfterLogin(target.vaultId, accountId);
}

async function retireRemovedCalDavSecret(vaultId: string, accountId: string): Promise<void> {
  const row = runtime ? (await runtime.cache.listAccounts()).find((account) => account.id === accountId) : undefined;
  if (row?.provider !== "caldav") return;
  const creds = await getPimCredentials(vaultId, accountId).catch(() => null);
  const url = creds?.kind === "caldav" ? creds.url : typeof row.config.url === "string" ? row.config.url : "";
  const user = creds?.kind === "caldav" ? creds.user : typeof row.config.user === "string" ? row.config.user : "";
  if (!url || !user) return;
  const { retireCalDavSecret } = await import("../mobileSecretsPort");
  await retireCalDavSecret(vaultId, url, user);
}

/**
 * "Sign out on this device": this phone no longer reaches the account, so its
 * confirmed access leaves the row and, with the next settings round, every
 * other device (review 2026-11-18), as on the desktop.
 */
export async function forgetOwnPimAccess(accountId: string): Promise<void> {
  if (!runtime) return;
  const device = await Promise.resolve().then(() => mobileSyncDeviceId()).catch(() => null);
  await runtime.cache.updateAccountConfigValue(accountId, CONFIRMED_ACCESS_KEY, droppingOwnConfirmedAccess(device));
}

export async function removePimAccount(accountId: string): Promise<void> {
  if (!runtime) return;
  // Before the account is gone: the tombstone is keyed on the shared id, and
  // the map that translates the local id lives beside the account (P2).
  await noteAccountRemovedLocally(runtime.vaultId, "pim", accountId).catch(() => {});
  // Its password leaves the secrets sync by this act, as on the desktop (review 2026-11-18).
  await retireRemovedCalDavSecret(runtime.vaultId, accountId).catch(reportingTo("pim:remove-secret"));
  await clearPimCredentials(runtime.vaultId, accountId);
  await runtime.cache.deleteAccount(accountId);
  if ((await runtime.cache.listAccounts()).length === 0) setPimState({ status: "off", message: null });
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

/** Task lists of every account, with their selection (S27). */
export async function listPimTaskLists() {
  if (!runtime) return [];
  return runtime.cache.listTaskLists();
}

export async function setPimTaskListSelected(accountId: string, listId: string, selected: boolean): Promise<void> {
  if (!runtime) return;
  await runtime.cache.setTaskListSelected(accountId, listId, selected);
  pimSyncNow();
}

/**
 * The runtime slice the shared task→provider rule needs (C4, S17). The phone
 * hands over access, never decisions — those live in `@plainva/ui` so both
 * shells make the same ones.
 */
export function pimTaskListRuntime(): TaskListRuntime | null {
  const rt = runtime;
  if (!rt) return null;
  return {
    listAccounts: () => rt.cache.listAccounts(),
    listTaskLists: () => rt.cache.listTaskLists(),
    createTaskFor: async (accountId: string) => {
      const account = (await rt.cache.listAccounts()).find((a) => a.id === accountId);
      const target = account ? await rt.buildTarget(account) : null;
      return target ? (listId, draft) => target.createTask(listId, draft) : null;
    },
  };
}

/** The provider target of one account (C33: the block runner asks per account). */
export async function pimTargetForAccount(accountId: string): Promise<IPimTarget | null> {
  if (!runtime) return null;
  const account = (await runtime.cache.listAccounts()).find((a) => a.id === accountId);
  return account ? runtime.syncTarget(account) : null;
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
  // An unconfirmed address is refused with its name, so the write says Confirm address (F57; round four).
  async targetFor(accountId: string) {
    if (!runtime) return null;
    const account = (await runtime.cache.listAccounts()).find((a) => a.id === accountId);
    return account ? runtime.syncTarget(account) : null;
  },
};

/*
 * Every write below shows on screen from the moment it is made (issue 119):
 * the change is laid over the cached rows by the shared overlay and stays
 * there until the cache agrees. Before, the phone waited for the provider and
 * then for a whole cycle over every account before the new event appeared —
 * the row the shared writer hands back was thrown away.
 */
export async function createPimEvent(calendarKey: string, draft: PimEventDraft) {
  const key = splitCalendarKey(calendarKey);
  if (!key) throw new Error("no writable calendar selected");
  const id = pendingEventWrites.reserve();
  const { uid: _uid, ...shown } = draftToRow(key.accountId, key.calendarId, "", draft);
  const out = await writeEventOptimistically(
    pendingEventWrites,
    // A series shows its occurrences from the first moment (issue 119).
    createChange(pendingEventRow(id, shown), draft),
    () => createCalendarEvent(eventTargets, key.accountId, key.calendarId, draft),
    (written) => written.rows.map((row) => createChange(row, draft)),
    id,
  );
  pimSyncNow({ afterWrite: true });
  return out;
}

/**
 * What the shared blocker rules need from the phone (K3): the targets and two
 * questions to the cache. The rules themselves — what follows what, when a
 * blocker asks, what a deletion takes along — are the desktop's, in one file.
 */
function followDeps(): BlockFollowDeps {
  return {
    targets: eventTargets,
    blockersOf: async (uids) => (await runtime?.cache.listBlockersOf(uids)) ?? [],
    eventsByUid: async (uid) => (await runtime?.cache.findEventsByUid(uid)) ?? [],
    busyLabel: i18n.t("pim.busyTitle"),
  };
}

/**
 * Updates an event; its blockers follow (K3). `loaded` are the rows the screen
 * holds — the blockers among them move with the event, before the provider is
 * asked.
 */
export async function updatePimEvent(
  event: PimEventRow,
  draft: PimEventDraft,
  moveToCalendarKey?: string | null,
  loaded: readonly PimEventRow[] = [],
): Promise<FollowedWriteOutcome> {
  const move = moveToCalendarKey ? splitCalendarKey(moveToCalendarKey) : null;
  // Pulled after every outcome (R2): a conflict or a refusal is exactly when
  // the screen needs the provider's current state - the next try is sent with
  // what that pull brings.
  try {
    return await updateEventWithBlockers(followDeps(), event, draft, { moveTo: move, loaded });
  } finally {
    pimSyncNow({ afterWrite: true });
  }
}

/** The blockers of an event, for the question a deletion asks about them. */
export async function pimBlockersOf(event: PimEventRow, loaded: readonly PimEventRow[] = []): Promise<ResolvedBlocker[]> {
  try {
    return (await resolveBlockers(followDeps(), event, loaded)).blockers;
  } catch {
    return [];
  }
}

/**
 * The event a blocker mirrors, where it can be found, and whether the user may
 * change it — an invitation of somebody else is not theirs to move.
 */
export async function pimSourceOfBlocker(blocker: PimEventRow): Promise<{ source: PimEventRow; canChange: boolean } | null> {
  if (!runtime || !blocker.blockOf) return null;
  try {
    const source = await sourceOfBlocker(followDeps(), blocker);
    if (!source) return null;
    const [accounts, calendars] = await Promise.all([runtime.cache.listAccounts(), runtime.cache.listCalendars()]);
    const enabled = new Set(accounts.filter((a) => a.enabled).map((a) => a.id));
    const writable = new Set(writableCalendarsOf(calendars, enabled).map((c) => `${c.accountId} ${c.id}`));
    return { source, canChange: mayChangeEvent(source, writable) };
  } catch {
    return null;
  }
}

/** "Only this blocker": it is written and stops being one. */
export async function detachPimBlocker(
  blocker: PimEventRow,
  draft: PimEventDraft,
  moveToCalendarKey: string | null | undefined,
  source: PimEventRow | null,
): Promise<EventWriteOutcome> {
  const move = moveToCalendarKey ? splitCalendarKey(moveToCalendarKey) : null;
  try {
    return await detachBlockerAndUpdate(followDeps(), blocker, draft, { moveTo: move, source });
  } finally {
    pimSyncNow({ afterWrite: true });
  }
}

/** After "Block in other calendars": the event's own list gains the new blockers. */
export async function recordPimBlockers(source: PimEventRow, created: readonly PimBlockRef[]): Promise<void> {
  if (!runtime || created.length === 0) return;
  const [accounts, calendars] = await Promise.all([runtime.cache.listAccounts(), runtime.cache.listCalendars()]);
  const enabled = new Set(accounts.filter((a) => a.enabled).map((a) => a.id));
  const writable = new Set(writableCalendarsOf(calendars, enabled).map((c) => `${c.accountId} ${c.id}`));
  if (mayChangeEvent(source, writable)) await recordBlockers(followDeps(), source, created);
}

/**
 * The master row of a series instance (S25) — "all events" targets it.
 *
 * The cache keeps the master even though the day grid filters it out; without
 * it, "all events" would edit one occurrence and quietly claim otherwise.
 */
export async function pimSeriesMaster(event: PimEventRow): Promise<PimEventRow | null> {
  if (!runtime || !event.seriesMaster) return null;
  try {
    return await runtime.cache.getEventByUid(event.accountId, event.calendarId, event.seriesMaster);
  } catch {
    return null;
  }
}

/**
 * What "delete all events" of a series is written against (issue 119): the
 * series' own row, or - where the cache lacks it - the series id the
 * occurrence carries; the device's own calendars delete the whole series by
 * that id too (3.130 no. 3).
 */
export async function pimSeriesDeleteSubject(event: PimEventRow): Promise<PimEventRow | null> {
  const master = await pimSeriesMaster(event);
  const provider = runtime ? (await runtime.cache.listAccounts().catch(() => [])).find((a) => a.id === event.accountId)?.provider : undefined;
  return seriesDeleteSubject(event, master, provider);
}

/**
 * "Termin → Besprechungsnotiz" on the phone (S27).
 *
 * The note is a normal vault note; what makes it a MEETING note is the
 * `plainva.pim` anchor in its frontmatter, and that anchor is what the desktop
 * reconciles against. So the resolution runs through the shared builder rather
 * than a phone-local one — same folder rule, same name, same anchor, whichever
 * device happens to be in hand when the meeting starts.
 *
 * The same holds for its template (plan Befunde 24.09., E24): the setting, the
 * folder and type rules and the order between them are decided by the shared
 * builder. A person tapped, so the template's questions are asked; `null`
 * means they were cancelled and nothing was written.
 */
export async function openMeetingNoteFor(
  event: PimEventRow,
  dayKey: string,
): Promise<{ path: string; created: boolean } | null> {
  const vault = await getMobileVault();
  const settings = getMobileSettings();
  const now = new Date();
  const res = await resolveOrCreateMeetingNote({
    adapter: {
      readTextFile: (p) => vault.files.readTextFile(p),
      writeTextFile: (p, c) => vault.files.writeTextFile(p, c),
      exists: (p) => vault.files.exists(p),
      createDir: (p) => vault.files.createDir(p),
    },
    event,
    dayKey,
    folder: settings.meetingFolder.trim() || "Meetings",
    noteType: "Meeting",
    templates: {
      template: settings.meetingTemplate.trim(),
      folderRules: settings.folderTemplates,
      typeRules: settings.typeTemplates,
      templateFolder: settings.templateFolder || "Templates",
    },
    // The pipeline adds the vault's pieces. `{{daily}}` in a meeting note is
    // the daily note of the MEETING's day: the note's `day` is that day.
    resolveTemplate: (raw, ctx) => applyTemplateInteractive(raw, ctx),
    templateContext: { vaultName: (await phoneTemplateVault()).name },
    now,
  });
  if (!res) return null;
  // `{{cursor}}` of the template: the editor picks it up when the note opens.
  if (res.caret) parkTemplateCaret(res.path, res.caret.note, res.caret.offset);
  // A meeting note just written opens to be written in (wish 2026-10-19).
  if (res.created) markFreshNote(res.path);
  return { path: res.path, created: res.created };
}

/**
 * Deletes an event and — where the user said so — the blockers that mirror it (K3).
 *
 * A refused delete pulls as well (issue 119, R2): until then the phone threw
 * before the pull, and "Try again" was sent with the same stale etag, for as
 * long as the next scheduled cycle took. `anyway` is the second call after a
 * `PimConflictError`, with the etag the conflict named on `event`.
 */
export async function deletePimEvent(event: PimEventRow, blockers: readonly ResolvedBlocker[] = [], options: { anyway?: boolean } = {}): Promise<BlockFollowReport> {
  try {
    return await deleteEventWithBlockers(followDeps(), event, blockers, options);
  } finally {
    pimSyncNow({ afterWrite: true });
  }
}

/** Responds to an invitation (accept/decline/tentative) via the account's target. */
export async function respondToPimEvent(event: PimEventRow, response: "accepted" | "declined" | "tentative"): Promise<void> {
  if (!runtime) throw new Error("pim runtime not started");
  const account = (await runtime.cache.listAccounts()).find((a) => a.id === event.accountId);
  if (!account) throw new Error("account not found");
  // An unconfirmed address is refused with its name, never "not supported" (F57; round four).
  const target = await runtime.syncTarget(account);
  if (!target?.respondToEvent) throw new Error("responding is not supported for this account");
  const respond = target.respondToEvent.bind(target);
  const change = { kind: "update" as const, ref: event, patch: { selfResponse: response } };
  // The answer changes the event's etag; the screens hold the new one (R2).
  await writeEventOptimistically(
    pendingEventWrites,
    change,
    () => respond({ calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href }, response),
    (written) => [change, ...etagStamp(event, written ? written.etag : undefined)],
  );
  pimSyncNow({ afterWrite: true });
}
