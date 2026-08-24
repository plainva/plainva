import { describe, it, expect } from "vitest";
import { vaultNestingConflict } from "./vaultNesting";

/**
 * The one stage-D case with data loss behind it (§ 6.6): two vaults on
 * overlapping trees mean two watchers, two indexers and two sync targets for
 * the same file. Everything here is therefore about REFUSING precisely — a rule
 * that also refuses harmless pairs would be worked around, and one that lets a
 * nested pair through is silent until a file goes missing.
 */
describe("two vaults may not overlap", () => {
  it("lets unrelated vaults be open together", () => {
    expect(vaultNestingConflict("/notes", ["/work", "/archive"])).toBeNull();
  });

  it("lets the same vault be shown by a second window", () => {
    // Stage C, unchanged: one runtime, two windows.
    expect(vaultNestingConflict("/notes", ["/notes"])).toBeNull();
    expect(vaultNestingConflict("/notes/", ["/notes"])).toBeNull();
  });

  it("names the open vault a new one would sit inside", () => {
    expect(vaultNestingConflict("/notes/project", ["/notes"])).toEqual({ other: "/notes", kind: "inside" });
  });

  it("names the open vault a new one would swallow", () => {
    expect(vaultNestingConflict("/notes", ["/notes/project"])).toEqual({
      other: "/notes/project",
      kind: "contains",
    });
  });

  /**
   * A prefix is not a parent. Refusing "/notes-old" beside "/notes" would be a
   * rule people route around, and routing around this one is exactly what must
   * not happen.
   */
  it("does not mistake a shared prefix for nesting", () => {
    expect(vaultNestingConflict("/notes-old", ["/notes"])).toBeNull();
    expect(vaultNestingConflict("/notes", ["/notes-old"])).toBeNull();
  });

  it("reads a Windows path the way Windows does", () => {
    expect(vaultNestingConflict("C:\\Vaults\\Work", ["c:/vaults"])).toEqual({
      other: "c:/vaults",
      kind: "inside",
    });
    // Same vault, different spelling — still one vault.
    expect(vaultNestingConflict("C:\\Vaults\\", ["c:/vaults"])).toBeNull();
  });

  /**
   * POSIX file systems are case-sensitive, so `/Notes` and `/notes` are two
   * different directories and folding them would refuse a legitimate pair.
   */
  it("keeps POSIX paths case-sensitive", () => {
    expect(vaultNestingConflict("/Notes/project", ["/notes"])).toBeNull();
  });

  it("reports the first conflict it finds rather than only the last", () => {
    expect(vaultNestingConflict("/notes/a", ["/other", "/notes", "/notes/a/b"])?.other).toBe("/notes");
  });
});
