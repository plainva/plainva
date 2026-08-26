// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Storage of the bar arrangements (plan § 3). The point of these tests is the
 * INHERITANCE: a vault without its own value follows the global default, so
 * changing the default reaches every vault that was never adapted. Only a
 * deliberate change writes a vault value — and "reset" deletes it again.
 */

let storeValues: Record<string, unknown> = {};
const setSpy = vi.fn(async (key: string, value: unknown) => {
  storeValues[key] = value;
});
const deleteSpy = vi.fn(async (key: string) => {
  delete storeValues[key];
});
import {
  loadBarLayout,
  saveBarLayout,
  resetBarLayout,
  saveBarLayoutAsDefault,
  barLayoutIsInherited,
  loadAllBarLayouts,
  barLayoutKey,
  barLayoutDefaultKey,
  barDef,
  migrateLegacyBarLayouts,
  BAR_DEFS,
  BAR_LAYOUT_CHANGED_EVENT,
  setPlatformServices,
} from "@plainva/ui";
import { isAreaVisible, visibleAreas } from "@plainva/ui";

const VAULT = "C:/vaults/wiki";

beforeEach(() => {
  storeValues = {};
  setSpy.mockClear();
  deleteSpy.mockClear();
  // The module reaches its store through the platform registry (S10) — the
  // same seam both shells use, rather than a mock of the desktop's plugin.
  setPlatformServices({
    loadSettings: () =>
      Promise.resolve({
        get: <T,>(key: string) => Promise.resolve(storeValues[key] as T | undefined),
        set: setSpy,
        delete: async (key: string) => {
          await deleteSpy(key);
          return true;
        },
        keys: () => Promise.resolve(Object.keys(storeValues)),
        save: () => Promise.resolve(),
      }),
    credentials: {
      readSecret: () => Promise.resolve(null),
      writeSecret: () => Promise.resolve(),
      removeSecret: () => Promise.resolve(),
    },
    openExternal: () => Promise.resolve(),
  });
});

describe("bar definitions", () => {
  it("covers every bar and pins the files tab", () => {
    // The phone's bar joined the model in S10 — one place decides how a bar
    // behaves, which is what let the desktop settings page pick it up without
    // knowing about it.
    expect(BAR_DEFS.map((d) => d.id)).toEqual(["ribbon", "leftTabs", "leftSections", "rightSections", "mobileBar"]);
    expect(barDef("leftTabs").spec.alwaysVisible).toEqual(["files"]);
  });

  it("gives every area a label key", () => {
    for (const def of BAR_DEFS) {
      expect(def.areas.map((a) => a.id).sort()).toEqual([...def.spec.known].sort());
      for (const area of def.areas) expect(area.labelKey).toMatch(/\w+\.\w+/);
    }
  });

  it("keeps the rail's bottom group out of the model (E3)", () => {
    const ids = barDef("ribbon").spec.known;
    expect(ids).not.toContain("help");
    expect(ids).not.toContain("settings");
  });
});

describe("inheritance", () => {
  it("uses the factory order when nothing is stored", async () => {
    const v = await loadBarLayout("rightSections", VAULT);
    expect(v.order[0]).toBe("calendar");
    expect(v.visibleCount).toBe(6);
  });

  it("follows the global default while the vault has nothing of its own", async () => {
    storeValues[barLayoutDefaultKey("rightSections")] = {
      order: ["properties", "calendar", "outline", "graph", "databases", "backlinks"],
      visibleCount: 2,
    };
    const v = await loadBarLayout("rightSections", VAULT);
    expect(v.order[0]).toBe("properties");
    expect(visibleAreas(v)).toEqual(["properties", "calendar"]);
    expect(await barLayoutIsInherited("rightSections", VAULT)).toBe(true);
  });

  it("lets the vault value win once it exists", async () => {
    storeValues[barLayoutDefaultKey("rightSections")] = { order: ["properties"], visibleCount: 1 };
    storeValues[barLayoutKey("rightSections", VAULT)] = { order: ["backlinks"], visibleCount: 1 };
    const v = await loadBarLayout("rightSections", VAULT);
    expect(v.order[0]).toBe("backlinks");
    expect(await barLayoutIsInherited("rightSections", VAULT)).toBe(false);
  });

  it("a changed default reaches every vault that never adapted", async () => {
    const a = "C:/vaults/a";
    const b = "C:/vaults/b";
    storeValues[barLayoutKey("leftSections", b)] = { order: ["bookmarks", "recents"], visibleCount: 1 };
    await saveBarLayoutAsDefault("leftSections", { order: ["bookmarks", "recents"], visibleCount: 2 });
    expect((await loadBarLayout("leftSections", a)).order[0]).toBe("bookmarks");
    // b keeps its own value, including its own line
    expect((await loadBarLayout("leftSections", b)).visibleCount).toBe(1);
  });
});

