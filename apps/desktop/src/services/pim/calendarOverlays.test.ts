import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("../settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(k: string) => store.get(k) as T | undefined,
    set: async (k: string, v: unknown) => void store.set(k, v),
    save: async () => {},
  }),
}));

import { PROFILE_FIELDS } from "@plainva/ui";
import { loadCalendarOverlays, saveCalendarOverlays } from "./calendarOverlays";

/**
 * Where the calendar's database selection lives (S18, plan P9a): in the VAULT's
 * settings, so both machines show the same calendar.
 */

beforeEach(() => {
  store.clear();
});

describe("calendar overlays", () => {
  it("round-trips the selection per vault", async () => {
    await saveCalendarOverlays("/v1", ["Projects.base#Milestones"]);
    expect(await loadCalendarOverlays("/v1")).toEqual(["Projects.base#Milestones"]);
    // A second vault has its own calendar.
    expect(await loadCalendarOverlays("/v2")).toEqual([]);
  });

  it("survives a garbled value instead of breaking the calendar", async () => {
    await saveCalendarOverlays("/v1", ["a#b"]);
    store.set([...store.keys()][0]!, { nope: true });
    expect(await loadCalendarOverlays("/v1")).toEqual([]);
  });

  it("drops non-string members rather than passing them on", async () => {
    await saveCalendarOverlays("/v1", ["a#b"]);
    store.set([...store.keys()][0]!, ["a#b", 42, null]);
    expect(await loadCalendarOverlays("/v1")).toEqual(["a#b"]);
  });

  it("is part of the shared settings catalog, scoped to the vault", () => {
    // The claim the step rests on: without this entry the selection would stay
    // on one machine and the phone would show a different calendar.
    const field = PROFILE_FIELDS.find((f) => f.logical === "calendarOverlays");
    expect(field).toBeDefined();
    expect(field?.scope).toBe("vault");
    expect(field?.desktop).toBe("store");
  });
});
