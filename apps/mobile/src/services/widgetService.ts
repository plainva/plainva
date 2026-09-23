import { Preferences } from "@capacitor/preferences";
import {
  buildWidgetSnapshot,
  calendarDay,
  parseBaseConfig,
  parseWidgetSnapshot,
  plannerRowsFromDb,
  resolveTaskCompletionModel,
  serializeWidgetSnapshot,
  taskDbRows,
  toast,
  usableWidgetActions,
  WIDGET_SNAPSHOT_DAYS,
  type PlannerRow,
  type WidgetEventInput,
  type WidgetLabels,
  type WidgetRowRef,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { clearWidgetActions, clearWidgetSnapshot, readWidgetActions, readWidgetSnapshot, widgetsAvailable, writeWidgetSnapshot } from "../platform/widgetBridge";
import { getMobileSettings } from "./mobileSettings";
import { getMobileWorkspaceStatus, loadMobileWorkspaceRuntime } from "./mobileWorkspaceSecurity";
import { listPimEvents } from "./pim/pimService";
import { getActiveVaultEntry } from "./vaultRegistry";

/**
 * What the home-screen widgets get to see, and when (plan Widgets, W2/E7).
 *
 * The phone runs no JavaScript in the background, so a widget can work nothing
 * out for itself. Everything it shows has to be written down while the app was
 * open — which makes this file the list of moments at which that is worth
 * doing, and nothing else: `widgetSnapshot.ts` decides WHAT travels,
 * `widgetBridge.ts` carries it, the native `WidgetStore` holds it.
 *
 * The moments are the ones at which the answer can have changed without the
 * widget hearing about it: coming to the front and going away (E7), a finished
 * sync of files, calendars or provider tasks, and any edit that touches the
 * task database. They arrive as the app's own events, so a surface that starts
 * firing one of them is covered without touching this file again.
 *
 * Nothing here ever throws at its caller. A widget that keeps yesterday's
 * picture is a cosmetic fault; a foreground sync that fails because of one is
 * not.
 */

/** A burst of edits writes one snapshot, not one per keystroke. */
const DEBOUNCE_MS = 400;

/**
 * Where a tapped row leads.
 *
 * The snapshot itself carries no path — it is read by another process, and a
 * home screen is a place other people look at. But a tap still has to arrive
 * at a note, so the paths are kept HERE, in the app's own storage: Android
 * private preferences, iOS `UserDefaults` of the app rather than the App Group
 * the widget reads. Same order and same length as the snapshot's rows, stamped
 * with the snapshot it belongs to — an index means a row within ONE snapshot.
 */
const REFS_KEY = "widget-refs-v1";

export interface WidgetRefTable {
  writtenAt: number;
  refs: (WidgetRowRef | null)[];
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let queued = false;
let wired = false;

/** The handful of fixed words the widget shows, in the app's language. */
function labels(): WidgetLabels {
  return {
    today: i18n.t("widget.today"),
    overdue: i18n.t("widget.overdue"),
    empty: i18n.t("widget.empty"),
    locked: i18n.t("widget.locked"),
    pending: i18n.t("widget.pending"),
    newTask: i18n.t("widget.newTask"),
    newJournal: i18n.t("widget.newJournal"),
  };
}

/**
 * Is the active vault a sealed workspace this device cannot open?
 *
 * The same two questions `ShareInbox` asks: a phase other than `active`, or an
 * active phase whose runtime is not in memory because the vault was locked.
 * Either way the snapshot goes out empty — not full-and-hidden.
 */
async function isLocked(vaultId: string): Promise<boolean> {
  try {
    const status = await getMobileWorkspaceStatus(vaultId);
    if (!status) return false;
    if (status.phase !== "active") return true;
    return !(await loadMobileWorkspaceRuntime(vaultId));
  } catch {
    // An unanswerable question about a lock is answered with the lock.
    return true;
  }
}

/**
 * The task database, as planner rows.
 *
 * The DATABASE only, exactly like the Today screen and the reminder scheduler:
 * a checkbox in a note has no typed due value, so there is nothing a widget
 * could put on a day. A missing or unreadable database is an empty list, never
 * a failure — the widget then shows the appointments alone.
 */
async function taskRows(): Promise<PlannerRow[]> {
  const db = getMobileSettings().taskDatabase.trim();
  if (!db) return [];
  try {
    const { getMobileVault, vaultOps } = await import("./vaultService");
    const vault = await getMobileVault();
    if (!vault.queryService) return [];
    const config = parseBaseConfig(await vaultOps.read(vault, db));
    const raw = (await vault.queryService.queryDatabaseFiles(config)) as Record<string, unknown>[];
    const rows = taskDbRows(raw, config, resolveTaskCompletionModel(config));
    // No meta: a widget shows neither the recurrence mark nor the mirror mark.
    return plannerRowsFromDb(rows, () => undefined);
  } catch {
    return [];
  }
}

/** The appointments of the coming week, flattened to a day and a time. */
async function eventRows(now: Date): Promise<WidgetEventInput[]> {
  try {
    const from = now.getTime();
    const to = from + (WIDGET_SNAPSHOT_DAYS + 1) * 86_400_000;
    return (await listPimEvents(from, to)).map((event) => {
      // An all-day appointment carries its civil date and must never be
      // shifted through a timezone; a timed one is read on the local clock.
      if (event.allDay) return { title: event.title, day: event.start.date ?? calendarDay(new Date(event.start.ts)), minutes: null };
      const at = new Date(event.start.ts);
      return { title: event.title, day: calendarDay(at), minutes: at.getHours() * 60 + at.getMinutes() };
    });
  } catch {
    return [];
  }
}

async function saveRefs(table: WidgetRefTable): Promise<void> {
  try {
    await Preferences.set({ key: REFS_KEY, value: JSON.stringify(table) });
  } catch {
    /* a tap that cannot be resolved opens the app, which is the fallback anyway */
  }
}

/** Where the rows of the snapshot on disk lead. Null when there is none. */
export async function readWidgetRefs(): Promise<WidgetRefTable | null> {
  try {
    const stored = await Preferences.get({ key: REFS_KEY });
    if (!stored.value) return null;
    const table = JSON.parse(stored.value) as WidgetRefTable;
    return Array.isArray(table?.refs) && typeof table.writtenAt === "number" ? table : null;
  } catch {
    return null;
  }
}

/**
 * Writes what the widgets draw until the app next runs.
 *
 * Coalesced rather than queued: while one run is in flight a second request
 * only sets a flag, and the run repeats once at the end. Two snapshots written
 * back to back would differ only in `writtenAt` — and every tick made against
 * the first would become unresolvable.
 */
export async function refreshWidgets(): Promise<void> {
  if (!widgetsAvailable()) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    do {
      queued = false;
      await writeOnce();
    } while (queued);
  } finally {
    running = false;
  }
}

async function writeOnce(): Promise<void> {
  try {
    const entry = await getActiveVaultEntry();
    // The same fallback the shell shows in its header.
    const vaultName = entry.name || "Plainva";
    const settings = getMobileSettings();
    const now = new Date();
    const locked = await isLocked(entry.id);
    const [tasks, events] = locked
      ? [[], []]
      : await Promise.all([taskRows(), settings.widgetShowEvents ? eventRows(now) : Promise.resolve([])]);
    const { snapshot, refs } = buildWidgetSnapshot({
      vaultName,
      locked,
      tasks,
      events,
      showTitles: settings.widgetShowTitles,
      showEvents: settings.widgetShowEvents,
      labels: labels(),
      now,
    });
    // Refs first, snapshot second. A process killed in between leaves a table
    // nothing points at, which costs nothing; the other order would leave rows
    // on the home screen that no tap could resolve.
    await saveRefs({ writtenAt: snapshot.writtenAt, refs });
    await writeWidgetSnapshot(serializeWidgetSnapshot(snapshot));
  } catch {
    /* a stale widget, never a failed caller */
  }
}

/**
 * Redeems the ticks made on a widget (plan Widgets, W5).
 *
 * A tick on the home screen only ever RECORDED an intention; this is where it
 * becomes a change, through the very building block the checkbox in the app
 * uses — completion model, recurrence, provider sync. Doing it any other way
 * would be a second answer to "what does ticking this box do".
 *
 * **This has to run before the next snapshot is written**, and that is not a
 * preference. An order names the snapshot it was made against; write a fresh
 * one first and every waiting tick becomes unresolvable at once. Hence
 * `catchUpWidgets` below, which is what the lifecycle calls.
 *
 * A task that has since been finished, deleted or moved falls out silently:
 * the alternative is a dialogue about a tap someone made yesterday on a home
 * screen, which nobody can act on and everybody has forgotten.
 */
export async function redeemWidgetActions(): Promise<number> {
  if (!widgetsAvailable()) return 0;
  const actions = await readWidgetActions();
  if (actions.length === 0) return 0;

  const raw = await readWidgetSnapshot();
  const usable = usableWidgetActions(actions, raw ? parseWidgetSnapshot(raw) : null);
  const table = await readWidgetRefs();

  let done = 0;
  for (const action of usable) {
    const ref = table && table.writtenAt === action.snapshotAt ? table.refs[action.index] : null;
    if (!ref?.path) continue;
    try {
      const { setTaskDone } = await import("./taskCompletionAction");
      if ((await setTaskDone(ref.path, true)).changed) done += 1;
    } catch {
      // Gone, moved, or a database that cannot express "done": out it goes.
    }
  }

  // EVERY order that was read is cleared, applied or not. One that could not
  // be resolved now never will be — its snapshot is already history — and
  // leaving it would make the queue grow for the life of the install.
  await clearWidgetActions(actions.map((action) => action.id));

  if (done > 0) toast.info(i18n.t("widget.redeemed", { count: done }));
  return done;
}

/**
 * What the app does about its widgets when it comes back: redeem, then write.
 * The order is the whole point — see above.
 */
export async function catchUpWidgets(): Promise<void> {
  try {
    await redeemWidgetActions();
  } catch {
    /* a tick that cannot be redeemed must not cost the refresh */
  }
  await refreshWidgets();
}

/** A row of the widget, resolved back to the note behind it. */
export interface WidgetOpenTarget {
  path: string;
  /** Checkbox ordinal inside the note; absent for a database row. */
  ordinal?: number;
}

let parkedOpen: WidgetOpenTarget | null = null;

/** Takes the parked target, if the shell has not drained it yet. */
export function consumeWidgetOpen(): WidgetOpenTarget | null {
  const target = parkedOpen;
  parkedOpen = null;
  return target;
}

/**
 * A tap on a widget row: `com.plainva.app://widget/open/<index>?at=<writtenAt>`.
 *
 * The URL carries a POSITION, never a title and never a path — an intent is
 * readable by the launcher, and a home screen is a place other people look at.
 * Resolving it is this side's job, against the table the app wrote beside the
 * snapshot.
 *
 * `at` is what makes that safe. An index only means a row within ONE snapshot;
 * if the app has written a newer one since the widget was drawn, the same
 * index now names a different row. Then nothing is opened by guess — the
 * Today screen is, which is where someone tapping a widget was heading anyway.
 */
export async function routeWidgetOpen(url: string): Promise<void> {
  const parsed = /widget\/open\/(\d+)(?:\?at=(\d+))?/.exec(url);
  const target = parsed ? await resolveWidgetRow(Number(parsed[1]), parsed[2] ? Number(parsed[2]) : null) : null;
  if (!target) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-shortcut", { detail: { which: "today" } }));
    return;
  }
  parkedOpen = target;
  // Parked and signalled rather than opened: a tap on a widget can be what
  // STARTED the app, and then no vault is open to put a note into yet.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-widget-open"));
}

