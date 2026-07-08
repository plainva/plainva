import { describe, it, expect } from "vitest";
import { baseInputTypeOptions } from "./baseViewerShared";
import { BASE_TYPE_GROUPS } from "../PropertyValues";

// P7 (Gesamtplan 2026-07-04): ONE `.base` type vocabulary — the grouped picker
// in the column editor and the flat dropdowns (config panel, wizard) must offer
// exactly the same types, and that vocabulary is the markdown panel's plus
// `relation` (the panel's generic `link` stays panel-only).
describe("base property type vocabulary (P7)", () => {
  it("grouped picker and flat dropdowns offer exactly the same types", () => {
    const flat = baseInputTypeOptions((k: string, d?: string) => d ?? k).map((o) => o.value).sort();
    const grouped = BASE_TYPE_GROUPS.flatMap((g) => g.types).map(String).sort();
    expect(grouped).toEqual(flat);
  });

  it("covers the markdown panel vocabulary plus relation, without generic link", () => {
    const flat = new Set(baseInputTypeOptions((k: string) => k).map((o) => o.value));
    const expected = ["text", "number", "checkbox", "date", "datetime", "list", "tags", "select", "status", "multiselect", "url", "email", "phone", "relation"];
    for (const ty of expected) {
      expect(flat.has(ty), ty).toBe(true);
    }
    expect(flat.size).toBe(expected.length);
    expect(flat.has("link")).toBe(false);
  });
});
