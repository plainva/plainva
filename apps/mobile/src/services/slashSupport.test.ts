import { describe, expect, it } from "vitest";
import { getSlashCommands, filterSlashCommands, setUnavailableSlashCommands } from "@plainva/ui";
import { applyMobileSlashSupport, UNAVAILABLE_SLASH_COMMANDS } from "./slashSupport";

/**
 * Since S19 the phone serves every slash command, so the list is empty and the
 * interesting assertions turn around: nothing is hidden, and the two entries
 * that were dead are reachable — including through the query someone actually
 * types, which runs its own pass over the definitions.
 */
describe("mobile slash support", () => {
  it("hides nothing: the phone serves all of them", () => {
    setUnavailableSlashCommands([]);
    const before = getSlashCommands().length;
    applyMobileSlashSupport();
    expect(UNAVAILABLE_SLASH_COMMANDS).toEqual([]);
    expect(getSlashCommands().length).toBe(before);
  });

  it("offers the two base commands that used to do nothing", () => {
    applyMobileSlashSupport();
    const typed = filterSlashCommands("/base").map((c) => c.type);
    expect(typed).toContain("embedbase");
    expect(typed).toContain("newbase");
  });

  it("keeps the five sections", () => {
    applyMobileSlashSupport();
    const sections = new Set(
      getSlashCommands()
        .map((c) => (typeof c.section === "string" ? c.section : c.section?.name))
        .filter(Boolean),
    );
    expect(sections.size).toBe(5);
  });
});
