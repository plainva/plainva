import i18n from "@plainva/ui/i18n";
import type { TaskListRuntime } from "@plainva/ui";
import {
  PimCacheRepository,
  PimWorker,
  CalDavPimTarget,
  DevicePimTarget,
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
import { getMobileVault, type MobileVault } from "../vaultService";
import { getMobileSettings } from "../mobileSettings";
import { getPimCredentials, savePimCredentials, clearPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { buildPimAuthProvider } from "./pimAuth";
import { devicePimPort, isDevicePimSupported, onDevicePimChanged, requestDevicePimAccess, type DevicePimStatus } from "../../platform/devicePim";
import { Capacitor } from "@capacitor/core";
import { startTaskSyncRuntime, stopTaskSyncRuntime, runMobileTaskSync } from "./taskSyncRuntime";
import { noteAccountRemovedLocally } from "../mobileSettingsSync";
import {
  accountToAdoptInto,
  adoptAccountInto,
  calendarPickerOptions,
  createCalendarEvent,
  deleteCalendarEvent,
  type EventTargets,
  parseGoogleUserInfo,
  type VerifiedProviderProfile,
  parseMicrosoftMe,
  resolveOrCreateMeetingNote,
  splitCalendarKey,
  updateCalendarEvent,
  verifiedProviderIdentityOf,
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
let stopDeviceTrigger: (() => void) | null = null;
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
  // The device account has no credential — the permission is the sign-in
  // (EventKit plan E5/E6), so it is answered before the secret store is asked.
  if (account.provider === "device") return isDevicePimSupported() ? new DevicePimTarget(devicePimPort()) : null;
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
    // What the status says when every account sits on a dead sign-in (N1/S2):
    // asking again costs a network round and answers the same way every time.
    parkedMessage: i18n.t("pim.signInRequired"),
    onDataChanged: () => {
      window.dispatchEvent(new CustomEvent("m-pim-changed"));
      // A finished cycle is the only moment the phone learns about new or moved
      // appointments — so it is also the moment its reminders can go stale
      // (S10). Lazily imported so the notification plugin never loads for a
      // vault without a calendar.
      void import("../reminderScheduler").then((m) => m.rescheduleReminders()).catch(() => {});
    },
    onStatusChange: (status: PimStatus, message?: string) => {
      setState({ status: status === "syncing" ? "syncing" : status === "error" ? "error" : "idle", message: message ?? null });
      // The end of a cycle — idle OR error — is the reconciler's hook, NOT
      // `onDataChanged`. That one only fires when the provider wrote something,
      // so a task ticked off here while the provider is quiet would never be
      // pushed. Same wiring as the desktop's pimRuntime, same reason.
      if (status !== "syncing") void runMobileTaskSync();
    },
  });
  runtime = { cache, worker, vaultId: vault.vaultId, buildTarget: (a) => buildTargetFor(vault.vaultId, a) };
  startTaskSyncRuntime({ vault, cache, buildTarget: runtime.buildTarget });
  const accounts = await cache.listAccounts();
  if (accounts.some((a) => a.enabled)) {
    setState({ status: "idle", message: null });
    worker.start();
    // "Something changed" from the device's store is the trigger the plan
    // names instead of a change feed: the next cycle runs now, not in N minutes.
    if (isDevicePimSupported()) stopDeviceTrigger = onDevicePimChanged(() => void worker.triggerImmediate());
  } else {
    setState({ status: "off", message: null });
  }
  // Boot: the OS may hold reminders from a previous run whose appointments have
  // since moved or gone. Rebuilt from what the cache holds right now.
  void import("../reminderScheduler").then((m) => m.rescheduleReminders()).catch(() => {});
  // And tell the surfaces that the cache is readable NOW.
  //
  // A screen asks once when it mounts, and `listPimEvents`/`listPimCalendars`
  // answer `[]` until this runtime exists — the same empty answer they give for
  // "no appointments", so the calendar drew an empty week and had no reason to
  // ask again: `m-pim-changed` fires only when a cycle WROTE something, and a
  // vault whose events are already cached writes nothing. The runtime boots
  // behind the vault (SQLite has to open first), so a screen mounted at app
  // start regularly won the race and then kept the empty answer until the user
  // triggered a sync by hand — maintainer finding 2026-08-24, from the iPad.
  //
  // Same class as the resume trigger in `1ad9b995` ("a cycle without news fires
  // no event"), one step earlier: there it was the missing cycle, here the
  // missing answer that the cycle's data is reachable at all.
  // Guarded like every other dispatch in this layer (accountLogin fires the
  // SAME event that way): mobile vitest runs in node, where there is no window,
  // and a service must not need a DOM to boot.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-pim-changed"));
}

export function stopPim(): void {
  runtime?.worker.stop();
  stopDeviceTrigger?.();
  stopDeviceTrigger = null;
  stopTaskSyncRuntime();
  runtime = null;
  setState({ status: "off", message: null });
}

