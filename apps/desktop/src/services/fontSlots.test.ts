import { describe, expect, it } from "vitest";
import { catalogForSlot, FONT_CATALOG, FONT_FAMILY_STACKS, FONT_SLOT_FAMILIES, fontKindsForSlot, resolveFontChoiceValue, type FontPlatform } from "@plainva/ui";

// Issue #82, plan Issue-Durchsicht 2026-09-06, P2: the code slot is monospace
// only — in the presets, in the catalogue behind "Custom…", and when a stored
// value names a proportional preset for it.
describe("font slots: the code slot is monospace only", () => {
  it("offers every family to interface and content, only mono to code", () => {
    expect(FONT_SLOT_FAMILIES.ui).toEqual(["serif", "sans", "mono"]);
    expect(FONT_SLOT_FAMILIES.content).toEqual(["serif", "sans", "mono"]);
    expect(FONT_SLOT_FAMILIES.code).toEqual(["mono"]);
    expect(fontKindsForSlot("ui")).toBeNull();
    expect(fontKindsForSlot("content")).toBeNull();
    expect(fontKindsForSlot("code")).toEqual(["mono"]);
  });

  it("keeps a stable identity for the kinds, so a memo on them does not churn", () => {
    expect(fontKindsForSlot("code")).toBe(fontKindsForSlot("code"));
  });

  it("narrows every platform's catalogue to its mono rows for code, and leaves the other slots the whole list", () => {
    for (const platform of Object.keys(FONT_CATALOG) as FontPlatform[]) {
      const all = FONT_CATALOG[platform];
      const mono = catalogForSlot(all, "code");
      expect(mono.length, platform).toBeGreaterThan(0);
      expect(mono.every((f) => f.kind === "mono"), platform).toBe(true);
      expect(mono.length, platform).toBe(all.filter((f) => f.kind === "mono").length);
      expect(catalogForSlot(all, "content")).toBe(all);
      expect(catalogForSlot(all, "ui")).toBe(all);
    }
  });

  it("keeps the theme font when a stored code choice names a proportional preset", () => {
    expect(resolveFontChoiceValue("code", { family: "serif", customName: "" })).toBeNull();
    expect(resolveFontChoiceValue("code", { family: "sans", customName: "" })).toBeNull();
    expect(resolveFontChoiceValue("code", { family: "mono", customName: "" })).toBe(FONT_FAMILY_STACKS.mono);
    expect(resolveFontChoiceValue("content", { family: "serif", customName: "" })).toBe(FONT_FAMILY_STACKS.serif);
    expect(resolveFontChoiceValue("ui", { family: "mono", customName: "" })).toBe(FONT_FAMILY_STACKS.mono);
  });
});