describe("writing", () => {
  it("stores a deliberate change under the vault key", async () => {
    await saveBarLayout("leftSections", VAULT, { order: ["bookmarks", "recents"], visibleCount: 1 });
    expect(storeValues[barLayoutKey("leftSections", VAULT)]).toEqual({
      order: ["bookmarks", "recents"],
      visibleCount: 1,
    });
  });

  it("announces the change so open surfaces re-read", async () => {
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent<{ bar: string }>).detail.bar);
    window.addEventListener(BAR_LAYOUT_CHANGED_EVENT, onChange);
    await saveBarLayout("ribbon", VAULT, { order: ["open", "new"], visibleCount: 2 });
    window.removeEventListener(BAR_LAYOUT_CHANGED_EVENT, onChange);
    expect(seen).toEqual(["ribbon"]);
  });

  it("does not rewrite an unchanged value", async () => {
    await saveBarLayout("leftSections", VAULT, { order: ["recents", "bookmarks"], visibleCount: 2 });
    setSpy.mockClear();
    await saveBarLayout("leftSections", VAULT, { order: ["recents", "bookmarks"], visibleCount: 2 });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("sanitizes on the way in — a stray id never reaches the store", async () => {
    await saveBarLayout("leftSections", VAULT, { order: ["bookmarks", "nonsense"], visibleCount: 9 });
    const stored = storeValues[barLayoutKey("leftSections", VAULT)] as { order: string[]; visibleCount: number };
    expect(stored.order).toEqual(["bookmarks", "recents"]);
    expect(stored.visibleCount).toBe(2);
  });

  it("ignores writes without a vault", async () => {
    await saveBarLayout("ribbon", null, { order: ["new"], visibleCount: 1 });
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("reset and default", () => {
  it("reset deletes the vault value so inheritance resumes", async () => {
    storeValues[barLayoutDefaultKey("ribbon")] = { order: ["palette"], visibleCount: 1 };
    await saveBarLayout("ribbon", VAULT, { order: ["mail"], visibleCount: 1 });
    await resetBarLayout("ribbon", VAULT);
    expect(deleteSpy).toHaveBeenCalledWith(barLayoutKey("ribbon", VAULT));
    expect(await barLayoutIsInherited("ribbon", VAULT)).toBe(true);
    expect((await loadBarLayout("ribbon", VAULT)).order[0]).toBe("palette");
  });

  it("saving as default does not touch the vault value", async () => {
    await saveBarLayout("ribbon", VAULT, { order: ["mail"], visibleCount: 1 });
    await saveBarLayoutAsDefault("ribbon", { order: ["graph"], visibleCount: 1 });
    expect((await loadBarLayout("ribbon", VAULT)).order[0]).toBe("mail");
    expect((await loadBarLayout("ribbon", "C:/vaults/other")).order[0]).toBe("graph");
  });
});

describe("pinned entries", () => {
  it("keeps the files tab visible no matter what was stored", async () => {
    storeValues[barLayoutKey("leftTabs", VAULT)] = { order: ["tags", "databases", "files"], visibleCount: 1 };
    const v = await loadBarLayout("leftTabs", VAULT);
    expect(isAreaVisible(v, "files")).toBe(true);
  });
});

describe("loadAllBarLayouts", () => {
  it("returns every bar", async () => {
    const all = await loadAllBarLayouts(VAULT);
    expect(Object.keys(all).sort()).toEqual(["leftSections", "leftTabs", "mobileBar", "ribbon", "rightSections"]);
  });
});

describe("migration of the three places that carried an arrangement before", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("lifts the rail order into the global default", async () => {
    storeValues["ribbonOrder"] = { top: ["palette", "new"], bottom: ["settings", "help"] };
    await migrateLegacyBarLayouts(VAULT);
    // A rail the user sorted before per-vault existed follows them into every
    // vault, which is the arrangement they know.
    expect((await loadBarLayout("ribbon", "C:/vaults/other")).order.slice(0, 2)).toEqual(["palette", "new"]);
    // The fixed bottom group is not part of the model and is simply ignored.
    expect((await loadBarLayout("ribbon", VAULT)).order).not.toContain("settings");
  });

  it("lifts the right sidebar order out of localStorage", async () => {
    localStorage.setItem("plainva-right-panels-order", JSON.stringify(["properties", "backlinks"]));
    await migrateLegacyBarLayouts(VAULT);
    expect((await loadBarLayout("rightSections", VAULT)).order.slice(0, 2)).toEqual(["properties", "backlinks"]);
  });

  it("keeps the per-vault left sections per vault", async () => {
    localStorage.setItem(`plainva-left-sections-${VAULT}-order`, JSON.stringify(["bookmarks", "recents"]));
    await migrateLegacyBarLayouts(VAULT);
    expect((await loadBarLayout("leftSections", VAULT)).order[0]).toBe("bookmarks");
    // Another vault is untouched by it.
    expect((await loadBarLayout("leftSections", "C:/vaults/other")).order[0]).toBe("recents");
  });

  it("never overwrites a deliberate choice, so it can run on every start", async () => {
    await saveBarLayoutAsDefault("ribbon", { order: ["mail"], visibleCount: 1 });
    storeValues["ribbonOrder"] = { top: ["palette", "new"] };
    setSpy.mockClear();
    await migrateLegacyBarLayouts(VAULT);
    expect(setSpy).not.toHaveBeenCalled();
    expect((await loadBarLayout("ribbon", VAULT)).order[0]).toBe("mail");
  });

  it("does nothing when there is nothing to migrate", async () => {
    setSpy.mockClear();
    await migrateLegacyBarLayouts(VAULT);
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("an action added by an app update", () => {
  beforeEach(() => {
    storeValues = {};
  });

  it("arrives beside the action it belongs to instead of landing in the hidden half", async () => {
    // What an install from before the two creation actions looks like: the old
    // eight ids, all visible. Such an install predates the comment overview too,
    // so the same start adopts three ids, each beside the action it belongs to.
    storeValues[barLayoutDefaultKey("ribbon")] = {
      order: ["new", "open", "daily", "graph", "tasks", "calendar", "mail", "palette"],
      visibleCount: 8,
    };

    await migrateLegacyBarLayouts(null);

    const stored = storeValues[barLayoutDefaultKey("ribbon")] as { order: string[]; visibleCount: number };
    expect(stored.order.slice(0, 3)).toEqual(["new", "newFolder", "newBase"]);
    expect(stored.order.slice(-3)).toEqual(["mail", "comments", "palette"]);
    // Grown with them: appended at the end they would exist but be hidden, and
    // the update would look like it did nothing.
    expect(stored.visibleCount).toBe(11);
    expect(visibleAreas(stored)).toContain("newBase");
    expect(visibleAreas(stored)).toContain("comments");
  });

  it("puts the comment overview beside the other views, not at the end", async () => {
    // The overview is NOT gated on a cloud service the way calendar and mail
    // are, but its slot is still anchored to mail: the order lists every known
    // id whether or not the service exists, so the anchor holds on a machine
    // that has never seen a mailbox.
    storeValues[barLayoutDefaultKey("ribbon")] = {
      order: ["new", "newFolder", "newBase", "open", "daily", "graph", "tasks", "calendar", "mail", "palette"],
      visibleCount: 10,
    };

    await migrateLegacyBarLayouts(null);

    const stored = storeValues[barLayoutDefaultKey("ribbon")] as { order: string[]; visibleCount: number };
    expect(stored.order.indexOf("comments")).toBe(stored.order.indexOf("mail") + 1);
    expect(stored.visibleCount).toBe(11);
    expect(visibleAreas(stored)).toContain("comments");
  });

  it("leaves them hidden when the action they follow is hidden", async () => {
    storeValues[barLayoutDefaultKey("ribbon")] = {
      order: ["open", "daily", "new", "graph", "tasks", "calendar", "mail", "comments", "palette"],
      visibleCount: 2, // only "open" and "daily" are visible
    };

    await migrateLegacyBarLayouts(null);

    const stored = storeValues[barLayoutDefaultKey("ribbon")] as { order: string[]; visibleCount: number };
    expect(stored.visibleCount).toBe(2);
    expect(visibleAreas(stored)).toEqual(["open", "daily"]);
  });

  it("runs harmlessly on every start once the ids are stored", async () => {
    storeValues[barLayoutDefaultKey("ribbon")] = {
      order: ["new", "newFolder", "newBase", "open", "daily", "graph", "tasks", "calendar", "mail", "comments", "palette"],
      visibleCount: 4,
    };
    setSpy.mockClear();

    await migrateLegacyBarLayouts(null);

    // Nothing new to adopt -> nothing written, so a user who hid them keeps them hidden.
    expect(setSpy).not.toHaveBeenCalled();
  });
});
