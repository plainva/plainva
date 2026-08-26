import { describe, expect, it, vi } from "vitest";
import {
  barDef,
  barLayoutKey,
  moveArea,
  sanitizeAreaOrder,
  setVisibleCount,
  visibleAreas,
  type ISettingsStore,
} from "@plainva/ui";
import { TAB_POOL } from "./navigation";
import { mobileBarTabs, mobileRailTabs, shownBarTabs } from "./services/mobileBar";

/**
 * The phone's navigation bar is the shared bar model's fifth bar (S10). These
 * tests moved here from `navigation.test.ts` together with the thing they
 * describe: the claims are the same, the owner is not.
 *
 * The point of the move is that the phone no longer has bar RULES of its own.
 * It had a second sanitizer, its own bounds and its own reorder helper, and
 * that is why the bar could not be arranged from the desktop and did not
 * travel in the settings profile.
 */

const spec = barDef("mobileBar").spec;

/** A settings store that lives in a Map — enough for the migration. */
function fakeStore(seed: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(seed));
  const store: ISettingsStore = {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => Promise.resolve(data.delete(key)),
    keys: () => Promise.resolve([...data.keys()]),
    save: () => Promise.resolve(),
  };
  return { store, data };
}

describe("the phone's bar is the shared model's fifth bar", () => {
  it("carries exactly the areas the shell can render", () => {
    // Two lists for one pool is how a bar entry ends up with no screen behind
    // it. They are pinned against each other rather than merged, because the
    // shared model must not import the shell's icons.
    expect([...spec.known].sort()).toEqual([...TAB_POOL.map((t) => t.id)].sort());
  });

  it("keeps the comment overview reachable although the bar is full", () => {
    // D9: the phone shows four areas at a time, so a seventh one necessarily
    // starts outside the bar - and that is the normal state here, not the
    // desktop's "invisible at the end of the ribbon". Being in the pool is what
    // makes it reachable, because the areas sheet lists the pool, not the bar.
    expect(TAB_POOL.map((t) => t.id)).toContain("comments");
    const fresh = sanitizeAreaOrder(undefined, spec);
    expect(fresh.order).toContain("comments");
    expect(visibleAreas(fresh)).not.toContain("comments");
  });

  it("keeps Material's bounds and pins the one area that must stay", () => {
    // 3–5 destinations, and the fixed "Areas" entry is one of them — so the
    // configurable part is 2–4.
    expect(spec.minVisible).toBe(2);
    expect(spec.maxVisible).toBe(4);
    expect(spec.alwaysVisible).toEqual(["notes"]);
    // Hiding the navigator would leave the phone without a way to its files.
    const hidden = setVisibleCount(sanitizeAreaOrder(undefined, spec), 1, spec);
    expect(visibleAreas(hidden)).toContain("notes");
  });

  it("shows four areas by default — the mockup's picture", () => {
    expect(visibleAreas(sanitizeAreaOrder(undefined, spec))).toEqual(["notes", "today", "tasks", "calendar"]);
  });

  it("moves an area into and out of the bar by position, as the drag handle does", () => {
    const value = sanitizeAreaOrder(undefined, spec);
    const up = moveArea(value, "graph", 0, spec);
    expect(visibleAreas(up)).toContain("graph");
    const down = moveArea(value, "calendar", spec.known.length - 1, spec);
    expect(visibleAreas(down)).not.toContain("calendar");
  });

  it("drops an area that no longer exists instead of leaving a dead slot", () => {
    // Tags, bookmarks and databases became navigator sections in S9.
    const out = sanitizeAreaOrder({ order: ["tags", "notes", "bookmarks", "today"], visibleCount: 4 }, spec);
    expect(out.order).not.toContain("tags");
    expect(out.order.slice(0, 2)).toEqual(["notes", "today"]);
    expect([...out.order].sort()).toEqual([...spec.known].sort());
  });
});

