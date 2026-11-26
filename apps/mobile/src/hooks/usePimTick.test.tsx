// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PendingEventWrites } from "@plainva/ui";
import { usePimTick } from "./usePimTick";
import { announceStoreChanges, onPimChanged, PIM_CHANGED } from "../services/pim/pimChanged";

/**
 * The phone's calendar screens reload when a sync or a write on its way
 * changes what they show (issue 119, R50-R52): the writes on their way are
 * announced as `m-pim-changed`, and the tick the screens' loading effects
 * depend on moves with every one of them.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function Probe({ seen }: { seen: number[] }) {
  const tick = usePimTick();
  seen.push(tick);
  return null;
}

describe("the phone reloads its appointments on a change (issue 119)", () => {
  it("the tick moves on every m-pim-changed, and stops with the screen", () => {
    expect.hasAssertions();
    const seen: number[] = [];
    const host = document.createElement("div");
    root = createRoot(host);
    act(() => root!.render(<Probe seen={seen} />));
    act(() => void window.dispatchEvent(new CustomEvent(PIM_CHANGED)));
    act(() => void window.dispatchEvent(new CustomEvent(PIM_CHANGED)));
    expect(seen[seen.length - 1]).toBe(2);
    act(() => root!.unmount());
    root = null;
    const after = seen.length;
    window.dispatchEvent(new CustomEvent(PIM_CHANGED));
    expect(seen.length).toBe(after);
  });

  it("a listener that stopped hears nothing more", () => {
    expect.hasAssertions();
    const target = new EventTarget();
    let heard = 0;
    const stop = onPimChanged(target, () => (heard += 1));
    target.dispatchEvent(new CustomEvent(PIM_CHANGED));
    stop();
    target.dispatchEvent(new CustomEvent(PIM_CHANGED));
    expect(heard).toBe(1);
  });

  it("a write on its way, settled or refused, is announced as a change", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    const target = new EventTarget();
    let heard = 0;
    const stopHearing = onPimChanged(target, () => (heard += 1));
    const stop = announceStoreChanges(store, target);
    const ref = { accountId: "a1", calendarId: "personal", uid: "ev-1" };
    const id = store.begin({ kind: "delete", ref });
    expect(heard).toBe(1);
    store.drop(id);
    expect(heard).toBe(2);
    stop();
    stopHearing();
    store.begin({ kind: "delete", ref });
    expect(heard).toBe(2);
  });

  it("both screens load their appointments with the tick, and the runtime announces the writes on their way", () => {
    expect.hasAssertions();
    const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
    expect(read("screens/TodayScreen.tsx")).toContain("const pimTick = usePimTick();");
    expect(read("screens/TodayScreen.tsx")).toContain("[selectedIso, bump, pimTick, i18nInstance.language]");
    expect(read("screens/base/BaseScreen.tsx")).toContain("const pimTick = usePimTick();");
    expect(read("screens/base/BaseScreen.tsx")).toContain("[showEvents, calMonth, pimTick]");
    expect(read("services/pim/pimService.ts")).toContain("announceStoreChanges(pendingEventWrites, window);");
  });
});
