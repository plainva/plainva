// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PimEventRow } from "@plainva/core";
import { pendingEventRow, PendingEventWrites, useShownEvents, writeEventOptimistically, type ShownEventRow } from "@plainva/ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (uid: string) => ({ accountId: "a1", calendarId: "c1", uid, title: uid, start: { ts: 1 }, end: { ts: 2 }, allDay: false }) as unknown as PimEventRow;

/** Mounts the hook the way a calendar view does and hands out what it returned last. */
function mount(store: PendingEventWrites, initial: PimEventRow[]) {
  let shown: ShownEventRow[] = [];
  const Probe = ({ rows }: { rows: PimEventRow[] }) => {
    shown = useShownEvents(rows, store);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  const render = (rows: PimEventRow[]) => act(() => root.render(<Probe rows={rows} />));
  render(initial);
  return { render, shown: () => shown.map((e) => [e.uid, e.pending] as const) };
}

/**
 * What a view draws while a slow provider thinks (issue 119). The E2E mock has
 * no provider that could be slow, so the moment between the save and the
 * answer is held open here, at the hook every calendar view reads its rows
 * through.
 */
describe("the rows a calendar view shows", () => {
  it("has the new event from the save on, marked until the provider answers, and unmarked after", async () => {
    const store = new PendingEventWrites();
    const view = mount(store, [row("old")]);
    expect(view.shown()).toEqual([["old", undefined]]);

    let answer!: (uid: string) => void;
    const provider = new Promise<string>((resolve) => (answer = resolve));
    const id = store.reserve();
    let written!: Promise<string>;
    act(() => {
      written = writeEventOptimistically(store, { kind: "create", row: pendingEventRow(id, row("x")) }, () => provider, (uid) => [{ kind: "create", row: row(uid) }], id);
    });
    expect(view.shown()).toEqual([["old", undefined], [`pending:${id}`, true]]);

    await act(async () => {
      answer("u9");
      await written;
    });
    expect(view.shown()).toEqual([["old", undefined], ["u9", undefined]]);

    // The cycle lands: the cache lists the event, the overlay lets go, one row remains.
    view.render([row("old"), row("u9")]);
    expect(view.shown()).toEqual([["old", undefined], ["u9", undefined]]);
    expect(store.snapshot()).toEqual([]);
  });

  it("gives the view back unchanged when the provider refuses", async () => {
    const store = new PendingEventWrites();
    const view = mount(store, [row("old")]);
    let failing!: Promise<unknown>;
    act(() => {
      failing = writeEventOptimistically(store, { kind: "delete", ref: row("old") }, () => Promise.reject(new Error("offline"))).catch(() => undefined);
    });
    expect(view.shown()).toEqual([]);
    await act(async () => {
      await failing;
    });
    expect(view.shown()).toEqual([["old", undefined]]);
  });
});