export function getPimCache(): PimCacheRepository | null {
  return runtime?.cache ?? null;
}

export function pimSyncNow(): void {
  void runtime?.worker.triggerImmediate();
}

/**
 * Throttle for the triggers that fire on their own — returning to the app,
 * opening a screen that shows PIM data (plan Mobile-PIM-Auffrischung, P1/P3).
 *
 * A phone runs no timers in the background, so the worker's two-minute interval
 * is dead for exactly as long as the app is away and the cycle resumes at some
 * unpredictable later point. That is why an appointment or a task created
 * elsewhere took so long to appear, and why task reminders never got planned at
 * all: the reminder run reads the task DATABASE, which is only filled by the
 * mirror at the END of a cycle.
 *
 * The file sync learned this on 2026-08-10 and got `foregroundSync()`; the PIM
 * cycle was never brought along. Deliberately its OWN counter rather than a
 * shared one: the two cycles cost different things and answer to different
 * triggers, and one shared counter would let either suppress the other.
 */
const PIM_FOREGROUND_THROTTLE_MS = 60_000;
let lastForegroundPimAt = 0;

export function pimForegroundSync(now: number = Date.now()): void {
  if (!runtime) return;
  if (now - lastForegroundPimAt < PIM_FOREGROUND_THROTTLE_MS) return;
  lastForegroundPimAt = now;
  void runtime.worker.triggerImmediate();
  // The clock moved on even when the cycle finds nothing new: the rolling
  // reminder window slid, and the OS may have dropped what was scheduled. A
  // quiet cycle fires no `onDataChanged`, so this cannot wait for one.
  void import("../reminderScheduler").then((m) => m.rescheduleReminders()).catch(() => {});
}

/** Test seam: lets a suite start from a known throttle state. */
export function resetPimForegroundThrottle(): void {
  lastForegroundPimAt = 0;
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
  if (state.status === "off") setState({ status: "idle", message: null });
  runtime.worker.start();
  runtime.worker.triggerImmediate();
  return { ok: true };
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
      const profile = await fetchVerifiedProfile(auth, creds.kind);
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
  // Is this a repair of an account we already have? Connecting again is the
  // normal fix for an expired sign-in, and every connect mints a new id — so
  // without this the phone ends up with two rows for one account while the
  // task anchors and cursors stay with the old one (C22). Same rule, same
  // shared helper as the desktop; only the plumbing differs.
  const known = await runtime.cache.listAccounts().catch(() => []);
  const adoptInto = accountToAdoptInto(known, {
    id,
    provider,
    identity: verifiedProviderIdentityOf({ config }),
  });
  if (adoptInto) {
    const cache = runtime.cache;
    await adoptAccountInto(
      {
        getCredentials: getPimCredentials,
        saveCredentials: (v, accountId, c) => savePimCredentials(v, accountId, c as PimStoredCredentials),
        clearCredentials: clearPimCredentials,
        reassignRows: (from, to) => cache.reassignAccountRows(from, to),
        deleteAccount: (accountId) => cache.deleteAccount(accountId),
      },
      { vault: runtime.vaultId, freshId: id, targetId: adoptInto.id, validatedCreds: creds },
    );
    await cache.upsertAccount({ ...adoptInto, label: resolvedLabel, config, enabled: true });
  } else {
    await runtime.cache.upsertAccount({ id, provider, label: resolvedLabel, config, enabled: true });
  }
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

  // Stamp the verified identity while we hold a fresh token. A row that never
  // carries one can never be recognised as the same account on a second device,
  // so re-authorising used to leave it permanently unmergeable — and the sync
  // answered that by adding another copy of it (finding 2026-08-19). Failing to
  // read the profile must NOT undo the sign-in, so this is best-effort; the
  // stamp follows the account that actually answered, which is the state the
  // row is in now.
  if (creds.kind === "google" || creds.kind === "microsoft") {
    try {
      const profile = await fetchVerifiedProfile(buildPimAuthProvider(runtime.vaultId, accountId, creds), creds.kind);
      if (profile) {
        await runtime.cache.upsertAccount({
          ...existing,
          label: profile.label ?? existing.label,
          config: { ...existing.config, [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity },
        });
      }
    } catch {
      /* the sign-in stands; the next successful cycle can stamp it */
    }
  }

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
  // Before the account is gone: the tombstone is keyed on the shared id, and
  // the map that translates the local id lives beside the account (P2).
  await noteAccountRemovedLocally(runtime.vaultId, "pim", accountId).catch(() => {});
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
 */
export async function openMeetingNoteFor(
  event: PimEventRow,
  dayKey: string,
): Promise<{ path: string; created: boolean }> {
  const vault = await getMobileVault();
  const settings = getMobileSettings();
  return resolveOrCreateMeetingNote({
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
  });
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
