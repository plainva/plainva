import { describe, expect, it } from "vitest";
import { qrMatrix } from "@plainva/ui";
import { encodeWorkspaceInvite } from "@plainva/core";

describe("qrMatrix (offline QR encoder)", () => {
  it("returns null for an empty value", () => {
    expect(qrMatrix("")).toBeNull();
  });

  it("builds a square matrix with the three finder patterns", () => {
    const grid = qrMatrix("PLAINVA");
    expect(grid).not.toBeNull();
    const n = grid!.length;
    expect(n).toBeGreaterThanOrEqual(21); // QR version 1 is 21x21 modules.
    for (const row of grid!) expect(row.length).toBe(n);
    // A finder pattern is a 7x7 block with a dark outer ring; its four corners
    // are dark. They sit at the top-left, top-right and bottom-left of the code.
    const finderCornersDark = (r0: number, c0: number) =>
      grid![r0][c0] && grid![r0 + 6][c0] && grid![r0][c0 + 6] && grid![r0 + 6][c0 + 6];
    expect(finderCornersDark(0, 0)).toBe(true);
    expect(finderCornersDark(0, n - 7)).toBe(true);
    expect(finderCornersDark(n - 7, 0)).toBe(true);
  });

  it("is deterministic for the same value", () => {
    expect(qrMatrix("PVINVITE1.abc")).toEqual(qrMatrix("PVINVITE1.abc"));
  });

  it("encodes a full workspace invitation code without throwing", () => {
    const code = encodeWorkspaceInvite({ memberId: "a".repeat(16), workspaceId: "b".repeat(32), fingerprint: "c".repeat(52) });
    const grid = qrMatrix(code);
    expect(grid).not.toBeNull();
    expect(grid!.length).toBeGreaterThan(21); // A ~150-char payload needs a mid version.
  });
});
