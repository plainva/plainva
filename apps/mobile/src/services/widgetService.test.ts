// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWidgetSnapshot, type WidgetSnapshot } from "@plainva/ui";

/**
 * When the home screen is written to, and what reaches it (plan Widgets, W2).
 *
 * What TRAVELS is `widgetSnapshot.ts` and has its own table tests; what this
 * file decides is the other half: a sealed vault writes an empty snapshot
 * rather than a hidden one, the two device switches are honoured, appointments
 * arrive on the local clock, a burst of triggers writes once — and the paths a
 * tap needs stay OUT of the widget's file and in the app's own storage.
 */

const written: string[] = [];
let cleared = 0;
let native = true;
let queue: { id: number; index: number; snapshotAt: number; at: number }[] = [];
const clearedIds: number[] = [];

vi.mock("../platform/widgetBridge", () => ({
  widgetsAvailable: () => native,
  writeWidgetSnapshot: vi.fn(async (json: string) => void written.push(json)),
  clearWidgetSnapshot: vi.fn(async () => void (cleared += 1)),
  readWidgetSnapshot: vi.fn(async () => written[written.length - 1] ?? null),
  readWidgetActions: vi.fn(async () => queue),
  clearWidgetActions: vi.fn(async (ids: number[]) => void clearedIds.push(...ids)),
  reloadWidgets: vi.fn(async () => {}),
}));

const ticked: { path: string; done: boolean }[] = [];
let tickResult: { changed: boolean } | Error = { changed: true };
vi.mock("./taskCompletionAction", () => ({
  setTaskDone: vi.fn(async (path: string, done: boolean) => {
    ticked.push({ path, done });
    if (tickResult instanceof Error) throw tickResult;
    return tickResult;
  }),
}));

const toasts: string[] = [];

const prefs = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value)),
    get: vi.fn(async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null })),
  },
}));

let settings = { taskDatabase: "Tasks.base", widgetShowTitles: true, widgetShowEvents: true };
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => settings }));

let phase: string | null = null;
let runtime: unknown = {};
vi.mock("./mobileWorkspaceSecurity", () => ({
  getMobileWorkspaceStatus: vi.fn(async () => (phase ? { phase } : null)),
  loadMobileWorkspaceRuntime: vi.fn(async () => runtime),
}));

let events: { title: string; allDay: boolean; start: { ts: number; date?: string } }[] = [];
vi.mock("./pim/pimService", () => ({ listPimEvents: vi.fn(async () => events) }));

vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: vi.fn(async () => ({ id: "v1", name: "Notizen" })) }));
vi.mock("./vaultService", () => ({
  getMobileVault: vi.fn(async () => ({ queryService: { queryDatabaseFiles: vi.fn(async () => []) } })),
  vaultOps: { read: vi.fn(async () => "") },
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));

let tasks: unknown[] = [];
vi.mock("@plainva/ui", async (original) => ({
  // The database helpers have their own tests; here the rows are the fixture.
  ...(await original<Record<string, unknown>>()),
  parseBaseConfig: vi.fn(() => ({})),
  resolveTaskCompletionModel: vi.fn(() => ({})),
  taskDbRows: vi.fn(() => []),
  plannerRowsFromDb: vi.fn(() => tasks),
  toast: { info: (message: string) => void toasts.push(message) },
}));

import { catchUpWidgets, clearWidgets, consumeWidgetOpen, readWidgetRefs, redeemWidgetActions, refreshWidgets, routeWidgetOpen, scheduleWidgetRefresh } from "./widgetService";

const NOW = new Date(2026, 8, 23, 10, 0); // 2026-09-23, local

function task(over: Record<string, unknown>) {
  return { id: "t", source: "database", path: "Aufgaben/Miete.md", title: "Eine Aufgabe", state: "open", due: null, dueMinutes: null, priority: 0, tags: [], ...over };
}

const last = (): WidgetSnapshot => parseWidgetSnapshot(written[written.length - 1])!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  written.length = 0;
  prefs.clear();
  cleared = 0;
  native = true;
  phase = null;
  runtime = {};
  tasks = [];
  events = [];
  queue = [];
  clearedIds.length = 0;
  ticked.length = 0;
  toasts.length = 0;
  tickResult = { changed: true };
  settings = { taskDatabase: "Tasks.base", widgetShowTitles: true, widgetShowEvents: true };
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("what reaches the home screen", () => {
  it("carries the vault's name, its due tasks and its appointments", async () => {
    tasks = [task({ title: "Miete überweisen", due: "2026-09-23" })];
    events = [{ title: "Zahnarzt", allDay: false, start: { ts: new Date(2026, 8, 23, 9, 30).getTime() } }];

    await refreshWidgets();

    const snapshot = last();
    expect(snapshot.vaultName).toBe("Notizen");
    expect(snapshot.rows.map((r) => [r.kind, r.title, r.day, r.minutes])).toEqual([
      ["event", "Zahnarzt", "2026-09-23", 570], // 9:30 on the local clock
      ["task", "Miete überweisen", "2026-09-23", null],
    ]);
  });

  it("keeps an all-day appointment on its civil date, never shifted by a timezone", async () => {
    events = [{ title: "Urlaub", allDay: true, start: { ts: Date.UTC(2026, 8, 24), date: "2026-09-24" } }];
    await refreshWidgets();
    expect(last().rows[0]).toMatchObject({ day: "2026-09-24", minutes: null });
  });

  it("writes an EMPTY snapshot for a sealed vault, not a hidden one", async () => {
    tasks = [task({ title: "Geheim", due: "2026-09-23" })];
    phase = "locked";

    await refreshWidgets();

    expect(last().locked).toBe(true);
    expect(last().rows).toEqual([]);
    // A file that never held the title cannot leak it.
    expect(written[0]).not.toContain("Geheim");
  });

  it("treats an active workspace whose key is not in memory as locked", async () => {
    phase = "active";
    runtime = null;
    await refreshWidgets();
    expect(last().locked).toBe(true);
  });

  it("answers an unanswerable lock question with the lock", async () => {
    const security = await import("./mobileWorkspaceSecurity");
    vi.mocked(security.getMobileWorkspaceStatus).mockRejectedValueOnce(new Error("no"));
    await refreshWidgets();
    expect(last().locked).toBe(true);
  });
});

describe("where a tapped row leads", () => {
  it("keeps the paths out of the widget's file and in the app's own storage", async () => {
    tasks = [task({ title: "Miete überweisen", due: "2026-09-23", path: "Aufgaben/Miete.md" })];
    events = [{ title: "Zahnarzt", allDay: false, start: { ts: new Date(2026, 8, 23, 9, 30).getTime() } }];

    await refreshWidgets();

    expect(written[0]).not.toContain("Aufgaben/Miete.md");
    const table = (await readWidgetRefs())!;
    expect(table.writtenAt).toBe(last().writtenAt);
    // Same order and same length as the rows: the appointment resolves to
    // nothing, the task to its note.
    expect(table.refs).toEqual([null, { path: "Aufgaben/Miete.md" }]);
  });

  it("stamps the table with the snapshot it belongs to, so a stale index resolves to nothing", async () => {
    tasks = [task({ due: "2026-09-23" })];
    await refreshWidgets();
    const first = (await readWidgetRefs())!.writtenAt;

    vi.setSystemTime(new Date(2026, 8, 23, 11, 0));
    await refreshWidgets();

    expect((await readWidgetRefs())!.writtenAt).not.toBe(first);
  });

  it("empties the table when the vault is cleared", async () => {
    tasks = [task({ due: "2026-09-23" })];
    await refreshWidgets();
    await clearWidgets();
    expect(await readWidgetRefs()).toEqual({ writtenAt: 0, refs: [] });
  });
});

describe("a tapped row finds its note", () => {
  const shortcuts: string[] = [];
  const onShortcut = (event: Event) => void shortcuts.push((event as CustomEvent<{ which: string }>).detail.which);

  beforeEach(() => {
    shortcuts.length = 0;
    window.addEventListener("m-shortcut", onShortcut);
  });
  afterEach(() => window.removeEventListener("m-shortcut", onShortcut));

  async function place() {
    tasks = [task({ title: "Miete", due: "2026-09-23", path: "Aufgaben/Miete.md" })];
    await refreshWidgets();
    return (await readWidgetRefs())!.writtenAt;
  }

  it("parks the note the position points at", async () => {
    const at = await place();
    await routeWidgetOpen(`com.plainva.app://widget/open/0?at=${at}`);
    expect(consumeWidgetOpen()).toEqual({ path: "Aufgaben/Miete.md" });
    // Taken once: a second drain must not reopen it on the next start.
    expect(consumeWidgetOpen()).toBeNull();
  });

  it("opens the day instead of guessing when the snapshot has moved on", async () => {
    const at = await place();
    await routeWidgetOpen(`com.plainva.app://widget/open/0?at=${at - 1}`);
    expect(consumeWidgetOpen()).toBeNull();
    expect(shortcuts).toEqual(["today"]);
  });

  it("opens the day for a position that names no row", async () => {
    const at = await place();
    await routeWidgetOpen(`com.plainva.app://widget/open/99?at=${at}`);
    expect(consumeWidgetOpen()).toBeNull();
    expect(shortcuts).toEqual(["today"]);
  });

  it("opens the day when the row was an appointment", async () => {
    tasks = [];
    events = [{ title: "Zahnarzt", allDay: false, start: { ts: new Date(2026, 8, 23, 9, 30).getTime() } }];
    await refreshWidgets();
    const at = (await readWidgetRefs())!.writtenAt;
    await routeWidgetOpen(`com.plainva.app://widget/open/0?at=${at}`);
    expect(consumeWidgetOpen()).toBeNull();
    expect(shortcuts).toEqual(["today"]);
  });

  it("opens the day when there is no table at all", async () => {
    await routeWidgetOpen("com.plainva.app://widget/open/0?at=1");
    expect(shortcuts).toEqual(["today"]);
  });
});

describe("the two device switches", () => {
  it("drops every title when titles are off, and keeps the rows for the counter", async () => {
    tasks = [task({ title: "Arzttermin vorbereiten", due: "2026-09-23" })];
    settings.widgetShowTitles = false;

    await refreshWidgets();

    expect(last().rows).toHaveLength(1);
    expect(last().rows[0].title).toBe("");
    expect(written[0]).not.toContain("Arzttermin");
  });

  it("does not even ask the calendar when appointments are off", async () => {
    const pim = await import("./pim/pimService");
    settings.widgetShowEvents = false;
    await refreshWidgets();
    expect(pim.listPimEvents).not.toHaveBeenCalled();
  });

  it("does not read the task database of a sealed vault at all", async () => {
    const vault = await import("./vaultService");
    phase = "locked";
    await refreshWidgets();
    expect(vault.getMobileVault).not.toHaveBeenCalled();
  });
});

describe("a tick made on the home screen", () => {
  async function place(...rows: Record<string, unknown>[]) {
    tasks = rows.map(task);
    await refreshWidgets();
    return last().writtenAt;
  }

  it("goes through the same building block the checkbox in the app uses", async () => {
    const at = await place({ title: "Miete", due: "2026-09-23", path: "Aufgaben/Miete.md" });
    queue = [{ id: 7, index: 0, snapshotAt: at, at }];

    expect(await redeemWidgetActions()).toBe(1);

    expect(ticked).toEqual([{ path: "Aufgaben/Miete.md", done: true }]);
    expect(toasts).toEqual(["widget.redeemed"]);
  });

  it("clears every order it looked at, applied or not", async () => {
    const at = await place({ title: "Miete", due: "2026-09-23", path: "Aufgaben/Miete.md" });
    queue = [
      { id: 1, index: 0, snapshotAt: at, at },
      // Made against a snapshot that is already history: it can never resolve,
      // so leaving it would grow the queue for the life of the install.
      { id: 2, index: 0, snapshotAt: at - 1, at },
    ];

    await redeemWidgetActions();

    expect(ticked).toHaveLength(1);
    expect(clearedIds.sort()).toEqual([1, 2]);
  });

  it("lets a task that has gone fall out silently", async () => {
    const at = await place({ title: "Weg", due: "2026-09-23", path: "Aufgaben/Weg.md" });
    queue = [{ id: 1, index: 0, snapshotAt: at, at }];
    tickResult = new Error("ENOENT");

    expect(await redeemWidgetActions()).toBe(0);

    expect(toasts).toEqual([]);
    expect(clearedIds).toEqual([1]);
  });

  it("says nothing when the task was already done", async () => {
    const at = await place({ title: "Schon", due: "2026-09-23", path: "Aufgaben/Schon.md" });
    queue = [{ id: 1, index: 0, snapshotAt: at, at }];
    tickResult = { changed: false };

    expect(await redeemWidgetActions()).toBe(0);
    expect(toasts).toEqual([]);
  });

  it("counts a row tapped twice as one tick", async () => {
    const at = await place({ title: "Miete", due: "2026-09-23", path: "Aufgaben/Miete.md" });
    queue = [
      { id: 1, index: 0, snapshotAt: at, at },
      { id: 2, index: 0, snapshotAt: at, at: at + 5 },
    ];

    await redeemWidgetActions();

    expect(ticked).toHaveLength(1);
    expect(clearedIds.sort()).toEqual([1, 2]);
  });

  it("never ticks off an appointment", async () => {
    tasks = [];
    events = [{ title: "Zahnarzt", allDay: false, start: { ts: new Date(2026, 8, 23, 9, 30).getTime() } }];
    await refreshWidgets();
    const at = last().writtenAt;
    queue = [{ id: 1, index: 0, snapshotAt: at, at }];

    await redeemWidgetActions();

    expect(ticked).toEqual([]);
  });

  it("REDEEMS BEFORE IT WRITES, or every waiting tick would be stranded", async () => {
    // The order is the whole of W5. A fresh snapshot carries a new writtenAt,
    // and an order names the snapshot it was made against - write first and
    // the tap made while the app was closed is dropped as stale.
    const at = await place({ title: "Miete", due: "2026-09-23", path: "Aufgaben/Miete.md" });
    queue = [{ id: 1, index: 0, snapshotAt: at, at }];
    vi.setSystemTime(new Date(2026, 8, 23, 11, 0));

    await catchUpWidgets();

    expect(ticked).toEqual([{ path: "Aufgaben/Miete.md", done: true }]);
    // ...and the widget is left showing the new state, not the old one.
    expect(written).toHaveLength(2);
    expect(last().writtenAt).toBeGreaterThan(at);
  });

  it("asks the queue nothing where there is no home screen", async () => {
    const bridge = await import("../platform/widgetBridge");
    native = false;
    expect(await redeemWidgetActions()).toBe(0);
    expect(bridge.readWidgetActions).not.toHaveBeenCalled();
  });
});

describe("when it is written", () => {
  it("coalesces a burst of triggers into one write", async () => {
    scheduleWidgetRefresh();
    scheduleWidgetRefresh();
    scheduleWidgetRefresh();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toHaveLength(1);
  });

  it("does not write a second snapshot on top of a run in flight", async () => {
    // Two snapshots back to back differ only in `writtenAt` — and every tick
    // made against the first would become unresolvable.
    const first = refreshWidgets();
    const second = refreshWidgets();
    await Promise.all([first, second]);
    expect(written).toHaveLength(2); // the in-flight one, then exactly one repeat
  });

  it("drops a scheduled write when the vault is cleared in between", async () => {
    scheduleWidgetRefresh();
    await clearWidgets();
    await vi.advanceTimersByTimeAsync(500);
    expect(cleared).toBe(1);
    expect(written).toEqual([]);
  });

  it("writes nothing at all where there is no home screen", async () => {
    native = false;
    await refreshWidgets();
    scheduleWidgetRefresh();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toEqual([]);
  });
});
