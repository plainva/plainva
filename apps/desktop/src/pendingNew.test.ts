// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumePendingNew, requestNew, takePendingNew } from "@plainva/ui";

/**
 * A "New …" request that travels to its surface (Design-Runde E4) is taken
 * only once the surface can serve it (plan Befunde 2026-09-24, E28). The
 * surface a request opens mounts with the request already waiting; taking it
 * before its data had arrived is how "New task" from the phone's ＋ menu on
 * another tab opened the tasks tab without the capture sheet, and "New event"
 * answered "no writable calendar" although there were some.
 */

afterEach(() => {
  takePendingNew("task");
  takePendingNew("event");
});

describe("consumePendingNew", () => {
  it("serves a request that was parked before the surface subscribed", () => {
    requestNew("task", "Order the spare part");
    const handle = vi.fn();
    const stop = consumePendingNew("task", handle);
    expect(handle).toHaveBeenCalledWith("Order the spare part");
    expect(takePendingNew("task")).toBe(false);
    stop();
  });

  it("leaves the request parked while the surface is not ready, and serves it once it is", () => {
    requestNew("event");
    const handle = vi.fn();
    // The effect runs while the calendars are still loading…
    const early = consumePendingNew("event", handle, false);
    expect(handle).not.toHaveBeenCalled();
    // …a request that arrives meanwhile waits as well…
    requestNew("event");
    expect(handle).not.toHaveBeenCalled();
    early();
    // …and the next run of the effect, with the data there, takes it.
    const ready = consumePendingNew("event", handle, true);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(takePendingNew("event")).toBe(false);
    ready();
  });

  it("serves a request made while the surface is open, once", () => {
    const handle = vi.fn();
    const stop = consumePendingNew("task", handle);
    expect(handle).not.toHaveBeenCalled();
    requestNew("task");
    expect(handle).toHaveBeenCalledTimes(1);
    stop();
    requestNew("task");
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