describe("migrating the phone's own two settings into the model", () => {
  async function migrate(seed: Record<string, unknown>, settings: { tabSlots?: unknown; barTabCount?: unknown }) {
    const { store, data } = fakeStore(seed);
    // A fresh module graph per case, so the settings mock applies. The platform
    // registry has to be filled INSIDE that graph — the copy this file holds is
    // a different module instance and the migration would never see it.
    vi.resetModules();
    vi.doMock("./services/mobileSettings", () => ({
      getMobileSettings: () => settings,
      updateMobileSettings: () => Promise.resolve(),
    }));
    const ui = await import("@plainva/ui");
    ui.setPlatformServices({
      loadSettings: () => Promise.resolve(store),
      credentials: { readSecret: () => Promise.resolve(null), writeSecret: () => Promise.resolve(), removeSecret: () => Promise.resolve() },
      openExternal: () => Promise.resolve(),
    });
    const { migrateMobileBarLayout } = await import("./services/mobileBar");
    await migrateMobileBarLayout("v1");
    return data.get(barLayoutKey("mobileBar", "v1")) as { order: string[]; visibleCount: number } | undefined;
  }

  it("keeps the surviving areas in their relative order", async () => {
    // Notes leads because the model pins it — that is the one rearrangement the
    // migration accepts, and it is the same rule that keeps the navigator from
    // being hidden.
    const out = await migrate({}, { tabSlots: ["today", "notes", "calendar", "mail"], barTabCount: 4 });
    expect(out?.order.slice(0, 4)).toEqual(["notes", "today", "calendar", "mail"]);
  });

  it("counts what survived inside the old run, not the run itself", async () => {
    // Two of the four visible areas are gone. Counting the run would leave the
    // bar longer than the user ever saw; counting the survivors keeps it.
    const out = await migrate({}, { tabSlots: ["notes", "tags", "bookmarks", "today", "mail"], barTabCount: 4 });
    expect(out?.visibleCount).toBe(2);
    expect(visibleAreas(sanitizeAreaOrder(out, spec))).toEqual(["notes", "today"]);
  });

  it("never overwrites an arrangement the vault already has", async () => {
    const existing = { order: ["mail", "notes", "today", "tasks", "calendar", "graph"], visibleCount: 3 };
    const out = await migrate({ [barLayoutKey("mobileBar", "v1")]: existing }, { tabSlots: ["notes"], barTabCount: 2 });
    expect(out).toEqual(existing);
  });
});

describe("what each bar SHAPE shows", () => {
  /**
   * The 3–5 bound is a thumb's budget on a phone bar, not a property of the
   * arrangement. The rail inherited it because one list fed both shapes, and a
   * tablet ended up showing three destinations beside an empty column.
   */
  it("gives the rail the whole pool and the phone bar its visible slots", () => {
    const value = sanitizeAreaOrder(undefined, spec);
    const rail = mobileRailTabs(value);
    const phone = mobileBarTabs(value);

    expect(rail).toEqual(value.order);
    expect(rail).toHaveLength(TAB_POOL.length);
    expect(phone).toHaveLength(value.visibleCount);
    expect(phone.length).toBeLessThan(rail.length);
    // Same arrangement, one shape just stops early: the rail must not reorder.
    expect(rail.slice(0, phone.length)).toEqual(phone);

    // And the rule the shell actually asks, so a caller cannot pick the wrong
    // half: one question, answered by the shape it is given.
    expect(shownBarTabs(value, true)).toEqual(rail);
    expect(shownBarTabs(value, false)).toEqual(phone);
  });

  it("keeps the arrangement when an area is moved", () => {
    const value = moveArea(sanitizeAreaOrder(undefined, spec), "graph", 1, spec);
    expect(mobileRailTabs(value)).toEqual(value.order);
    expect(mobileRailTabs(value)[1]).toBe("graph");
  });

  it("hands back a copy — a caller cannot rearrange the stored order", () => {
    const value = sanitizeAreaOrder(undefined, spec);
    mobileRailTabs(value).reverse();
    expect(mobileRailTabs(value)).toEqual(value.order);
  });
});
