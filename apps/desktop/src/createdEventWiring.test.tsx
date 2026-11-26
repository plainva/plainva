// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IPimTarget, PimAccountRow, PimCalendar, PimEventRow } from "@plainva/core";
import { PendingEventWrites, SETTLED_EVENT_WRITE_TTL_MS, useCreatedEventWatch, useShownEvents, type CreatedEventWatchRuntime, type ShownEventRow } from "@plainva/ui";

/**
 * The desktop settles the events it still draws from the overlay with the
 * vault, in every window (issue 119) - tested on the hook AppShell runs, as it
 * behaves, not as it is spelled.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const CAL = "https://dav.example.org/cal/home/personal/";
const row = { accountId: "a1", calendarId: CAL, uid: "plainva-w1", title: "Team sync", start: { ts: 0 }, end: { ts: 1 }, allDay: false, href: `${CAL}plainva-w1.ics` } as PimEventRow;

function runtime(target: Partial<IPimTarget>): CreatedEventWatchRuntime & { syncTarget: ReturnType<typeof vi.fn> } {
  return {
    cache: {
      findEventsByUid: async () => [],
      listAccounts: async () => [{ id: "a1", provider: "caldav", label: "x", config: {}, enabled: true } as unknown as PimAccountRow],
      listCalendars: async () => [{ accountId: "a1", id: CAL, name: "P", selected: true } as PimCalendar & { accountId: string; selected: boolean }],
    },
    syncTarget: vi.fn(async () => target as IPimTarget),
  };
}

function Watch(props: { vault: string | null; runtime: CreatedEventWatchRuntime | null; store: PendingEventWrites }) {
  useCreatedEventWatch(props.vault, props.runtime, undefined, props.store);
  return null;
}

function render(el: React.ReactElement) {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(el));
}

describe("the desktop watch of created events (issue 119)", () => {
  it("asks the provider through the vault runtime's sync target for the event's account", async () => {
    expect.hasAssertions();
    vi.useFakeTimers({ now: 10 * SETTLED_EVENT_WRITE_TTL_MS });
    const store = new PendingEventWrites();
    store.settle(store.begin({ kind: "create", row }), undefined, 0);
    const eventExists = vi.fn(async () => true);
    const rt = runtime({ provider: "caldav", eventExists });
    render(<Watch vault="v1" runtime={rt} store={store} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(rt.syncTarget).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    expect(eventExists).toHaveBeenCalledWith(expect.objectContaining({ uid: "plainva-w1" }));
  });

  it("keeps the overlay when the runtime is made anew for the same vault, and empties it when the vault is left", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin({ kind: "create", row }), undefined, 0);
    render(<Watch vault="v1" runtime={runtime({})} store={store} />);
    act(() => root!.render(<Watch vault="v1" runtime={runtime({})} store={store} />));
    expect(store.snapshot()).toHaveLength(1);
    act(() => root!.render(<Watch vault="v2" runtime={runtime({})} store={store} />));
    expect(store.snapshot()).toEqual([]);
  });

  it("the views draw a created event only for a calendar they show", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin({ kind: "create", row }), undefined, 0);
    const drawn: ShownEventRow[][] = [];
    function Shown(props: { shown: boolean }) {
      drawn.push(useShownEvents([], store, undefined, () => props.shown));
      return null;
    }
    render(<Shown shown={false} />);
    expect(drawn[drawn.length - 1]).toEqual([]);
    act(() => root!.render(<Shown shown />));
    expect(drawn[drawn.length - 1]!.map((r: ShownEventRow) => r.uid)).toEqual(["plainva-w1"]);
  });

  it("both forms count their tries with the shared helper, and every surface reloads when the overlay changes", () => {
    expect.hasAssertions();
    const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
    const calendarView = read("components/pimcal/CalendarView.tsx");
    expect(calendarView).toContain("const nextTry = formCreateTries(draft);");
    expect(calendarView).toContain("const attempt: PimEventCreate = nextTry();");
    expect(read("../../mobile/src/components/useEventEditor.tsx")).toContain("void createPimEvent(values.calendarKey, nextTry())");
    expect(read("components/CalendarWidget.tsx")).toContain("const offWrites = pendingEventWrites.subscribe(onChanged);");
    expect(read("components/base/BaseCalendarView.tsx")).toMatch(/pendingEventWrites\.subscribe\(\(\) => setWritesTick[\s\S]*\[showEvents, pimRuntime, anchorDate, writesTick\]/);
    expect(read("../../mobile/src/screens/base/BaseScreen.tsx")).toContain("[showEvents, calMonth, pimTick]");
    expect(read("../../mobile/src/screens/TodayScreen.tsx")).toContain("[selectedIso, bump, pimTick, i18nInstance.language]");
  });

  it("AppShell runs the hook with the vault, its runtime and the expansion it loads on demand", () => {
    expect.hasAssertions();
    const appShell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");
    expect(appShell).toContain("useCreatedEventWatch(vaultPath, pimRuntime, loadSeriesExpansion);");
  });
});
