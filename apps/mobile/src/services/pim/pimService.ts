import { sameStoredValue } from "@plainva/core";
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
import { getActiveVaultEntry } from "../vaultRegistry";
import { applyTemplateInteractive } from "../templateInteractive";
import { getMobileSettings } from "../mobileSettings";
import { getPimCredentials, savePimCredentials, clearPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { buildPimAuthProvider } from "./pimAuth";
import { calendarGrantProbe } from "../accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "../cloudAccountsStore";
import { recordConnectOutcome } from "../connectQueue";
import { assertConnectionIdentity, formatPimCycle, logDiagnostic, ServiceConnectionError, timedDevicePimPort, withAccountCredentialLock, type ServiceConnectionContext } from "@plainva/ui";
import { devicePimPort, isDevicePimSupported, requestDevicePimAccess, type DevicePimStatus } from "../../platform/devicePim";
import { Capacitor } from "@capacitor/core";
import { noteAccountRemovedLocally } from "../mobileSettingsSync";
import {
  accountToAdoptInto,
  adoptAccountInto,
  buildDailyNotePath,
  calendarPickerOptions,
  createCalendarEvent,
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
  type EventTargets,
  parseGoogleUserInfo,
  type VerifiedProviderProfile,
  parseMicrosoftMe,
  resolveOrCreateMeetingNote,
  setPendingTemplateCaret,
  splitCalendarKey,
  verifiedProviderIdentityOf,
  VERIFIED_PROVIDER_IDENTITY_KEY,
  writableCalendarsOf,
} from "@plainva/ui";
import {
  getPimStatus,
  pimSyncNow,
  restartPimAccountAfterLogin,
  runtime,
  setPimState,
  startPimRuntime,
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

async function buildTargetFor(vaultId: string, account: PimAccountRow): Promise<IPimTarget | null> {
  // The device account has no credential — the permission is the sign-in
  // (EventKit plan E5/E6), so it is answered before the secret store is asked.
  // Every write to the device's store and every read of a reminder list is
  // timed into the diagnostics log (plan Befunde 2026-10-06, T4): what the
  // system answered and how long it took - no title, no list name.
  if (account.provider === "device") {
    return isDevicePimSupported() ? new DevicePimTarget(timedDevicePimPort(devicePimPort(), (line) => logDiagnostic("device", line))) : null;
  }
  const creds = await getPimCredentials(vaultId, account.id);
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
  return startPimRuntime(vault, {
    buildTarget: buildTargetFor,
    accountAuthRevision: async (vaultId, account) =>
      account.provider === "device" ? undefined : (await getPimCredentials(vaultId, account.id))?.loginRevision,
    parkedMessage: i18n.t("pim.signInRequired"),
    onCycle: (info) => logDiagnostic("pim", formatPimCycle(info)),
    // The other half of "did a change made in Reminders arrive here" (T4).
    onDeviceChanged: () => logDiagnostic("device", "store changed, cycle requested"),
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
  runtime.worker.triggerImmediate();
  return { ok: true };
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
  const shown = applyPendingEventWrites(cached, pendingEventWrites.snapshot());
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

export async function addPimAccount(
  provider: PimStoredCredentials["kind"], label: string, creds: PimStoredCredentials, context?: ServiceConnectionContext,
): Promise<string> {
  const owner = runtime;
  if (!owner) throw new Error("pim runtime not started");
  return withAccountCredentialLock(`pim-connect:${owner.vaultId}`, () => {
    if (runtime !== owner) throw new Error("pim runtime changed");
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
    await allowHttpOrigin(creds.url);
    assertCurrent();
    const target = new CalDavPimTarget(creds, webdavFetch);
    validatedCalendars = await target.listCalendars();
    validatedLists = await target.listTaskLists();
    if (!validatedCalendars.length) throw new Error("No calendars found on this server.");
  }
  assertCurrent();
  const known = await owner.cache.listAccounts();
  assertCurrent();
  const adoptInto = accountToAdoptInto(known, {
    id, provider, identity: verifiedProviderIdentityOf({ config }),
  });
  if (source) {
    const connectedId = adoptInto?.id ?? id;
    const records = await loadCloudAccounts(owner.vaultId);
    assertCurrent();
    const current = records.find(r => r.id === source.id);
    if (!current || current.family !== source.family || (current.services.calendar && current.services.calendar.pimAccountId !== connectedId)) throw new ServiceConnectionError("accountChanged");
    const verified = verifiedProviderIdentityOf({ config }) ?? undefined;
    if (provider === "google" || provider === "microsoft") assertConnectionIdentity(current.verifiedProviderIdentity, verified ?? null);
    const previous = await getPimCredentials(owner.vaultId, connectedId);
    const nextRecord = { ...current, label: resolvedLabel, ...(verified ? { verifiedProviderIdentity: verified } : {}), services: { ...current.services, calendar: { pimAccountId: connectedId } } };
    try {
      assertCurrent();
      await savePimCredentials(owner.vaultId, connectedId, creds);
      assertCurrent();
      await saveCloudAccounts(owner.vaultId, records.map(r => r.id === source.id ? nextRecord : r));
      assertCurrent();
      const persisted = (await loadCloudAccounts(owner.vaultId)).find(r => r.id === source.id);
      if (!sameStoredValue(persisted, nextRecord)) throw new ServiceConnectionError("storageFailed");
      assertCurrent();
      await owner.cache.upsertAccount({ id: connectedId, provider, label: resolvedLabel, config: { ...adoptInto?.config, ...config }, enabled: true });
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
    await owner.cache.upsertAccount({ ...adoptInto, label: resolvedLabel, config: { ...adoptInto.config, ...config }, enabled: true });
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
  if (creds.kind === "google" || creds.kind === "microsoft") {
    const auth = buildPimAuthProvider(target.vaultId, accountId, creds, { onRotation: async (_previous, next) => { assertCurrent(); creds = next; } });
    profile = await fetchVerifiedProfile(auth, creds.kind);
    assertCurrent();
    assertConnectionIdentity(context?.expectedIdentity ?? verifiedProviderIdentityOf(existing) ?? undefined, profile?.identity ?? null);
    const providerTarget = creds.kind === "google" ? new GooglePimTarget(auth, webdavFetch) : new GraphPimTarget(auth, webdavFetch);
    await providerTarget.listCalendars();
    await providerTarget.listTaskLists();
  } else {
    await allowHttpOrigin(creds.url);
    if (!(await new CalDavPimTarget(creds, webdavFetch).listCalendars()).length) throw new Error("No calendars found on this server.");
  }
  assertCurrent();
  await savePimCredentials(target.vaultId, accountId, creds);
  assertCurrent();
  await target.cache.upsertAccount({ ...existing, label: profile?.label ?? existing.label, config: { ...existing.config, ...(profile ? { [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity } : {}) }, enabled: true });
  assertCurrent();
  await restartPimAccountAfterLogin(target.vaultId, accountId);
}

export async function removePimAccount(accountId: string): Promise<void> {
  if (!runtime) return;
  // Before the account is gone: the tombstone is keyed on the shared id, and
  // the map that translates the local id lives beside the account (P2).
  await noteAccountRemovedLocally(runtime.vaultId, "pim", accountId).catch(() => {});
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
  return account ? runtime.buildTarget(account) : null;
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
    { kind: "create", row: pendingEventRow(id, shown) },
    () => createCalendarEvent(eventTargets, key.accountId, key.calendarId, draft),
    (written) => written.rows.map((row) => ({ kind: "create" as const, row })),
    id,
  );
  pimSyncNow();
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
  const out = await updateEventWithBlockers(followDeps(), event, draft, { moveTo: move, loaded });
  if (out.kind !== "conflict") pimSyncNow();
  return out;
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
  const out = await detachBlockerAndUpdate(followDeps(), blocker, draft, { moveTo: move, source });
  if (out.kind !== "conflict") pimSyncNow();
  return out;
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
    resolveTemplate: (raw, ctx) => applyTemplateInteractive(raw, ctx),
    templateContext: {
      vaultName: (await getActiveVaultEntry()).name || "Plainva",
      // `{{daily}}` in a meeting note is the daily note of the MEETING's day.
      dailyPath: (offset) => {
        const d = new Date(`${dayKey}T12:00:00`);
        d.setDate(d.getDate() + offset);
        return buildDailyNotePath(d, settings.dailyFormat, settings.dailyFolder).fullPath.replace(/\.md$/i, "");
      },
    },
    now,
  });
  if (!res) return null;
  // `{{cursor}}` of the template: the editor picks it up when the note opens.
  if (res.cursor !== undefined) setPendingTemplateCaret({ path: res.path, offset: res.cursor });
  return { path: res.path, created: res.created };
}

/** Deletes an event and — where the user said so — the blockers that mirror it (K3). */
export async function deletePimEvent(event: PimEventRow, blockers: readonly ResolvedBlocker[] = []): Promise<BlockFollowReport> {
  const report = await deleteEventWithBlockers(followDeps(), event, blockers);
  pimSyncNow();
  return report;
}

/** Responds to an invitation (accept/decline/tentative) via the account's target. */
export async function respondToPimEvent(event: PimEventRow, response: "accepted" | "declined" | "tentative"): Promise<void> {
  if (!runtime) throw new Error("pim runtime not started");
  const account = (await runtime.cache.listAccounts()).find((a) => a.id === event.accountId);
  if (!account) throw new Error("account not found");
  const target = await runtime.buildTarget(account);
  if (!target?.respondToEvent) throw new Error("responding is not supported for this account");
  const respond = target.respondToEvent.bind(target);
  await writeEventOptimistically(pendingEventWrites, { kind: "update", ref: event, patch: { selfResponse: response } }, () =>
    respond({ calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href }, response),
  );
  pimSyncNow();
}
