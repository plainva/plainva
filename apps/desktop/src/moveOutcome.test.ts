import { describe, expect, it } from "vitest";
import { landedAtDestination, MoveBlockedError, moveItemName } from "@plainva/ui";

/** The shared rules both shells report a move by (issue 113, V3/V4). */
describe("moveOutcome", () => {
  const fsWith = (paths: string[]) => ({ exists: async (p: string) => paths.includes(p) });

  it("a move counts as done only when the item is at its destination and gone from its source", async () => {
    expect(await landedAtDestination(fsWith(["B/n.md"]), "A/n.md", "B/n.md")).toBe(true);
    expect(await landedAtDestination(fsWith(["A/n.md"]), "A/n.md", "B/n.md")).toBe(false);
    expect(await landedAtDestination(fsWith(["A/n.md", "B/n.md"]), "A/n.md", "B/n.md")).toBe(false);
  });

  it("an unreadable answer is not a landed move", async () => {
    const broken = { exists: async () => { throw new Error("io"); } };
    expect(await landedAtDestination(broken, "A/n.md", "B/n.md")).toBe(false);
  });

  it("names the item and keeps the reason of a refused move", () => {
    const reason = new Error("disk full");
    const err = new MoveBlockedError("Projects/Plan.md", reason);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe(reason);
    expect(moveItemName(err.path)).toBe("Plan.md");
    expect(moveItemName("Projects/")).toBe("Projects");
  });
});
