import { describe, expect, it } from "vitest";
import { saveLabelFor } from "./dirtyStore";

// Finding X5 (review 2026-11-10): the tab showed the unsaved dot while the
// label said "Saved". The label now answers from the same dirty fact.
describe("saveLabelFor", () => {
  it("never says saved while the file is dirty", () => {
    expect(saveLabelFor({ writing: false, failed: false, dirty: true })).toBe("saving");
  });
  it("says saving while a write runs", () => {
    expect(saveLabelFor({ writing: true, failed: false, dirty: false })).toBe("saving");
  });
  it("says saved once nothing is dirty and nothing is written", () => {
    expect(saveLabelFor({ writing: false, failed: false, dirty: false })).toBe("saved");
  });
  it("keeps a failed write visible even though the file stays dirty", () => {
    expect(saveLabelFor({ writing: false, failed: true, dirty: true })).toBe("failed");
  });
});
