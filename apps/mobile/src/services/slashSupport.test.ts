import { afterEach, describe, expect, it } from "vitest";
import { getSlashCommands, filterSlashCommands, setUnavailableSlashCommands } from "@plainva/ui";
import { applyMobileSlashSupport, UNAVAILABLE_SLASH_COMMANDS } from "./slashSupport";

/** Other suites share the module-level registration; leave it as found. */
afterEach(() => setUnavailableSlashCommands([]));

describe("mobile slash support", () => {
  it("hides the commands whose picker this shell has no listener for", () => {
    setUnavailableSlashCommands([]);
    const before = getSlashCommands().map((c) => c.label);
    applyMobileSlashSupport();
    const after = getSlashCommands();
    for (const key of UNAVAILABLE_SLASH_COMMANDS) {
      // The entries exist in the shared menu — the point is that the phone,
      // which cannot serve them, stops offering them.
      expect(before.length).toBeGreaterThan(after.length);
      expect(after.some((c) => c.label.toLowerCase().includes(key))).toBe(false);
    }
  });

  it("also hides them from a typed query, not just the full list", () => {
    applyMobileSlashSupport();
    // "/base" is exactly how someone reaches them; filtering runs its own pass
    // over the definitions, so it needs the same gate.
    expect(filterSlashCommands("/base").map((c) => c.type)).not.toContain("embedbase");
    expect(filterSlashCommands("/base").map((c) => c.type)).not.toContain("newbase");
  });

  it("leaves every other command in place", () => {
    applyMobileSlashSupport();
    const keys = getSlashCommands().map((c) => c.type);
    expect(keys).toContain("table");
    expect(keys).toContain("embed");
  });

  it("keeps the full menu for a shell that declares no gaps", () => {
    setUnavailableSlashCommands([]);
    const keys = getSlashCommands().map((c) => c.type);
    // The desktop registers nothing, so its menu must be untouched by all this.
    expect(keys).toContain("embedbase");
    expect(keys).toContain("newbase");
  });
});
