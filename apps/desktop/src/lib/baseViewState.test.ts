import { describe, expect, it } from "vitest";
import { baseViewStateKey, getLastActiveView, resolveViewIndex, setLastActiveView, viewStateName } from "@plainva/ui";

function fakeStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

/** Build-91 feedback, P6: the last active view of a database, shared by both shells. */
describe("baseViewState (shared)", () => {
  const views = [{ type: "table", name: "Pinnwand" }, { type: "table", name: "Tabelle" }, { type: "calendar" }];

  it("addresses views by name, unnamed ones by index sentinel", () => {
    expect(viewStateName(views[0], 0)).toBe("Pinnwand");
    expect(viewStateName(views[2], 2)).toBe("#2");
    expect(resolveViewIndex(views, "Tabelle")).toBe(1);
    expect(resolveViewIndex(views, "#2")).toBe(2);
    expect(resolveViewIndex(views, "Renamed")).toBe(0);
    expect(resolveViewIndex(undefined, "Tabelle")).toBe(0);
    expect(resolveViewIndex(views, null)).toBe(0);
  });

  it("remembers per vault and per file, and survives a missing vault key", () => {
    const storage = fakeStorage();
    setLastActiveView("local", "Zettel.base", "Pinnwand", storage);
    setLastActiveView("local", "Projekte.base", "Termine", storage);
    expect(getLastActiveView("local", "Zettel.base", storage)).toBe("Pinnwand");
    expect(getLastActiveView("local", "Projekte.base", storage)).toBe("Termine");
    expect(getLastActiveView("other", "Zettel.base", storage)).toBeNull();
    expect(getLastActiveView(null, "Zettel.base", storage)).toBeNull();
    expect(storage.map.has(baseViewStateKey("local"))).toBe(true);
    setLastActiveView(null, "Zettel.base", "x", storage); // no throw, nothing written
    expect(storage.map.size).toBe(1);
  });
});