/** The note behind a row, or null when the index can no longer be trusted. */
export async function resolveWidgetRow(index: number, snapshotAt: number | null): Promise<WidgetOpenTarget | null> {
  if (!Number.isInteger(index) || index < 0) return null;
  const table = await readWidgetRefs();
  if (!table || table.writtenAt === 0) return null;
  if (snapshotAt !== null && snapshotAt !== table.writtenAt) return null;
  const ref = table.refs[index];
  return ref && ref.path ? ref : null;
}

/** Coalesces a burst of triggers into one write. */
export function scheduleWidgetRefresh(): void {
  if (!widgetsAvailable()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshWidgets();
  }, DEBOUNCE_MS);
}

/**
 * Wipes what the widgets show — the vault was locked, switched or removed
 * (W6). Emptying beats waiting for the next write: the seal is the moment the
 * titles must leave the home screen.
 */
export async function clearWidgets(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await clearWidgetSnapshot();
  // The table outlives nothing: an index without a snapshot means no row.
  await saveRefs({ writtenAt: 0, refs: [] });
}

/**
 * Wires the moments from E7. Called once at startup; the lifecycle hooks call
 * `refreshWidgets` / `scheduleWidgetRefresh` directly, because going into the
 * background is the one moment that must not wait for a debounce — Android
 * may kill the process without any further callback.
 */
export function initWidgetService(): void {
  if (wired || !widgetsAvailable() || typeof window === "undefined") return;
  wired = true;
  // Every cycle that can change the answer without the widget hearing of it.
  for (const event of ["m-index-changed", "m-pim-changed", "m-task-sync-done", "m-settings-changed"]) {
    window.addEventListener(event, scheduleWidgetRefresh);
  }
  // A different vault is a different snapshot, header and all — the old one
  // must not stay on the home screen while the new one is being worked out.
  // `m-vaults-changed` covers REMOVING one (W6): the home screen must not go
  // on showing a vault this phone no longer has.
  for (const event of ["m-vault-switched", "m-vault-changed", "m-vaults-changed"]) {
    window.addEventListener(event, () => {
      void clearWidgets().then(() => refreshWidgets());
    });
  }
  window.addEventListener("m-encryption-locked", () => {
    void clearWidgets();
  });
  // Redeem, THEN write: a tick made while the app was closed names the
  // snapshot on disk, and a fresh one would strand it.
  void catchUpWidgets();
}
