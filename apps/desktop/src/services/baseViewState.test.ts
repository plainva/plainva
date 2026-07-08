// localStorage comes from the central setup (test-localstorage.ts): the old
// per-file shim guarded on `typeof localStorage === "undefined"`, which Node
// >= 25 defeats by defining a broken ambient localStorage of its own.
import { beforeEach, describe, expect, it } from "vitest";
import {
  getExpandedSubItems,
  getLastActiveView,
  resolveViewIndex,
  setExpandedSubItems,
  setLastActiveView,
  viewStateName,
} from "./baseViewState";

const VAULT = "C:/vaults/demo";

describe("baseViewState (Base-UX2 P6)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and restores the last active view per vault + file", () => {
    setLastActiveView(VAULT, "DB/Projekte.base", "Board");
    setLastActiveView(VAULT, "DB/Andere.base", "Kalender");
    expect(getLastActiveView(VAULT, "DB/Projekte.base")).toBe("Board");
    expect(getLastActiveView(VAULT, "DB/Andere.base")).toBe("Kalender");
    expect(getLastActiveView("C:/vaults/other", "DB/Projekte.base")).toBeNull();
  });

  it("is a no-op without a vault path", () => {
    setLastActiveView(null, "x.base", "Board");
    expect(getLastActiveView(null, "x.base")).toBeNull();
  });

  it("addresses views by name with an index sentinel for unnamed ones", () => {
    expect(viewStateName({ name: "Board" }, 2)).toBe("Board");
    expect(viewStateName({ name: "  " }, 2)).toBe("#2");
    expect(viewStateName(undefined, 0)).toBe("#0");
  });

  it("resolves the stored identifier back to an index (0 when unknown)", () => {
    const views = [{ name: "Tabelle" }, { name: "Board" }, {}];
    expect(resolveViewIndex(views, "Board")).toBe(1);
    expect(resolveViewIndex(views, "#2")).toBe(2);
    expect(resolveViewIndex(views, "Gibt es nicht")).toBe(0);
    expect(resolveViewIndex(views, null)).toBe(0);
    expect(resolveViewIndex([], "Board")).toBe(0);
    expect(resolveViewIndex(undefined, "Board")).toBe(0);
  });

  it("survives corrupted storage", () => {
    localStorage.setItem(`plainva-base-active-view-${VAULT}`, "{not json");
    expect(getLastActiveView(VAULT, "a.base")).toBeNull();
    setLastActiveView(VAULT, "a.base", "Board");
    expect(getLastActiveView(VAULT, "a.base")).toBe("Board");
  });

  it("round-trips expanded sub-item rows per file, defaulting to collapsed", () => {
    expect(getExpandedSubItems(VAULT, "DB/Aufgaben.base")).toEqual([]);
    setExpandedSubItems(VAULT, "DB/Aufgaben.base", ["a.md", "b.md"]);
    setExpandedSubItems(VAULT, "DB/Andere.base", ["x.md"]);
    expect(getExpandedSubItems(VAULT, "DB/Aufgaben.base")).toEqual(["a.md", "b.md"]);
    expect(getExpandedSubItems(VAULT, "DB/Andere.base")).toEqual(["x.md"]);
    // Emptying removes the entry; no vault path is a no-op.
    setExpandedSubItems(VAULT, "DB/Aufgaben.base", []);
    expect(getExpandedSubItems(VAULT, "DB/Aufgaben.base")).toEqual([]);
    expect(getExpandedSubItems(null, "DB/Aufgaben.base")).toEqual([]);
  });

  it("tolerates corrupted sub-items storage and non-string entries", () => {
    localStorage.setItem(`plainva-base-subitems-${VAULT}`, "{kaputt");
    expect(getExpandedSubItems(VAULT, "a.base")).toEqual([]);
    localStorage.setItem(`plainva-base-subitems-${VAULT}`, JSON.stringify({ "a.base": ["ok.md", 5, null] }));
    expect(getExpandedSubItems(VAULT, "a.base")).toEqual(["ok.md"]);
  });
});
