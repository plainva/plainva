// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { forgetTaskViewState, parseTaskViewState, taskViewStateKey, taskViewStore, useTaskViewState } from "../../../../packages/ui/src/lib/taskViewState";

const full = { version: 1, status: "all", text: "Find", folder: "Gone", tag: "missing", dueOnly: true, showHidden: true };
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); vi.useRealTimers(); localStorage.clear(); });
function Harness({ vault }: { vault: string }) {
  const value = useTaskViewState(vault);
  return <><output>{JSON.stringify({ status: value.status, text: value.text, folder: value.folder, tag: value.tag, dueOnly: value.dueOnly, showHidden: value.showHidden })}</output>
    <button onClick={() => value.setText("Changed")}>change</button><button onClick={value.resetFilters}>reset</button></>;
}
async function mount(vault: string) {
  if (!root) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(<Harness vault={vault} />));
}
describe("device-local task filters", () => {
  it("reads before first render and survives remount, restart and vault switches without writing defaults", async () => {
    localStorage.setItem(taskViewStateKey("initial"), JSON.stringify(full));
    const writes = vi.spyOn(Storage.prototype, "setItem");
    await mount("initial"); expect(host!.textContent).toContain('"folder":"Gone"'); expect(writes).not.toHaveBeenCalled();
    await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
    await mount("other"); expect(host!.textContent).toContain('"text":""');
    expect(JSON.parse(localStorage.getItem(taskViewStateKey("initial"))!).text).toBe("Changed");
    await mount("initial"); expect(host!.textContent).toContain('"text":"Changed"');
    const snapshot = localStorage.getItem(taskViewStateKey("initial"))!;
    // A fresh storage adapter stands for a new JS process, with no live cache.
    expect(taskViewStore("initial", { getItem: () => snapshot, setItem() {}, removeItem() {} }).snapshot().folder).toBe("Gone");
    writes.mockRestore();
  });
  it("batches writes, flushes background changes, resets and forgets pending data", async () => {
    vi.useFakeTimers(); await mount("flush");
    await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
    expect(localStorage.getItem(taskViewStateKey("flush"))).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem(taskViewStateKey("flush"))!).text).toBe("Changed");
    await act(async () => host!.querySelectorAll<HTMLButtonElement>("button")[1].click());
    await act(async () => vi.advanceTimersByTime(250));
    expect(JSON.parse(localStorage.getItem(taskViewStateKey("flush"))!).status).toBe("open");
    await act(async () => { taskViewStore("flush").set("tag", "private"); forgetTaskViewState("flush"); });
    await act(async () => vi.runAllTimers());
    expect(localStorage.getItem(taskViewStateKey("flush"))).toBeNull();
  });
  it("shares in-window instances and accepts the last other-window write without echoing it", () => {
    const first = taskViewStore("windows"), second = taskViewStore("windows");
    expect(first).toBe(second); first.set("folder", "First"); second.set("folder", "Second"); first.flush();
    expect(first.snapshot().folder).toBe("Second");
    second.receive(JSON.stringify(full)); expect(first.snapshot().folder).toBe("Gone");
    first.flush(); expect(JSON.parse(localStorage.getItem(taskViewStateKey("windows"))!).folder).toBe("Second");
    forgetTaskViewState("windows");
  });
  it("rejects unknown versions and malformed values; never accepts the task database as a filter", () => {
    for (const raw of ["broken", "[]", '{"version":0,"text":"old"}', '{"version":2,"text":"future"}']) expect(parseTaskViewState(raw).text).toBe("");
    expect(parseTaskViewState('{"version":1,"status":"bad","text":false,"folder":[],"dueOnly":"yes","list":"someday","taskDatabase":"Tasks.base"}'))
      .toEqual({ status: "open", text: "", folder: "", tag: "", dueOnly: false, showHidden: false, list: "today" });
  });

  it("remembers the planner list, and resetting the filters leaves it alone", () => {
    expect(parseTaskViewState('{"version":1,"list":"inbox"}').list).toBe("inbox");
    const store = taskViewStore("planner-list");
    store.set("list", "upcoming");
    store.set("text", "steuer");
    store.reset();
    expect(store.snapshot()).toMatchObject({ list: "upcoming", text: "" });
    forgetTaskViewState("planner-list");
  });
});
