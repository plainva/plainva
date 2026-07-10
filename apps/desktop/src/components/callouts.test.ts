import { describe, it, expect } from "vitest";
import { calloutIconPath, calloutColor } from "@plainva/ui";

describe("calloutIconPath", () => {
  it("returns icon markup for canonical types", () => {
    expect(calloutIconPath("note")).toContain("<path");
    expect(calloutIconPath("warning")).toContain("<path");
  });

  it("resolves aliases to their canonical icon", () => {
    expect(calloutIconPath("error")).toBe(calloutIconPath("danger"));
    expect(calloutIconPath("summary")).toBe(calloutIconPath("abstract"));
    expect(calloutIconPath("tldr")).toBe(calloutIconPath("abstract"));
    expect(calloutIconPath("caution")).toBe(calloutIconPath("warning"));
    expect(calloutIconPath("hint")).toBe(calloutIconPath("tip"));
    expect(calloutIconPath("faq")).toBe(calloutIconPath("question"));
    expect(calloutIconPath("cite")).toBe(calloutIconPath("quote"));
  });

  it("is case-insensitive", () => {
    expect(calloutIconPath("WARNING")).toBe(calloutIconPath("warning"));
  });

  it("falls back to the note icon for unknown types", () => {
    expect(calloutIconPath("definitelynotatype")).toBe(calloutIconPath("note"));
  });
});

describe("calloutColor (alias parity with icons)", () => {
  it("gives aliases the same colour as their canonical type", () => {
    expect(calloutColor("error")).toBe(calloutColor("danger"));
    expect(calloutColor("summary")).toBe(calloutColor("abstract"));
  });
});
